const test = require('node:test'),
    assert = require('node:assert/strict'),
    { randomUUID } = require('node:crypto');
test(
    'slots MySQL: exact payouts, debit/credit idempotence, rollback, bounded receipts and offline restart settlement',
    { skip: process.env.RUN_MYSQL_TESTS !== '1' },
    async () => {
        assert.equal(process.env.DB_NAME, 'explorakit_test');
        const { dbPool: db } = require('../server/config/database'),
            users = require('../server/persistence/userRepository'),
            teams = require('../server/persistence/teamRepository'),
            repo = require('../server/persistence/casinoSlotsRepository'),
            rules = require('../server/game/casino/slots'),
            { createSlotsManager } = require('../server/realtime/casinoSlots');
        let user, manager, originalGet;
        const rng = (roll) => (n) => n === 1000000 ? roll : 0;
        const wallet = async () =>
            Number(
                (
                    await db.execute('SELECT money FROM users WHERE id=?', [
                        user.id,
                    ])
                )[0][0].money
            );
        try {
            user = await users.createUserWithStarter(
                'SlotsSQL_' + randomUUID().slice(0, 8),
                randomUUID()
            );
            await db.execute('UPDATE users SET money=2000000 WHERE id=?', [
                user.id,
            ]);
            const team = JSON.stringify(await teams.loadEquipe(user.id));
            let state = await repo.open(user.id, 1000),
                expected = 2000000,
                clock = 1000,
                firstId;
            for (const [roll, payout] of [
                [0, 0],
                [505000, 5000],
                [725000, 20000],
                [875000, 30000],
                [955000, 50000],
                [995000, 100000],
            ]) {
                const data = { id: state.nextId, machine: 1, amount: 10000 };
                firstId ||= data.id;
                let draws = 0;
                const results = await Promise.all(
                    [0, 1, 2].map(() =>
                        repo.start(user.id, data, clock, (n) => {
                            draws++;
                            return rng(roll)(n);
                        })
                    )
                );
                assert.equal(results.filter((r) => !r.duplicate).length, 1);
                state = results[0];
                assert.equal(state.spin.phase, 'spinning');
                assert.equal(state.spin.payout, undefined);
                expected -= 10000;
                assert.equal(await wallet(), expected);
                assert(draws > 0);
                const dupe = await repo.start(user.id, data, clock, () => {
                    throw Error('RNG must not be repeated');
                });
                assert(dupe.duplicate);
                await assert.rejects(
                    repo.start(user.id, { ...data, amount: 10001 }, clock),
                    /confirmation/
                );
                await assert.rejects(
                    repo.start(user.id, { ...data, id: randomUUID() }, clock),
                    /tirage/
                );
                assert.equal(
                    (await repo.settle(user.id, state.spin.resultAt - 1))
                        .settled,
                    false
                );
                assert.equal(await wallet(), expected);
                clock = state.spin.resultAt;
                const settled = await Promise.all([
                    repo.settle(user.id, clock),
                    repo.settle(user.id, clock),
                ]);
                assert.equal(settled.filter((r) => r.settled).length, 1);
                state = settled[0];
                assert.equal(state.spin.payout, payout);
                expected += payout;
                assert.equal(await wallet(), expected);
                assert((await repo.start(user.id, data, clock)).duplicate);
                clock += 100;
            }
            await assert.rejects(
                repo.start(
                    user.id,
                    { id: firstId, machine: 1, amount: 10000 },
                    clock
                ),
                /expiré/
            );
            assert.equal(await wallet(), expected);
            const current = await repo.read(user.id);
            await assert.rejects(
                repo.start(
                    user.id,
                    { id: state.nextId, machine: 1, amount: 10000 },
                    clock,
                    () => {
                        throw Error('entropy fault');
                    }
                ),
                /entropy fault/
            );
            assert.equal(await wallet(), expected);
            assert.deepEqual(await repo.read(user.id), current);
            // Inject a failure after the real wallet debit and before the session write.
            originalGet = db.getConnection.bind(db);
            db.getConnection = async () => {
                const c = await originalGet(),
                    execute = c.execute,
                    release = c.release;
                c.execute = function (sql, args) {
                    if (sql.startsWith('UPDATE casino_slot_sessions'))
                        return Promise.reject(Error('receipt write fault'));
                    return execute.call(this, sql, args);
                };
                c.release = function () {
                    this.execute = execute;
                    this.release = release;
                    return release.call(this);
                };
                return c;
            };
            await assert.rejects(
                repo.start(
                    user.id,
                    { id: state.nextId, machine: 1, amount: 10000 },
                    clock,
                    rng(995000)
                ),
                /receipt write fault/
            );
            db.getConnection = originalGet;
            assert.equal(await wallet(), expected);
            assert.deepEqual(await repo.read(user.id), current);
            const pending = await repo.start(
                user.id,
                { id: state.nextId, machine: 2, amount: 10000 },
                clock,
                rng(995000)
            );
            expected -= 10000;
            manager = createSlotsManager({ now: () => clock, tickMs: 0 });
            await manager.ready;
            assert(manager.pending.has(user.id));
            await manager.stop();
            manager = createSlotsManager({ now: () => clock, tickMs: 0 });
            await manager.ready;
            clock = pending.spin.resultAt;
            await manager.tick();
            expected += 100000;
            assert.equal(await wallet(), expected);
            assert.equal(manager.pending.size, 0);
            await manager.tick();
            assert.equal(await wallet(), expected);
            assert.equal((await repo.read(user.id)).settle_at, null);
            const [[count]] = await db.execute(
                'SELECT COUNT(*) n FROM casino_slot_sessions WHERE user_id=?',
                [user.id]
            );
            assert.equal(Number(count.n), 1);
            assert.equal(JSON.stringify(await teams.loadEquipe(user.id)), team);
            await db.execute('UPDATE users SET money=99 WHERE id=?', [user.id]);
            state = await repo.open(user.id, clock);
            await assert.rejects(
                repo.start(
                    user.id,
                    { id: state.nextId, machine: 1, amount: 100 },
                    clock
                ),
                /assez/
            );
            assert.equal(await wallet(), 99);
        } finally {
            if (originalGet) db.getConnection = originalGet;
            await manager?.stop();
            if (user)
                await db.execute('DELETE FROM users WHERE id=?', [user.id]);
            await db.end();
        }
    }
);
