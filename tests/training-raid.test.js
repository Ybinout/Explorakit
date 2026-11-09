const test = require('node:test'),
    assert = require('node:assert/strict');
const training = require('../server/game/raids/training'),
    content = require('../server/game/raids/content'),
    codec = require('../server/game/drift/checkpointCodec'),
    factory = require('../server/game/drift/pokemonFactory'),
    { RaidBattle } = require('../server/game/raids/RaidBattle');
test('training boss catalog validates inputs and preserves native stats through level1000', () => {
    assert.equal(training.catalog.length, 298);
    for (const [id, level] of [
        [0, 100],
        [248, 99],
        [248, 1001],
        [248, 100.5],
        ['248', 100],
    ])
        assert.throws(() => training.validate(id, level));
    for (const level of [100, 555, 1000]) {
        training.validate(248, level);
        const boss = content.bossFor({
                training: true,
                bossSpecies: 248,
                level,
                seed: 'test',
            }),
            party = Array.from({ length: 4 }, () => ({
                ownerId: 1,
                pokemon: factory.create(9, 100, true),
            }));
        const b = new RaidBattle(party, boss, {
            now: () => 1000,
            seed: [1, 2, 3, 4],
        });
        assert.equal(b.bossPokemon.level, level);
        assert.equal(b.bossPokemon.maxhp, boss.maxHp * 6);
        assert.equal(
            require('../server/game/raids/lossPolicy').permanentDeaths({
                training: true,
                map: 'ville5_maison1',
            }),
            false
        );
    }
});
test('training checkpoints and manager resume leave original team untouched and world cooldowns unchanged', async () => {
    const { createRaidManager } = require('../server/realtime/raidManager');
    let time = Date.parse('2026-11-09T12:00:00Z'),
        saved,
        world = content.createDay(time),
        after = 0;
    const original = {
            pokemons: Array.from({ length: 4 }, () =>
                factory.create(9, 100, true)
            ),
        },
        before = codec.encode(original),
        packets = [];
    const player = {
        currentmap: training.MAP,
        x: 432,
        y: 432,
        equipe: original,
    };
    const store = {
        world: async () => world,
        saveWorld: async () => {},
        loadActive: async () => (saved ? [codec.decode(saved)] : []),
        tutorialSeen: async () => true,
        member: async (id, name) => ({
            id,
            name,
            team: codec.decode(before),
            selected: [],
            ready: false,
        }),
        save: async (r) => {
            const next = r.version + 1;
            saved = codec.encode({ ...r, version: next });
            return next;
        },
    };
    const ctx = {
        id: 991,
        username: 'Training',
        socket: { connected: true, emit: (...p) => packets.push(p) },
        getPlayer: () => player,
        supported: true,
        canUse: () => true,
        afterFinish: () => after++,
    };
    let m = createRaidManager({ store, tickMs: 0, now: () => time });
    await m.ready;
    await m.attach(ctx);
    try {
        await assert.rejects(
            () => m.createTraining(991, { bossId: 248, level: 1001 }),
            /niveau/
        );
        const r = await m.createTraining(991, { bossId: 248, level: 1000 });
        assert(r.rift.training);
        assert.equal(r.rift.reward.money, 0);
        assert.equal(r.rift.reward.experiencePerPokemon, 0);
        const uuids = m.inventory(991).map((p) => p.uuid);
        await m.select(991, { uuids });
        await m.readyPlayer(991);
        await m.start(991);
        assert.strictEqual(player.equipe, original);
        assert.deepEqual(
            codec.decode(codec.encode(original)),
            codec.decode(before)
        );
        const snapshot = JSON.stringify(m.view(991).combat);
        await m.stop();
        m = createRaidManager({ store, tickMs: 0, now: () => time });
        await m.ready;
        await m.attach(ctx);
        assert.equal(JSON.stringify(m.view(991).combat), snapshot);
        // Deadline resolves through the native simulator; four withdrawals end training.
        for (let i = 0; i < 8 && m.view(991)?.phase === 'active'; i++) {
            time += 120000;
            await m.tick();
        }
        assert.equal(m.view(991).phase, 'lost');
        assert.equal(after, 0);
        assert.deepEqual(
            codec.decode(codec.encode(original)),
            codec.decode(before)
        );
        assert.equal(player.raidActive, false);
        assert(!world.rifts.some((r) => r.closedUntil));
    } finally {
        await m.stop();
    }
});
