const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateAccountReward, REWARD_VERSION, COINS_PER_PLAYER_MINUTE, MAX_EXPLORATION_MS } = require('../server/game/drift/accountReward');
const { createLobbyStore, RECONNECT_MS } = require('../server/game/drift/lobbyStore');
const { createRunManager } = require('../server/game/drift/runManager');

async function fixture(count = 2, durationMinutes = 20, accountRepository = null) {
    let clock = 1000;
    const store = createLobbyStore({ now: () => clock });
    const runtime = createRunManager({ store, namespace: { to: () => ({ emit() {} }) },
        now: () => clock, random: () => .2, paceMs: 0, accountRepository });
    const users = Array.from({ length: count }, (_, index) => ({ id: index + 1, username: `Joueur ${index + 1}` }));
    for (const user of users) store.connect(user, `s${user.id}`);
    const { code } = store.create(users[0], { capacity: count, durationMinutes });
    for (const user of users.slice(1)) store.join(user, code);
    for (const user of users) store.ready(user, true);
    await runtime.start(users[0]);
    for (const user of users) runtime.enter(user, { id: `s${user.id}` });
    return { runtime, store, users, run: store.getLobby(users[0]).run, advance(ms) { clock += ms; } };
}

test('prime RiftMon : barème par participant et minute, arrondi inférieur sans minimum artificiel', () => {
    assert.equal(REWARD_VERSION, 1);
    assert.equal(COINS_PER_PLAYER_MINUTE, 2.5);
    assert.equal(MAX_EXPLORATION_MS, 18000000);
    for (const [count, ms, coins] of [[2, 20 * 60000, 100], [3, 20 * 60000, 150],
        [3, 40 * 60000, 300], [8, 60 * 60000, 1200], [16, 120 * 60000, 4800],
        [3, 300 * 60000, 2250], [16, 300 * 60000, 12000], [2, 5 * 60000, 25],
        [3, 5 * 60000, 37], [2, 0, 0], [2, 11999, 0], [2, 12000, 1]]) {
        assert.deepEqual(calculateAccountReward(count, ms), {
            version: 1, participantCount: count, explorationMs: ms, coinsPerPlayerMinute: 2.5, coinsAwarded: coins
        });
    }
    for (let count = 2; count <= 16; count++) {
        assert.equal(calculateAccountReward(count, 20 * 60000).coinsAwarded, count * 50);
        assert.equal(calculateAccountReward(count, MAX_EXPLORATION_MS, false).coinsAwarded, 0);
    }
});

test('prime RiftMon : entrées strictes et bornées, sans conversion silencieuse', () => {
    for (const count of [1, 17, 2.5, '2', null, undefined, {}, NaN, Infinity]) {
        assert.throws(() => calculateAccountReward(count, 60000), /2 et 16 participants/);
    }
    for (const duration of [-1, MAX_EXPLORATION_MS + 1, .5, '60000', null, undefined, {}, NaN, Infinity]) {
        assert.throws(() => calculateAccountReward(2, duration), /durée d’exploration/);
    }
    for (const hasWinner of [0, 1, 'true', null, {}]) {
        assert.throws(() => calculateAccountReward(2, 60000, hasWinner), /vainqueur/);
    }
});

test('prime RiftMon : fin anticipée et départs gardent l’effectif initial dans le souvenir figé', async () => {
    const f = await fixture(3, 120);
    f.advance(5 * 60000);
    assert.equal(Object.hasOwn(f.runtime.state(f.run.players.get(1)), 'report'), false);
    f.runtime.abandon(f.run.players.get(3));
    f.runtime.abandon(f.run.players.get(2));
    assert.equal(f.run.winnerId, 1);
    assert.equal(f.run.explorationMs, 5 * 60000);
    assert.equal(f.run.accountReward.participantCount, 3);
    assert.equal(f.run.accountReward.coinsAwarded, 37);
    assert.deepEqual(f.run.report.accountReward, f.run.accountReward);
    assert.ok(Object.isFrozen(f.run.report.accountReward));
    const reportBefore = JSON.stringify(f.run.report);
    f.advance(60000); f.runtime.abandon(f.run.players.get(2));
    assert.equal(JSON.stringify(f.run.report), reportBefore);
    assert.equal(Object.hasOwn(f.runtime.state(f.run.players.get(1)), 'settlement'), false,
        'un montant prévu sans repository ne devient jamais un crédit annoncé');
});

