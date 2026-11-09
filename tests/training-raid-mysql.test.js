const test = require('node:test'),
    assert = require('node:assert/strict'),
    { randomUUID } = require('node:crypto');
const { RaidBattle } = require('../server/game/raids/RaidBattle');
const enabled = process.env.RUN_MYSQL_TESTS === '1';
let db, repo, users, teams, factory, codec;
const ids = [],
    runs = [];
test.before(() => {
    if (!enabled) return;
    assert.equal(process.env.DB_NAME, 'explorakit_test');
    db = require('../server/config/database').dbPool;
    repo = require('../server/persistence/raidRepository');
    users = require('../server/persistence/userRepository');
    teams = require('../server/persistence/teamRepository');
    factory = require('../server/game/drift/pokemonFactory');
    codec = require('../server/game/drift/checkpointCodec');
});
test.after(async () => {
    if (!enabled) return;
    for (const id of runs)
        await db.execute('DELETE FROM corruption_raids WHERE id=?', [id]);
    for (const id of ids)
        await db.execute('DELETE FROM users WHERE id=?', [id]);
    await db.end();
});
test(
    'training persists combat+consumption+KO, resumes and settles exactly once with zero permanent writes',
    { skip: !enabled },
    async () => {
        const u = await users.createUserWithStarter(
            'Train_' + randomUUID().slice(0, 8),
            randomUUID()
        );
        ids.push(u.id);
        const pokemons = Array.from({ length: 4 }, () =>
            factory.create(9, 123, true)
        );
        pokemons[0].heldItem = 'sitrus_berry';
        pokemons[0].currentHp -= 3;
        await teams.editEquipe(u.id, { pokemons });
        const before = JSON.stringify((await teams.loadEquipe(u.id)).pokemons),
            [wallet] = await db.execute('SELECT money FROM users WHERE id=?', [
                u.id,
            ]),
            [bag] = await db.execute(
                'SELECT * FROM user_items WHERE user_id=?',
                [u.id]
            );
        const member = await repo.member(u.id, u.username),
            boss = require('../server/game/raids/content').bossFor({
                training: true,
                bossSpecies: 248,
                level: 1000,
                seed: 'sql',
            });
        member.selected = member.team.pokemons.map((p) => p.uuid);
        member.ready = true;
        const b = new RaidBattle(
            member.team.pokemons.map((p) => ({ ownerId: u.id, pokemon: p })),
            boss,
            { now: () => 1000, seed: [1, 2, 3, 4] }
        );
        b.sim.p1.active[0].setItem('sitrusberry');
        b.sim.p1.active[0].eatItem();
        b.sim.p1.active[1].hp = 0;
        b.applyModels();
        const run = {
            id: randomUUID(),
            version: 0,
            phase: 'active',
            hostId: u.id,
            members: [member],
            rift: {
                id: 'training:test',
                training: true,
                map: 'ville5_maison1',
                difficulty: 'training',
                bossSpecies: 248,
                level: 1000,
                seed: 'sql',
            },
            combat: b.snapshot(),
            expiresAt: 9999999999999,
        };
        runs.push(run.id);
        run.version = await repo.save(run);
        assert.equal(
            JSON.stringify((await teams.loadEquipe(u.id)).pokemons),
            before
        );
        const restored = (await repo.loadActive()).find((r) => r.id === run.id);
        assert.equal(restored.rift.level, 1000);
        const copy = RaidBattle.restore(restored.combat, () => 1000);
        assert.equal(copy.sim.p1.active[1].hp, 0);
        assert.equal(copy.sim.p1.active[0].item, '');
        for (const won of [false, true]) {
            run.phase = won ? 'won' : 'lost';
            run.won = won;
            run.version = await repo.save(run, { settle: true });
            run.version = await repo.save(run, { settle: true });
            assert.equal(
                JSON.stringify((await teams.loadEquipe(u.id)).pokemons),
                before
            );
        }
        assert.deepEqual(
            (await db.execute('SELECT money FROM users WHERE id=?', [u.id]))[0],
            wallet
        );
        assert.deepEqual(
            (
                await db.execute('SELECT * FROM user_items WHERE user_id=?', [
                    u.id,
                ])
            )[0],
            bag
        );
        assert.equal(
            (
                await db.execute(
                    'SELECT * FROM corruption_raid_rewards WHERE raid_id=?',
                    [run.id]
                )
            )[0].length,
            0
        );
        const prior = run.version;
        await assert.rejects(
            () => repo.save(run, { expected: prior - 1 }),
            /actualisé/
        );
        assert.equal(
            JSON.stringify((await teams.loadEquipe(u.id)).pokemons),
            before
        );
    }
);
test(
    'four friends share native training preparation, reset confirmations and resume without Dark Continent access',
    { skip: !enabled },
    async () => {
        const { createRaidManager } = require('../server/realtime/raidManager'),
            social = require('../server/persistence/trainerRepository');
        const contexts = [],
            originals = [];
        let time = Date.parse('2026-11-09T12:00:00Z'),
            finishCalls = 0;
        let manager = createRaidManager({ tickMs: 0, now: () => time });
        await manager.ready;
        try {
            for (let i = 0; i < 4; i++) {
                const u = await users.createUserWithStarter(
                    'TrainFriend_' + randomUUID().slice(0, 8),
                    randomUUID()
                );
                ids.push(u.id);
                await teams.editEquipe(u.id, {
                    pokemons: [
                        factory.create(9, 200, true),
                        factory.create(6, 200, true),
                    ],
                });
                const team = await teams.loadEquipe(u.id);
                originals.push(JSON.stringify(team.pokemons));
                const player = {
                    currentmap: 'ville5_maison1',
                    x: 400 + i * 32,
                    y: 480,
                    equipe: team,
                };
                contexts.push({
                    id: u.id,
                    username: u.username,
                    supported: true,
                    socket: { connected: true, emit: () => {} },
                    getPlayer: () => player,
                    canUse: () => true,
                    travel: async (d) =>
                        Object.assign(player, {
                            currentmap: d.map,
                            x: d.x,
                            y: d.y,
                        }),
                    afterFinish: () => finishCalls++,
                });
                await manager.attach(contexts[i]);
                if (i) {
                    await social.friendAction(contexts[0].id, u.id, 'request');
                    await social.friendAction(u.id, contexts[0].id, 'accept');
                }
            }
            const host = contexts[0].id,
                r = await manager.createTraining(host, {
                    bossId: 609,
                    level: 400,
                });
            runs.push(r.id);
            for (let i = 1; i < 4; i++) {
                const inv = await manager.invite(host, contexts[i].id);
                assert(inv.rift.training);
                await manager.accept(contexts[i].id, inv.id, true);
            }
            for (const c of contexts) {
                assert.equal(manager.view(c.id).members.length, 4);
                assert(manager.view(c.id).members.every((m) => m.quota === 1));
                await manager.select(c.id, {
                    uuids: [manager.inventory(c.id)[0].uuid],
                });
                await manager.readyPlayer(c.id);
            }
            // A changed selection resets everybody's ready flag.
            await manager.select(host, {
                uuids: [manager.inventory(host)[1].uuid],
            });
            assert(manager.view(host).members.every((m) => !m.ready));
            for (const c of contexts) await manager.readyPlayer(c.id);
            await manager.start(host);
            assert(contexts.every((c) => manager.view(c.id).combat));
            const deadline = manager.view(host).combat.deadline;
            await manager.stop();
            manager = createRaidManager({ tickMs: 0, now: () => time });
            await manager.ready;
            for (const c of contexts) await manager.attach(c);
            assert.equal(manager.view(host).combat.deadline, deadline);
            for (
                let i = 0;
                i < 8 && manager.view(host).phase === 'active';
                i++
            ) {
                time += 120000;
                await manager.tick();
            }
            assert.equal(manager.view(host).phase, 'lost');
            assert.equal(finishCalls, 0);
            for (let i = 0; i < 4; i++) {
                assert.equal(
                    JSON.stringify(
                        (await teams.loadEquipe(contexts[i].id)).pokemons
                    ),
                    originals[i]
                );
                assert.equal(
                    JSON.stringify(contexts[i].getPlayer().equipe.pokemons),
                    originals[i]
                );
                await manager.leave(contexts[i].id);
            }
        } finally {
            await manager.stop();
        }
    }
);
