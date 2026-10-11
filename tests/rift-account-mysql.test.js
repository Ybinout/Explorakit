const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const shouldRun = process.env.RUN_MYSQL_TESTS === '1';
let dbPool;
let account;

test.before(() => {
    if (!shouldRun) return;
    if (!/test/i.test(process.env.DB_NAME || '')) throw new Error('DB_NAME doit cibler une base de test.');
    ({ dbPool } = require('../server/config/database'));
    account = require('../server/persistence/riftAccountRepository');
});

test.after(async () => {
    if (dbPool) await dbPool.end();
});

async function fixture(count = 3) {
    const users = [];
    const runs = [];
    for (let index = 0; index < count; index += 1) {
        const username = `rift_${randomUUID()}`;
        const [insert] = await dbPool.execute(
            'INSERT INTO users (username, password_hash, money) VALUES (?, ?, 321)', [username, 'unused-test-password']
        );
        users.push({ id: insert.insertId, username });
    }
    return {
        users,
        run(players = users) {
            const run = { id: randomUUID(), players, explorationMs: 20 * 60000 };
            runs.push(run.id);
            return run;
        },
        async cleanup() {
            for (const id of runs) await dbPool.execute('DELETE FROM rift_runs WHERE id = ?', [id]);
            for (const user of users) await dbPool.execute('DELETE FROM users WHERE id = ?', [user.id]);
        }
    };
}

test('RiftMon SQL: départs et règlements concurrents récompensent chaque compte une seule fois', { skip: !shouldRun }, async () => {
    const f = await fixture();
    try {
        assert.deepEqual(await account.getProfile(f.users[0].id), { wins: 0, losses: 0, gamesStarted: 0, coins: 0 });
        const [uninitialized] = await dbPool.execute('SELECT user_id FROM rift_profiles WHERE user_id = ?', [f.users[0].id]);
        assert.equal(uninitialized.length, 0, 'la lecture du profil ne crée pas de faux historique');
        const run = f.run();
        const starts = await Promise.all(Array.from({ length: 4 }, () => account.recordRunStarted(run)));
        assert.equal(starts.filter((result) => result.recorded).length, 1);
        for (const user of f.users) assert.deepEqual(await account.getProfile(user.id), { wins: 0, losses: 0, gamesStarted: 1, coins: 0 });
        // The live list no longer contains the quitter; the SQL launch ledger must retain them.
        const finished = { ...run, players: f.users.slice(0, 2), winnerId: f.users[0].id, finishedAt: Date.now() };
        const settlements = await Promise.all(Array.from({ length: 4 }, () => account.recordRunFinished(finished)));
        assert.equal(settlements.filter((result) => result.recorded).length, 1);
        const reward = { version: 1, participantCount: 3, explorationMs: 1200000, coinsPerPlayerMinute: 2.5, coinsAwarded: 150 };
        for (const settlement of settlements) assert.deepEqual(settlement.reward, reward);
        assert.deepEqual(await account.getProfile(f.users[0].id), { wins: 1, losses: 0, gamesStarted: 1, coins: 150 });
        for (const user of f.users.slice(1)) assert.deepEqual(await account.getProfile(user.id), { wins: 0, losses: 1, gamesStarted: 1, coins: 0 });
        const [entries] = await dbPool.execute('SELECT outcome, coins_earned FROM rift_run_entries WHERE run_id = ?', [run.id]);
        assert.equal(entries.filter((entry) => entry.outcome === 'win').length, 1);
        assert.equal(entries.reduce((sum, entry) => sum + entry.coins_earned, 0), 150);
        const [[stored]] = await dbPool.execute('SELECT participant_count, reward_exploration_ms, reward_version FROM rift_runs WHERE id = ?', [run.id]);
        assert.deepEqual(stored, { participant_count: 3, reward_exploration_ms: 1200000, reward_version: 1 });
        const replay = await account.recordRunFinished({
            id: run.id, players: [f.users[1]], winnerId: f.users[1].id, explorationMs: 7200000,
            finishedAt: new Date(Date.now() + 86400000)
        });
        assert.deepEqual(replay, { recorded: false, winnerId: f.users[0].id, coinsAwarded: 150, reward });
        assert.deepEqual(await account.getProfile(f.users[0].id), { wins: 1, losses: 0, gamesStarted: 1, coins: 150 });
        for (const user of f.users) {
            const [[row]] = await dbPool.execute('SELECT money FROM users WHERE id = ?', [user.id]);
            assert.equal(Number(row.money), 321, 'la monnaie Aventure reste indépendante');
        }
    } finally {
        await f.cleanup();
    }
});

