const test = require('node:test'),
    assert = require('node:assert/strict'),
    http = require('node:http'),
    { once } = require('node:events'),
    { randomUUID } = require('node:crypto');
test(
    'Housing real sockets: same-facade private houses, friend visits, colliding edits, floor traversal and reconnect',
    { skip: process.env.RUN_MYSQL_TESTS !== '1' },
    async () => {
        assert.equal(process.env.DB_NAME, 'explorakit_test');
        process.env.NODE_ENV = 'test';
        const { dbPool: db } = require('../server/config/database'),
            users = require('../server/persistence/userRepository'),
            repo = require('../server/persistence/housingRepository'),
            rules = require('../server/game/housing/rules'),
            social = require('../server/persistence/trainerRepository'),
            {
                io: client,
            } = require('../vue-explorakit/node_modules/socket.io-client'),
            housing = require('../server/realtime/housing');
        const accounts = [],
            sockets = [];
        let server, io, m;
        const wait = (s, event) =>
            new Promise((resolve, reject) => {
                const timer = setTimeout(
                    () => reject(Error('Missing ' + event)),
                    10000
                );
                s.once(event, (data) => {
                    clearTimeout(timer);
                    resolve(data);
                });
            });
        const rpc = (s, event, p = {}) =>
            new Promise((resolve, reject) =>
                s
                    .timeout(15000)
                    .emit(event, p, (e, r) => (e ? reject(e) : resolve(r)))
            );
        async function connect(u, housingLayout = 2) {
            const s = client('http://127.0.0.1:' + server.address().port, {
                auth: {
                    token: require('../server/config/auth').signAccessToken(u),
                    housing: 1,
                    housingLayout,
                },
                transports: ['websocket'],
                forceNew: true,
                reconnection: false,
                autoConnect: false,
            });
            sockets.push(s);
            const ready = wait(s, 'playersList');
            s.connect();
            await ready;
            return s;
        }
        async function waitClosed(id) {
            for (let n = 0; n < 200; n++) {
                if (!m.contexts.has(id)) return;
                await new Promise((r) => setTimeout(r, 10));
            }
            throw Error('Account did not close');
        }
        const request = (h, p) => ({
            ...p,
            revision: h.revision,
            requestId: randomUUID(),
        });
        try {
            server = http.createServer();
            io = new (require('socket.io').Server)(server);
            io.use(require('../server/http/authMiddleware').authenticateSocket);
            require('../server/realtime/socketHandler')(io);
            server.listen(0, '127.0.0.1');
            await once(server, 'listening');
            m = housing.getHousingManager(io);
            for (let n = 0; n < 3; n++) {
                const u = await users.createUserWithStarter(
                    'HouseNet_' + randomUUID().slice(0, 8),
                    randomUUID()
                );
                accounts.push(u);
                await db.execute(
                    "UPDATE users SET money=20000000,map='ville1',x=240,y=112 WHERE id=?",
                    [u.id]
                );
                await db.execute(
                    "INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,'adventure_opening','complete') ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)",
                    [u.id]
                );
            }
            let a = await connect(accounts[0]),
                b = await connect(accounts[1], 0),
                g = await connect(accounts[2]);
            const cmd = (s, n, p) => rpc(s, 'housing:' + n, p),
                entry = require('../server/game/housing/entries').entries[0];
            // A Space interaction must not be rejected by the existing native interactionBusy guard.
            const offer = wait(a, 'housing:panel');
            a.emit('Space');
            assert.equal((await offer).entry.key, entry.key);
            let pa = await cmd(
                a,
                'purchase',
                request(await repo.read(accounts[0].id), {
                    entryKey: entry.key,
                    model: 'nid',
                })
            );
            assert(pa.success, pa.message);
            const receiptPayload = request(await repo.read(accounts[1].id), {
                    entryKey: entry.key,
                    model: 'nid',
                }),
                pb = await cmd(b, 'purchase', receiptPayload);
            assert(pb.success, pb.message);
            assert.equal((await cmd(a, 'open')).message, undefined);
            assert.match((await cmd(b, 'open')).message, /actualise le jeu/);
            assert.equal((await cmd(b, 'open')).kind, 'manage');
            assert.equal(
                (await cmd(b, 'purchase', receiptPayload)).duplicate,
                true
            );
            assert.notEqual(
                io.sockets.sockets.get(a.id).data.worldRoom,
                io.sockets.sockets.get(b.id).data.worldRoom
            );
            const roomA = io.sockets.sockets.get(a.id).data.worldRoom;
            assert.equal(io.sockets.adapter.rooms.get(roomA).size, 1);
            await social.friendAction(
                accounts[0].id,
                accounts[2].id,
                'request'
            );
            await social.friendAction(accounts[2].id, accounts[0].id, 'accept');
            const inv = wait(g, 'housing:invitation');
            assert(
                (await cmd(a, 'invite', { userId: accounts[2].id })).success
            );
            const invitation = await inv;
            assert(
                (
                    await cmd(g, 'invitation', {
                        id: invitation.id,
                        accept: true,
                    })
                ).success
            );
            assert.equal(io.sockets.sockets.get(g.id).data.worldRoom, roomA);
            assert.equal(io.sockets.adapter.rooms.get(roomA).size, 2);
            assert.equal((await cmd(g, 'open')).success, false);
            assert.equal(
                (await cmd(g, 'floor', request(pa.home, { model: 'nid' })))
                    .success,
                false
            );
            // Buying furniture outside the store is forbidden, with no mutation.
            assert.equal(
                (
                    await cmd(
                        a,
                        'furniture',
                        request(pa.home, { key: 'chair', quantity: 1 })
                    )
                ).success,
                false
            );
            let h = (
                await repo.furniture(
                    accounts[0].id,
                    request(pa.home, { key: 'chair', quantity: 3 })
                )
            ).home;
            m.contexts.get(accounts[0].id).session.home = h; // refresh manager via a reconnect, as production receives stock after buying at the store.
            a.close();
            await waitClosed(accounts[0].id);
            a = await connect(accounts[0]);
            const p = m.contexts.get(accounts[2].id).getPlayer(),
                layout = structuredClone(h.floors[0]);
            layout.placements = [
                {
                    id: randomUUID(),
                    key: 'chair',
                    x: Math.floor(p.x / 32),
                    y: Math.floor(p.y / 32),
                },
            ];
            assert.equal(
                (await cmd(a, 'save', request(h, { floor: 0, layout })))
                    .success,
                false
            );
            layout.placements[0].x = 10;
            layout.placements[0].y = 10;
            pa = await cmd(a, 'save', request(h, { floor: 0, layout }));
            assert(pa.success, pa.message);
            h = pa.home;
            pa = await cmd(a, 'floor', request(h, { model: 'atelier' }));
            assert(pa.success, pa.message);
            h = pa.home;
            const movedStair = structuredClone(h.floors[0]);
            movedStair.stairs.up = { x: 16, y: 10 };
            pa = await cmd(
                a,
                'save',
                request(h, { floor: 0, layout: movedStair })
            );
            assert.equal(pa.success, false);
            assert.match(pa.message, /fixes/);
            pa = await cmd(a, 'floor', request(h, { model: 'pavillon' }));
            assert(pa.success, pa.message);
            h = pa.home;
            // Native movement across the stair top triggers travel; no client map/floor field is trusted.
            const context = m.contexts.get(accounts[2].id),
                stair = h.floors[0].stairs.up;
            context.getPlayer().x = (stair.x + 3) * 32 + 16;
            context.getPlayer().y = (stair.y + 1) * 32 + 16;
            const change = wait(g, 'newmap');
            g.emit('playerAction', 'move_q');
            const moved = await change;
            assert.equal(moved.mapname, 'housing_atelier');
            assert.equal((await repo.visit(accounts[2].id)).floor, 1);
            assert.equal(
                moved.playersList[g.id].housingOwnerId,
                accounts[0].id
            );
            await new Promise((r) => setTimeout(r, 150));
            g.emit('playerAction', 'move_q');
            await new Promise((r) => setTimeout(r, 150));
            assert.equal((await repo.visit(accounts[2].id)).floor, 1, 'held Left cannot bounce back');
            const middleStair = h.floors[1].stairs.up;
            context.getPlayer().x = (middleStair.x + 3) * 32 + 16;
            context.getPlayer().y = (middleStair.y + 1) * 32 + 16;
            const third = wait(g, 'newmap');
            g.emit('playerAction', 'move_q');
            assert.equal((await third).mapname, 'housing_pavillon');
            assert.equal((await repo.visit(accounts[2].id)).floor, 2);
            const upperRoom = io.sockets.sockets.get(g.id).data.worldRoom;
            assert.notEqual(upperRoom, roomA);
            g.close();
            await waitClosed(accounts[2].id);
            g = await connect(accounts[2]);
            assert.equal(
                io.sockets.sockets.get(g.id).data.worldRoom,
                upperRoom
            );
            assert.equal(m.state(accounts[2].id).floor, 2);
            assert((await cmd(g, 'exit')).success);
            assert.equal((await repo.visit(accounts[2].id)).inside, false);
            const exitDoor = rules.door(rules.model(h.floors[0].model)),
                ownerPlayer = m.contexts.get(accounts[0].id).getPlayer();
            ownerPlayer.x = exitDoor.x * 32 + 16;
            ownerPlayer.y = (exitDoor.y - 1) * 32 + 16;
            const left = wait(a, 'newmap');
            a.emit('playerAction', 'move_s');
            assert.equal((await left).mapname, entry.map);
            assert.equal((await repo.visit(accounts[0].id)).inside, false);
            for (const s of [a, b]) s.close();
            g.close();
            await require('../server/realtime/accountConnection').waitForAccountConnections(
                io
            );
            assert.equal(m.cacheStats().occupiedHouses, 0);
        } finally {
            for (const s of sockets) s.close();
            m?.stop();
            if (io) {
                await require('../server/realtime/raidManager')
                    .getRaidManager(io)
                    .stop();
                require('../server/realtime/whitepeakClub').getClub(io).close();
                await require('../server/realtime/draftManager')
                    .getDraftManager(io)
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
