const test = require('node:test'),
    assert = require('node:assert/strict'),
    http = require('node:http'),
    { once } = require('node:events'),
    { randomUUID } = require('node:crypto');
test(
    'slot sockets: startup pays overdue spins without players, private authorization and disconnected settlement',
    { skip: process.env.RUN_MYSQL_TESTS !== '1' },
    async () => {
        assert.equal(process.env.DB_NAME, 'explorakit_test');
        process.env.NODE_ENV = 'test';
        const { dbPool: db } = require('../server/config/database'),
            users = require('../server/persistence/userRepository'),
            repo = require('../server/persistence/casinoSlotsRepository'),
            rules = require('../server/game/casino/slots'),
            slots = require('../server/realtime/casinoSlots'),
            {
                io: client,
            } = require('../vue-explorakit/node_modules/socket.io-client');
        const accounts = [],
            sockets = [];
        let io, server, manager;
        const event = (s, name) =>
            new Promise((resolve, reject) => {
                const timer = setTimeout(
                    () => reject(Error('Missing ' + name)),
                    10000
                );
                s.once(name, (data) => {
                    clearTimeout(timer);
                    resolve(data);
                });
            });
        const rpc = (s, name, p = {}) =>
            new Promise((resolve, reject) =>
                s
                    .timeout(10000)
                    .emit('slots:' + name, p, (e, r) =>
                        e ? reject(e) : resolve(r)
                    )
            );
        async function connect(user, supported = true) {
            const s = client('http://127.0.0.1:' + server.address().port, {
                auth: {
                    token: require('../server/config/auth').signAccessToken(
                        user
                    ),
                    casinoSlots: supported ? 1 : 0,
                },
                forceNew: true,
                reconnection: false,
                autoConnect: false,
                transports: ['websocket'],
            });
            sockets.push(s);
            const ready = event(s, 'playersList');
            s.connect();
            await ready;
            return s;
        }
        async function money(id) {
            return Number(
                (
                    await db.execute('SELECT money FROM users WHERE id=?', [id])
                )[0][0].money
            );
        }
        try {
            for (let i = 0; i < 2; i++) {
                const u = await users.createUserWithStarter(
                    'SlotsNet_' + randomUUID().slice(0, 8),
                    randomUUID()
                );
                accounts.push(u);
                await db.execute(
                    "UPDATE users SET money=100000,map='ville5_maison2',x=112,y=272 WHERE id=?",
                    [u.id]
                );
                await db.execute(
                    "INSERT INTO player_story_flags(user_id,flag_key,flag_value)VALUES(?,'adventure_opening','complete')ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)",
                    [u.id]
                );
            }
            let state = await repo.open(accounts[0].id);
            await repo.start(
                accounts[0].id,
                { id: state.nextId, machine: 1, amount: 10000 },
                Date.now() - 5000,
                (n) => (n === 1000000 ? 995000 : 0)
            );
            server = http.createServer();
            io = new (require('socket.io').Server)(server);
            io.use(require('../server/http/authMiddleware').authenticateSocket);
            require('../server/realtime/socketHandler')(io);
            server.listen(0, '127.0.0.1');
            await once(server, 'listening');
            manager = slots.getSlotsManager(io);
            await manager.ready;
            for (
                let i = 0;
                i < 100 && (await repo.read(accounts[0].id)).settle_at !== null;
                i++
            )
                await new Promise((r) => setTimeout(r, 20));
            assert.equal(await money(accounts[0].id), 190000);
            assert.equal((await repo.read(accounts[0].id)).settle_at, null);
            const a = await connect(accounts[0]),
                b = await connect(accounts[1], false);
            assert.equal((await rpc(b, 'refresh')).success, false);
            const panel = event(a, 'slots:open');
            a.emit('Space');
            state = (await panel).state;
            assert.equal(state.spin.payout, 100000);
            const bad = await rpc(a, 'spin', {
                id: randomUUID(),
                machine: 1,
                amount: 1000,
            });
            assert.equal(bad.success, false);
            assert.equal(await money(accounts[0].id), 190000);
            const r = await rpc(a, 'spin', {
                id: state.nextId,
                machine: 1,
                amount: 1000,
                kind: 'seven',
                payout: 999999999,
                symbols: ['seven', 'seven', 'seven'],
            });
            assert(r.success, r.message);
            assert.equal(await money(accounts[0].id), 189000);
            const stored = await repo.read(accounts[0].id),
                snapshot =
                    typeof stored.snapshot === 'string'
                        ? JSON.parse(stored.snapshot)
                        : stored.snapshot;
            assert.equal(snapshot.payout, undefined);
            assert.equal(snapshot.amount, 1000);
            assert.equal(
                (
                    await rpc(b, 'spin', {
                        id: r.state.spin.id,
                        machine: 1,
                        amount: 1000,
                    })
                ).success,
                false
            );
            assert.equal(await money(accounts[1].id), 100000);
            const duplicate = await rpc(a, 'spin', {
                id: r.state.spin.id,
                machine: 1,
                amount: 1000,
            });
            assert(duplicate.success && duplicate.state.duplicate);
            a.close();
            b.close();
            await require('../server/realtime/accountConnection').waitForAccountConnections(
                io
            );
            await new Promise((resolve) =>
                setTimeout(
                    resolve,
                    Math.max(0, snapshot.resultAt - Date.now() + 400)
                )
            );
            assert.equal((await repo.read(accounts[0].id)).settle_at, null);
            assert.equal(
                await money(accounts[0].id),
                189000 + rules.reward(1000, snapshot.kind)
            );
            const re = await connect(accounts[0]);
            const refreshed = await rpc(re, 'refresh');
            assert(refreshed.success);
            assert.equal(refreshed.state.spin.id, snapshot.id);
            assert.deepEqual(refreshed.state.spin.symbols, snapshot.symbols);
            assert.equal(
                await money(accounts[0].id),
                189000 + rules.reward(1000, snapshot.kind)
            );
        } finally {
            for (const s of sockets) s.close();
            await manager?.stop();
            if (io) {
                await require('../server/realtime/raidManager')
                    .getRaidManager(io)
                    .stop();
                require('../server/realtime/whitepeakClub').getClub(io).close();
                await require('../server/realtime/draftManager')
                    .getDraftManager(io)
                    .stop();
                require('../server/realtime/housing')
                    .getHousingManager(io)
                    .stop();
                await new Promise((r) => io.close(r));
                await require('../server/realtime/accountConnection').waitForAccountConnections(
                    io
                );
            }
            for (const u of accounts)
                await db.execute('DELETE FROM users WHERE id=?', [u.id]);
            await db.end();
        }
    }
);