test('RiftMon SQL: absence de vainqueur, résultat rejoué et vainqueur extérieur ne créent aucune prime', { skip: !shouldRun }, async () => {
    const f = await fixture();
    try {
        const run = f.run(f.users.slice(0, 2));
        await assert.rejects(account.recordRunFinished({ ...run, winnerId: f.users[0].id }), /pas été enregistrée/);
        await account.recordRunStarted(run);
        await assert.rejects(account.recordRunFinished({ ...run, winnerId: f.users[2].id }), /ne fait pas partie/);
        assert.deepEqual(await account.getProfile(f.users[0].id), { wins: 0, losses: 0, gamesStarted: 1, coins: 0 });
        const result = await account.recordRunFinished({ ...run, winnerId: null });
        const reward = { version: 1, participantCount: 2, explorationMs: 1200000, coinsPerPlayerMinute: 2.5, coinsAwarded: 0 };
        assert.deepEqual(result, { recorded: true, winnerId: null, coinsAwarded: 0, reward });
        assert.deepEqual(await account.recordRunFinished({ ...run, winnerId: f.users[0].id }), { recorded: false, winnerId: null, coinsAwarded: 0, reward });
        for (const user of run.players) assert.deepEqual(await account.getProfile(user.id), { wins: 0, losses: 1, gamesStarted: 1, coins: 0 });
        assert.deepEqual(await account.getProfile(f.users[2].id), { wins: 0, losses: 0, gamesStarted: 0, coins: 0 });
    } finally {
        await f.cleanup();
    }
});

test('RiftMon SQL: une erreur de participant annule atomiquement le lancement et ses compteurs', { skip: !shouldRun }, async () => {
    const f = await fixture(2);
    try {
        const [[lastUser]] = await dbPool.execute('SELECT MAX(id) AS id FROM users');
        const missingId = Number(lastUser.id) + 100000;
        const run = f.run([{ id: f.users[0].id }, { id: missingId }]);
        await assert.rejects(account.recordRunStarted(run), { code: 'ER_NO_REFERENCED_ROW_2' });
        const [registered] = await dbPool.execute('SELECT id FROM rift_runs WHERE id = ?', [run.id]);
        assert.equal(registered.length, 0);
        assert.deepEqual(await account.getProfile(f.users[0].id), { wins: 0, losses: 0, gamesStarted: 0, coins: 0 });
        assert.equal((await account.recordRunStarted({ ...run, players: f.users })).recorded, true);
        await account.recordRunFinished({ ...run, winnerId: f.users[0].id });
        assert.deepEqual(await account.getProfile(f.users[0].id), { wins: 1, losses: 0, gamesStarted: 1, coins: 100 });
    } finally {
        await f.cleanup();
    }
});

test('RiftMon SQL: plusieurs parties concurrentes se cumulent sans changer un roster déjà inscrit', { skip: !shouldRun }, async () => {
    const f = await fixture();
    try {
        const runs = f.users.map((user, index) => ({ ...f.run(), winnerId: user.id, explorationMs: (index + 1) * 20 * 60000 }));
        await Promise.all(runs.map((run) => account.recordRunStarted(run)));
        await assert.rejects(account.recordRunStarted({ ...runs[0], players: f.users.slice(0, 2) }), /composition/);
        assert.equal((await account.recordRunStarted({ ...runs[0], players: new Map([...f.users].reverse().map((user) => [user.id, user])) })).recorded, false);
        await Promise.all(runs.map((run) => account.recordRunFinished(run)));
        for (const [index, user] of f.users.entries()) {
            assert.deepEqual(await account.getProfile(user.id), { wins: 1, losses: 2, gamesStarted: 3, coins: (index + 1) * 150 });
        }
    } finally {
        await f.cleanup();
    }
});

