const test = require('node:test'),
    assert = require('node:assert/strict'),
    { randomUUID } = require('node:crypto');
const enabled = process.env.RUN_MYSQL_TESTS === '1';
let db, repo, users, teams, codec;
const accounts = [],
    tables = [];
test.before(() => {
    if (!enabled) return;
    assert.equal(process.env.DB_NAME, 'explorakit_test');
    db = require('../server/config/database').dbPool;
    repo = require('../server/persistence/draftRepository');
    users = require('../server/persistence/userRepository');
    teams = require('../server/persistence/teamRepository');
    codec = require('../server/game/drift/checkpointCodec');
});
test.after(async () => {
    if (!enabled) return;
    for (const id of tables)
        await db.execute('DELETE FROM draft_tables WHERE id=?', [id]);
    for (const id of accounts)
        await db.execute('DELETE FROM users WHERE id=?', [id]);
    await db.end();
});
async function fixture() {
    const seats = [];
    for (let i = 0; i < 4; i++) {
        const u = await users.createUserWithStarter(
            'DraftSQL_' + randomUUID().slice(0, 10),
            randomUUID()
        );
        accounts.push(u.id);
        await db.execute('UPDATE users SET money=1000 WHERE id=?', [u.id]);
        seats.push({
            index: i,
            userId: u.id,
            rank: i === 0 ? 1 : i === 1 ? 2 : 3,
            left: false,
            eliminated: false,
            plan: null,
            collection: [],
        });
    }
    const id = randomUUID();
    tables.push(id);
    return {
        id,
        phase: 'lobby',
        version: 0,
        seats,
        cards: new Map(),
        matches: [],
    };
}
async function balances(r) {
    const rows = [];
    for (const s of r.seats) {
        const [[u]] = await db.execute('SELECT money FROM users WHERE id=?', [
            s.userId,
        ]);
        rows.push(Number(u.money));
    }
    return rows;
}
test(
    'SQL Draft pays 150k/50k exactly once, preserves permanent teams/items, and releases membership',
    { skip: !enabled },
    async () => {
        const r = await fixture(),
            before = await Promise.all(
                r.seats.map((s) =>
                    teams.loadEquipe(s.userId).then((t) => codec.encode(t))
                )
            );
        r.version = (await repo.save(r)).version;
        await assert.rejects(
            require('../server/persistence/darkBattleRepository').assertInactive(
                r.seats[0].userId
            ),
            /draft/
        );
        r.phase = 'finished';
        r.version = (await repo.save(r, r.version)).version;
        assert.deepEqual(await balances(r), [151000, 51000, 1000, 1000]);
        r.version = (await repo.save(r, r.version)).version;
        assert.deepEqual(await balances(r), [151000, 51000, 1000, 1000]);
        for (let i = 0; i < 4; i++)
            assert(
                before[i].equals(
                    codec.encode(await teams.loadEquipe(r.seats[i].userId))
                )
            );
        const [members] = await db.execute(
            'SELECT * FROM draft_members WHERE table_id=?',
            [r.id]
        );
        assert.equal(members.length, 0);
        const [receipts] = await db.execute(
            'SELECT * FROM draft_rewards WHERE table_id=?',
            [r.id]
        );
        assert.equal(receipts.length, 4);
    }
);
test(
    'SQL concurrent settlements admit one version and a snapshot failure rolls the wallet and receipts back',
    { skip: !enabled },
    async () => {
        const r = await fixture();
        r.version = (await repo.save(r)).version;
        r.phase = 'finished';
        const copy = codec.decode(codec.encode(r)),
            encode = codec.encodeAsync;
        try {
            codec.encodeAsync = async () => {
                throw Error('snapshot fault');
            };
            await assert.rejects(repo.save(r, r.version), /snapshot fault/);
        } finally {
            codec.encodeAsync = encode;
        }
        assert.deepEqual(await balances(r), [1000, 1000, 1000, 1000]);
        assert.equal(
            (
                await db.execute(
                    'SELECT * FROM draft_rewards WHERE table_id=?',
                    [r.id]
                )
            )[0].length,
            0
        );
        r.version = copy.version;
        const results = await Promise.allSettled([
            repo.save(r, r.version),
            repo.save(copy, copy.version),
        ]);
        assert.equal(results.filter((x) => x.status === 'fulfilled').length, 1);
        assert.deepEqual(await balances(r), [151000, 51000, 1000, 1000]);
    }
);
test(
    'SQL membership prevents the same account occupying two tables and forfeits never pay',
    { skip: !enabled },
    async () => {
        const r = await fixture();
        r.version = (await repo.save(r)).version;
        const duplicate = { ...r, id: randomUUID(), version: 0 };
        tables.push(duplicate.id);
        await assert.rejects(repo.save(duplicate), /déjà/);
        assert.equal(
            (
                await db.execute('SELECT * FROM draft_tables WHERE id=?', [
                    duplicate.id,
                ])
            )[0].length,
            0
        );
        r.phase = 'finished';
        r.seats[0].forfeited = true;
        await repo.save(r, r.version);
        assert.deepEqual(await balances(r), [1000, 51000, 1000, 1000]);
    }
);
