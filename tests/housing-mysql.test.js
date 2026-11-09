const test = require('node:test'),
    assert = require('node:assert/strict'),
    { randomUUID } = require('node:crypto');
test(
    'Housing SQL: purchases, replay receipts, revisions, floor limits, stock conservation and persistent private visits',
    { skip: process.env.RUN_MYSQL_TESTS !== '1' },
    async () => {
        assert.equal(process.env.DB_NAME, 'explorakit_test');
        const { dbPool: db } = require('../server/config/database'),
            users = require('../server/persistence/userRepository'),
            repo = require('../server/persistence/housingRepository'),
            entries = require('../server/game/housing/entries').entries,
            social = require('../server/persistence/trainerRepository'),
            teams = require('../server/persistence/teamRepository');
        const ids = [];
        const request = (h, p) => ({
            ...p,
            requestId: randomUUID(),
            revision: h.revision,
        });
        try {
            for (let i = 0; i < 3; i++) {
                const u = await users.createUserWithStarter(
                    'HousingSQL_' + randomUUID().slice(0, 8),
                    randomUUID()
                );
                ids.push(u.id);
                await db.execute('UPDATE users SET money=20000000 WHERE id=?', [
                    u.id,
                ]);
            }
            const [a, b, g] = ids,
                before = JSON.stringify(await teams.loadEquipe(a));
            let home = await repo.read(a);
            assert.equal(home.entryKey, null);
            const buy = request(home, { key: 'chair', quantity: 5 }),
                first = await repo.furniture(a, buy);
            home = first.home;
            assert.equal(first.money, 19980000);
            assert.equal(home.inventory.chair, 5);
            assert.equal((await repo.furniture(a, buy)).duplicate, true);
            assert.equal(await repo.wallet(a), first.money);
            await assert.rejects(
                repo.furniture(a, { ...buy, quantity: 6 }),
                /confirmation/
            );
            const race = await Promise.allSettled([
                repo.purchase(
                    a,
                    request(home, { entryKey: entries[0].key, model: 'nid' })
                ),
                repo.purchase(
                    a,
                    request(home, { entryKey: entries[1].key, model: 'nid' })
                ),
            ]);
            assert.equal(
                race.filter((r) => r.status === 'fulfilled').length,
                1
            );
            home = await repo.read(a);
            assert.equal(await repo.wallet(a), 18980000);
            const get = (
                await repo.purchase(
                    b,
                    request(await repo.read(b), {
                        entryKey: home.entryKey,
                        model: 'nid',
                    })
                )
            ).home;
            assert.equal(get.entryKey, home.entryKey);
            assert.notEqual(get.ownerId, home.ownerId);
            const f = structuredClone(home.floors[0]);
            f.placements = [{ id: randomUUID(), key: 'chair', x: 10, y: 10 }];
            const save = request(home, { floor: 0, layout: f }),
                saved = await repo.saveFloor(a, save);
            home = saved.home;
            assert.equal((await repo.saveFloor(a, save)).duplicate, true);
            assert.equal(home.inventory.chair, 5);
            let stored = structuredClone(home.floors[0]);
            stored.placements = [];
            home = (
                await repo.saveFloor(
                    a,
                    request(home, { floor: 0, layout: stored })
                )
            ).home;
            assert.equal(home.inventory.chair, 5);
            await assert.rejects(
                repo.saveFloor(
                    a,
                    request(home, {
                        floor: 0,
                        layout: {
                            ...stored,
                            placements: [
                                { id: randomUUID(), key: 'sofa', x: 10, y: 10 },
                            ],
                        },
                    })
                ),
                /assez/
            );
            assert.equal((await repo.read(a)).revision, home.revision);
            for (const model of ['atelier', 'loft'])
                home = (await repo.addFloor(a, request(home, { model }))).home;
            assert.equal(home.floors.length, 3);
            await assert.rejects(
                repo.addFloor(a, request(home, { model: 'nid' })),
                /Trois/
            );
            await social.friendAction(a, g, 'request');
            await social.friendAction(g, a, 'accept');
            const origin = { map: 'route3', x: 144, y: 368 };
            const visit = await repo.enter(g, a, 0, origin);
            assert.equal(visit.home.ownerId, a);
            await repo.floor(g, 2, { x: 400, y: 400 });
            let restored = await repo.restore(
                g,
                { map: 'housing_loft', x: 400, y: 400 },
                true
            );
            assert.equal(restored.visit.floor, 2);
            assert.equal(restored.position.x, 400);
            assert.deepEqual(await repo.leave(g), origin);
            assert.equal((await repo.visit(g)).inside, false);
            await assert.rejects(repo.enter(b, a, 0, origin), /ami/);
            await repo.enter(g, a, 0, origin);
            restored = await repo.restore(
                g,
                { map: 'housing_nid', x: 400, y: 400 },
                false
            );
            assert.deepEqual(restored.position, origin);
            assert.equal((await repo.visit(g)).inside, false);
            assert.equal(JSON.stringify(await teams.loadEquipe(a)), before);
            const revisions = await repo.read(a),
                wallet = await repo.wallet(a);
            await db.execute('UPDATE users SET money=1 WHERE id=?', [a]);
            await assert.rejects(
                repo.furniture(
                    a,
                    request(revisions, { key: 'plant', quantity: 1 })
                ),
                /assez de Poké/
            );
            assert.deepEqual(await repo.read(a), revisions);
            await db.execute('UPDATE users SET money=? WHERE id=?', [
                wallet,
                a,
            ]);
        } finally {
            for (const id of ids)
                await db.execute('DELETE FROM users WHERE id=?', [id]);
            await db.end();
        }
    }
);