test('RiftMon SQL: une erreur pendant le règlement annule aussi les résultats des autres participants', { skip: !shouldRun }, async () => {
    const f = await fixture();
    try {
        const run = f.run();
        const winner = f.users.at(-1);
        await account.recordRunStarted(run);
        // Force a real SQL failure on the final participant, after the other
        // profiles were updated inside the transaction.
        await dbPool.execute('UPDATE rift_profiles SET coins = 18446744073709551615 WHERE user_id = ?', [winner.id]);
        await assert.rejects(account.recordRunFinished({ ...run, winnerId: winner.id }), (error) =>
            error.code === 'ER_DATA_OUT_OF_RANGE' || error.code === 'ER_WARN_DATA_OUT_OF_RANGE');
        for (const user of f.users.slice(0, -1)) {
            assert.deepEqual(await account.getProfile(user.id), { wins: 0, losses: 0, gamesStarted: 1, coins: 0 });
        }
        const [[stored]] = await dbPool.execute('SELECT finished_at, winner_id, reward_exploration_ms, reward_version FROM rift_runs WHERE id = ?', [run.id]);
        assert.equal(stored.finished_at, null);
        assert.equal(stored.winner_id, null);
        assert.equal(stored.reward_exploration_ms, null);
        assert.equal(stored.reward_version, null);
        const [entries] = await dbPool.execute('SELECT outcome, coins_earned FROM rift_run_entries WHERE run_id = ?', [run.id]);
        assert.ok(entries.every((entry) => entry.outcome === 'pending' && entry.coins_earned === 0));
        await dbPool.execute('UPDATE rift_profiles SET coins = 0 WHERE user_id = ?', [winner.id]);
        await account.recordRunFinished({ ...run, winnerId: winner.id });
        assert.deepEqual(await account.getProfile(winner.id), { wins: 1, losses: 0, gamesStarted: 1, coins: 150 });
    } finally {
        await f.cleanup();
    }
});

test('RiftMon SQL: les effectifs impairs, secondes et jusqu’à cinq heures déterminent la prime du seul vainqueur', { skip: !shouldRun }, async () => {
    const f = await fixture(16);
    try {
        let total = 0;
        const cases = [
            { count: 2, ms: 1200000, coins: 100 },
            { count: 3, ms: 60000, coins: 7 },
            { count: 5, ms: 1800000, coins: 375 },
            { count: 7, ms: 75234, coins: 21 },
            { count: 16, ms: 7200000, coins: 4800 },
            { count: 3, ms: 2400000, coins: 300 },
            { count: 3, ms: 18000000, coins: 2250 },
            { count: 16, ms: 18000000, coins: 12000 },
            { count: 2, ms: 0, coins: 0 }
        ];
        for (const [index, { count, ms, coins }] of cases.entries()) {
            const run = { ...f.run(f.users.slice(0, count)), explorationMs: ms, winnerId: f.users[0].id };
            await account.recordRunStarted(run);
            const result = await account.recordRunFinished(run);
            assert.equal(result.coinsAwarded, coins);
            assert.deepEqual(result.reward, {
                version: 1, participantCount: count, explorationMs: ms, coinsPerPlayerMinute: 2.5, coinsAwarded: coins
            });
            total += coins;
            assert.deepEqual(await account.getProfile(f.users[0].id), {
                wins: index + 1, losses: 0, gamesStarted: index + 1, coins: total
            });
            assert.deepEqual(await account.getProfile(f.users[1].id), {
                wins: 0, losses: index + 1, gamesStarted: index + 1, coins: 0
            });
            const [[ledger]] = await dbPool.execute('SELECT SUM(coins_earned) AS coins FROM rift_run_entries WHERE run_id = ?', [run.id]);
            assert.equal(Number(ledger.coins), coins);
        }
    } finally {
        await f.cleanup();
    }
});