test('prime RiftMon : timer dépassé et attente du tournoi ne rapportent pas de minutes supplémentaires', async () => {
    const f = await fixture(2, 300);
    f.advance(MAX_EXPLORATION_MS + 4999);
    f.runtime.beginTournament(f.run);
    assert.equal(f.run.explorationMs, MAX_EXPLORATION_MS);
    f.advance(60 * 60000);
    f.runtime.abandon(f.run.players.get(2));
    assert.equal(f.run.accountReward.coinsAwarded, 1500);
    assert.equal(f.run.report.accountReward.explorationMs, MAX_EXPLORATION_MS);
    assert.ok(f.run.report.durationMs > MAX_EXPLORATION_MS,
        'la durée totale du souvenir reste distincte de l’exploration rémunérée');
});

test('une expédition de cinq heures traverse les deux heures sans expirer comme un salon vide', async () => {
    const f = await fixture(3, 300);
    assert.equal(f.run.endsAt - f.run.startedAt, 300 * 60000);
    f.advance(120 * 60000 + 1); f.store.sweep(); f.runtime.tick();
    assert.equal(f.run.phase, 'exploration');
    assert.equal(f.store.getLobby(f.users[0]).run, f.run);
    assert.equal(f.run.report, undefined);
    f.advance(180 * 60000 - 1); f.runtime.tick();
    assert.equal(f.run.phase, 'preparation');
    assert.equal(f.run.explorationMs, 300 * 60000);
    assert.equal(f.run.matches.filter(match => match.status === 'bye').length, 1);
});

test('prime RiftMon : un tournoi commencé conserve sa durée d’exploration sur tous les rounds', async () => {
    const f = await fixture(3);
    f.advance(20 * 60000);
    f.runtime.beginTournament(f.run);
    const semifinal = f.run.matches.find(match => match.status === 'waiting');
    f.advance(10 * 60000);
    f.runtime.abandon(f.run.players.get(semifinal.players[0]));
    assert.equal(f.run.round, 2);
    const final = f.run.matches.find(match => match.round === 2);
    f.advance(10 * 60000);
    f.runtime.abandon(f.run.players.get(final.players[0]));
    assert.equal(f.run.phase, 'results');
    assert.equal(f.run.report.durationMs, 40 * 60000);
    assert.equal(f.run.report.accountReward.explorationMs, 20 * 60000);
    assert.equal(f.run.report.accountReward.coinsAwarded, 150);
});

test('prime RiftMon : victoire immédiate et recul de l’horloge donnent zéro pièce', async () => {
    for (const elapsed of [0, -500]) {
        const f = await fixture();
        f.advance(elapsed);
        f.runtime.abandon(f.run.players.get(2));
        assert.equal(f.run.explorationMs, 0);
        assert.equal(f.run.report.accountReward.coinsAwarded, 0);
    }
});

test('prime RiftMon : les absences simultanées ne récompensent aucun faux survivant', async () => {
    for (const count of [2, 3, 5]) {
        const f = await fixture(count);
        for (const user of f.users) f.runtime.disconnect(user, { id: `s${user.id}` });
        f.advance(RECONNECT_MS); f.runtime.tick();
        assert.equal(f.run.phase, 'results');
        assert.equal(f.run.winnerId, null);
        assert.equal(f.run.report.accountReward.participantCount, count);
        assert.equal(f.run.report.accountReward.explorationMs, RECONNECT_MS);
        assert.equal(f.run.report.accountReward.coinsAwarded, 0);
    }
});

test('prime RiftMon : le résultat SQL définit le crédit confirmé, y compris un ancien règlement sans détail', async () => {
    const repository = { async recordRunStarted() { return { recorded: false }; },
        async recordRunFinished(run) { return { recorded: false, winnerId: run.winnerId, coinsAwarded: 100 }; } };
    const f = await fixture(2, 20, repository);
    f.runtime.abandon(f.run.players.get(2));
    await f.run.settling;
    assert.equal(f.run.report.accountReward.coinsAwarded, 0, 'le souvenir conserve le calcul prévu à la fin');
    assert.deepEqual(f.runtime.state(f.run.players.get(1)).settlement, { status: 'complete', coinsAwarded: 100 },
        'le crédit existant est transmis sans recalcul ni faux détail rétrospectif');
});
