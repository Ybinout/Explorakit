const test = require('node:test'),
    assert = require('node:assert/strict'),
    { randomUUID } = require('node:crypto');
test(
    'housing SQL: four orientations, recorded price, atomic sale rollback/replay, guests and retained stock on repurchase',
    { skip: process.env.RUN_MYSQL_TESTS !== '1' },
    async () => {
        assert.equal(process.env.DB_NAME, 'explorakit_test');
        const { dbPool: db } = require('../server/config/database'),
            users = require('../server/persistence/userRepository'),
            repo = require('../server/persistence/housingRepository'),
            rules = require('../server/game/housing/rules'),
            entries = require('../server/game/housing/entries'),
            teams = require('../server/persistence/teamRepository'),
            social = require('../server/persistence/trainerRepository'),
            flight = require('../server/persistence/flightRepository');
        const ids = [],
            request = (h, p) => ({
                ...p,
                revision: h.revision,
                requestId: randomUUID(),
            }),
            trigger = 'test_housing_sale_rollback';
        try {
            for (let n = 0; n < 2; n++) {
                const u = await users.createUserWithStarter(
                    'HousePolish_' + randomUUID().slice(0, 8),
                    randomUUID()
                );
                ids.push(u.id);
                await db.execute('UPDATE users SET money=20000000 WHERE id=?', [
                    u.id,
                ]);
            }
            const [id, guest] = ids,
                before = JSON.stringify(await teams.loadEquipe(id));
            let h = await repo.read(id);
            h = (
                await repo.purchase(
                    id,
                    request(h, {
                        entryKey: entries.entries[0].key,
                        model: 'nid',
                    })
                )
            ).home;
            assert.equal(h.floors[0].purchasePrice, 1000000);
            assert.equal(
                (await flight.loadFlightState(id)).house.entryKey,
                h.entryKey
            );
            for (const key of ['bed', 'pokemon_pc', 'healing_station'])
                h = (await repo.furniture(id, request(h, { key, quantity: 1 })))
                    .home;
            h = (await repo.addFloor(id, request(h, { model: 'atelier' })))
                .home;
            let layout = structuredClone(h.floors[1]);
            layout.placements = [
                { id: randomUUID(), key: 'bed', x: 11, y: 12, rotation: 90 },
                {
                    id: randomUUID(),
                    key: 'pokemon_pc',
                    x: 17,
                    y: 9,
                    rotation: 180,
                },
                {
                    id: randomUUID(),
                    key: 'healing_station',
                    x: 17,
                    y: 12,
                    rotation: 270,
                },
            ];
            layout.purchasePrice = 999999999;
            h = (await repo.saveFloor(id, request(h, { floor: 1, layout })))
                .home;
            assert.equal(h.floors[1].purchasePrice, 1200000);
            assert.deepEqual(
                (await repo.read(id)).floors[1].placements.map(
                    (p) => p.rotation
                ),
                [90, 180, 270]
            );
            const stock = structuredClone(h.inventory),
                money = await repo.wallet(id);
            assert.equal(repo.saleQuote(h), 1760000);
            await assert.rejects(
                repo.sell(id, request(h, { refund: 1760000 })),
                /Entre/
            );
            await repo.enter(
                id,
                id,
                0,
                entries.outside(entries.get(h.entryKey))
            );
            await social.friendAction(id, guest, 'request');
            await social.friendAction(guest, id, 'accept');
            const origin = { map: 'route3', x: 144, y: 368 };
            await repo.enter(guest, id, 1, origin);
            await assert.rejects(
                repo.sell(guest, request(h, { refund: 1760000 })),
                /maison/
            );
            await assert.rejects(
                repo.sell(id, request(h, { refund: 800000 })),
                /prix/
            );
            assert.equal(await repo.wallet(id), money);
            const payload = request(h, { refund: 1760000 });
            await db.query(
                `CREATE TRIGGER ${trigger} BEFORE UPDATE ON housing_profiles FOR EACH ROW BEGIN IF OLD.user_id=${id} AND NEW.entry_key IS NULL THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='fixture sale rollback'; END IF; END`
            );
            await assert.rejects(
                repo.sell(id, payload),
                /fixture sale rollback/
            );
            assert.equal(await repo.wallet(id), money);
            assert.equal((await repo.visit(guest)).inside, true);
            assert.equal((await repo.read(id)).entryKey, h.entryKey);
            await db.query(`DROP TRIGGER ${trigger}`);
            const settled = await Promise.all([
                repo.sell(id, payload),
                repo.sell(id, payload),
                repo.sell(id, payload),
            ]);
            assert.equal(settled.filter((r) => r.duplicate).length, 2);
            assert.equal(await repo.wallet(id), money + 1760000);
            for (const r of settled) {
                assert.equal(r.home.entryKey, null);
                assert.deepEqual(r.home.floors, []);
                assert.deepEqual(r.home.inventory, stock);
            }
            assert.equal((await flight.loadFlightState(id)).house, null);
            assert.equal((await repo.visit(guest)).inside, false);
            assert.equal((await repo.visit(id)).inside, false);
            const [[g]] = await db.execute(
                'SELECT map,x,y FROM users WHERE id=?',
                [guest]
            );
            assert.deepEqual(g, origin);
            await assert.rejects(
                repo.sell(id, { ...payload, refund: 999999 }),
                /confirmation/
            );
            h = (
                await repo.purchase(
                    id,
                    request(await repo.read(id), {
                        entryKey: entries.entries[1].key,
                        model: 'atelier',
                    })
                )
            ).home;
            assert.deepEqual(h.inventory, stock);
            assert.equal(h.floors[0].placements.length, 0);
            assert.equal(
                (await flight.loadFlightState(id)).house.entryKey,
                h.entryKey
            );
            const after = JSON.stringify(await teams.loadEquipe(id));
            assert.equal(after, before);
        } finally {
            await db.query(`DROP TRIGGER IF EXISTS ${trigger}`);
            for (const id of ids)
                await db.execute('DELETE FROM users WHERE id=?', [id]);
            await db.end();
        }
    }
);