test('RiftMon SQL: une durée absente ou invalide ne règle pas la partie et aucun forfait de 100 pièces ne subsiste', { skip: !shouldRun }, async () => {
    const f = await fixture(2);
    try {
        const run = f.run();
        await account.recordRunStarted(run);
        const invalidClocks = [undefined, null, false, '1200000', -1, 0.5, NaN, Infinity, 18000001, {}];
        for (const explorationMs of invalidClocks) {
            await assert.rejects(account.recordRunFinished({ ...run, winnerId: f.users[0].id, explorationMs }), /durée d’exploration/);
        }
        const [[stored]] = await dbPool.execute('SELECT finished_at, winner_id, reward_exploration_ms, reward_version FROM rift_runs WHERE id = ?', [run.id]);
        assert.deepEqual(stored, { finished_at: null, winner_id: null, reward_exploration_ms: null, reward_version: null });
        for (const user of f.users) assert.deepEqual(await account.getProfile(user.id), { wins: 0, losses: 0, gamesStarted: 1, coins: 0 });
        const result = await account.recordRunFinished({ ...run, winnerId: f.users[0].id, explorationMs: 180000 });
        assert.equal(result.coinsAwarded, 15);
        // Replays have no new clock obligation: the transaction already stored it.
        assert.deepEqual(await account.recordRunFinished({ id: run.id }), { ...result, recorded: false });
        assert.deepEqual(await account.recordRunFinished({ id: run.id, explorationMs: -1 }), { ...result, recorded: false });
    } finally {
        await f.cleanup();
    }
});

test('RiftMon SQL: les anciennes 100 pièces restent inchangées, sans durée ni détail inventé au rejeu', { skip: !shouldRun }, async () => {
    const f = await fixture();
    try {
        const run = f.run();
        await account.recordRunStarted(run);
        // Reproduce the ledger of a finished run before migration 011.
        for (const [index, user] of f.users.entries()) {
            const won = index === 0;
            await dbPool.execute('UPDATE rift_run_entries SET outcome = ?, coins_earned = ? WHERE run_id = ? AND user_id = ?', [won ? 'win' : 'loss', won ? 100 : 0, run.id, user.id]);
            await dbPool.execute('UPDATE rift_profiles SET wins = ?, losses = ?, coins = ? WHERE user_id = ?', [won ? 1 : 0, won ? 0 : 1, won ? 100 : 0, user.id]);
        }
        await dbPool.execute('UPDATE rift_runs SET finished_at = CURRENT_TIMESTAMP, winner_id = ? WHERE id = ?', [f.users[0].id, run.id]);
        const replays = await Promise.all([
            account.recordRunFinished({ id: run.id }),
            account.recordRunFinished({ ...run, winnerId: f.users[1].id, explorationMs: 7200000 }),
            account.recordRunFinished({ ...run, explorationMs: 'invalid' })
        ]);
        for (const result of replays) assert.deepEqual(result, { recorded: false, winnerId: f.users[0].id, coinsAwarded: 100 });
        assert.deepEqual(await account.getProfile(f.users[0].id), { wins: 1, losses: 0, gamesStarted: 1, coins: 100 });
        for (const user of f.users.slice(1)) assert.deepEqual(await account.getProfile(user.id), { wins: 0, losses: 1, gamesStarted: 1, coins: 0 });
        const [[stored]] = await dbPool.execute('SELECT reward_exploration_ms, reward_version FROM rift_runs WHERE id = ?', [run.id]);
        assert.deepEqual(stored, { reward_exploration_ms: null, reward_version: null });
    } finally {
        await f.cleanup();
    }
});

test('RiftMon HTTP: seul le profil du JWT est lisible, sans route publique de récompense', { skip: !shouldRun }, async () => {
    const express = require('express');
    const { signAccessToken } = require('../server/config/auth');
    const f = await fixture(2);
    const app = express();
    app.use(express.json());
    app.use('/api', require('../server/http/routes'));
    const server = await new Promise((resolve) => {
        const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const url = `http://127.0.0.1:${server.address().port}/api/rift/profile`;
    try {
        const run = f.run();
        await account.recordRunStarted(run);
        await account.recordRunFinished({ ...run, winnerId: f.users[0].id });
        assert.equal((await fetch(url)).status, 401);
        assert.equal((await fetch(url, { headers: { Authorization: 'Bearer invalid' } })).status, 401);
        const headers = { Authorization: `Bearer ${signAccessToken(f.users[1])}` };
        const response = await fetch(`${url}?userId=${f.users[0].id}&coins=9999`, { headers });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.deepEqual(await response.json(), { wins: 0, losses: 1, gamesStarted: 1, coins: 0 });
        assert.equal((await fetch(url, { method: 'POST', headers })).status, 404);
        assert.deepEqual(await account.getProfile(f.users[1].id), { wins: 0, losses: 1, gamesStarted: 1, coins: 0 });
    } finally {
        await new Promise((resolve) => server.close(resolve));
        await f.cleanup();
    }
});
