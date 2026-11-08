const test = require('node:test'),
    assert = require('node:assert/strict'),
    http = require('node:http'),
    { once } = require('node:events'),
    { randomUUID } = require('node:crypto');
const enabled = process.env.RUN_MYSQL_TESTS === '1';
test(
    'SQL/socket four-player draft invitations, private packs, semifinals, final, payouts and first action after reconnect',
    { skip: !enabled },
    async () => {
        assert.equal(process.env.DB_NAME, 'explorakit_test');
        process.env.NODE_ENV = 'test';
        const { Server } = require('socket.io'),
            {
                io: client,
            } = require('../vue-explorakit/node_modules/socket.io-client');
        const { dbPool: db } = require('../server/config/database'),
            users = require('../server/persistence/userRepository'),
            teams = require('../server/persistence/teamRepository'),
            codec = require('../server/game/drift/checkpointCodec'),
            draft = require('../server/realtime/draftManager'),
            social = require('../server/persistence/trainerRepository');
        const accounts = [],
            sockets = [],
            original = draft.getDraftManager;
        let manager,
            clock = Date.now(),
            tableId,
            io,
            server;
        const parties = [];
        let xp = 0;
        const wait = (s, event) =>
            new Promise((resolve, reject) => {
                const timeout = setTimeout(
                    () => reject(Error('Missing ' + event)),
                    10000
                );
                s.once(event, (data) => {
                    clearTimeout(timeout);
                    resolve(data);
                });
            });
        const rpc = (s, name, data = {}) =>
            new Promise((resolve, reject) =>
                s
                    .timeout(15000)
                    .emit('draft:' + name, data, (e, r) =>
                        e ? reject(e) : resolve(r)
                    )
            );
        const command = async (i, name, data) => {
            const r = await rpc(sockets[i], name, data);
            assert(r.success, r.message);
            return r;
        };
        async function connect(u) {
            const s = client('http://127.0.0.1:' + server.address().port, {
                auth: {
                    token: require('../server/config/auth').signAccessToken(u),
                },
                forceNew: true,
                reconnection: false,
                autoConnect: false,
                transports: ['websocket'],
            });
            s.on('battleExperience', () => xp++);
            const ready = wait(s, 'playersList');
            s.connect();
            await ready;
            return s;
        }
        try {
            draft.getDraftManager = (io) =>
                manager ||
                (manager = draft.createDraftManager(io, {
                    now: () => clock,
                    tickMs: 0,
                }));
            server = http.createServer();
            io = new Server(server);
            io.use(require('../server/http/authMiddleware').authenticateSocket);
            require('../server/realtime/socketHandler')(io);
            server.listen(0, '127.0.0.1');
            await once(server, 'listening');
            for (let n = 0; n < 4; n++) {
                const u = await users.createUserWithStarter(
                    'DraftNet_' + randomUUID().slice(0, 9),
                    randomUUID()
                );
                accounts.push(u);
                await db.execute(
                    "UPDATE users SET map='draft_house',x=432,y=464,money=1000 WHERE id=?",
                    [u.id]
                );
                await db.execute(
                    "UPDATE player_story_flags SET flag_value='complete' WHERE user_id=? AND flag_key='adventure_opening'",
                    [u.id]
                );
                parties.push(codec.encode(await teams.loadEquipe(u.id)));
                sockets.push(await connect(u));
            }
            await social.friendAction(
                accounts[0].id,
                accounts[1].id,
                'request'
            );
            await social.friendAction(accounts[1].id, accounts[0].id, 'accept');
            tableId = (await command(0, 'create', { level: 50 })).state.id;
            const invited = wait(sockets[1], 'draft:invitation');
            await command(0, 'invite', { id: tableId, userId: accounts[1].id });
            const invitation = await invited;
            await command(1, 'accept', {
                id: tableId,
                invitationId: invitation.id,
            });
            for (const i of [2, 3]) await command(i, 'join', { id: tableId });
            const friends = await command(0, 'friends');
            assert(
                friends.friends.some(
                    (f) => f.id === accounts[1].id && f.online && f.here
                )
            );
            await command(0, 'start', { id: tableId });
            let r = manager.tables.get(tableId);
            assert.equal(
                (
                    await rpc(sockets[1], 'edit', {
                        id: tableId,
                        action: 'slot',
                        slot: 0,
                        cardId: r.packs[0][0],
                    })
                ).success,
                false
            );
            while (r.phase === 'draft') {
                const round = r.round,
                    pick = r.pick,
                    choices = r.packs.map(
                        (pack) =>
                            pack.find(
                                (id) => r.cards.get(id).kind === 'pokemon'
                            ) || pack[0]
                    );
                for (let i = 0; i < 4; i++) {
                    const state = (
                        await command(i, 'pick', {
                            id: tableId,
                            round,
                            pick,
                            cardId: choices[i],
                        })
                    ).state;
                    assert(
                        !JSON.stringify(state).includes(
                            r.seats[(i + 1) % 4].collection.at(-1) ||
                                'impossible-id'
                        )
                    );
                }
                r = manager.tables.get(tableId);
            }
            const discarded = r.seats[0].collection.find(
                (id) => !['pokemon', 'rift'].includes(r.cards.get(id).kind)
            );
            assert(discarded);
            const foreignBefore = [...r.seats[1].collection];
            await command(0, 'edit', {
                id: tableId,
                action: 'discard',
                cardId: discarded,
            });
            assert(!manager.tables.get(tableId).cards.has(discarded));
            assert.deepEqual(
                manager.tables.get(tableId).seats[1].collection,
                foreignBefore
            );
            const [[row]] = await db.execute(
                'SELECT snapshot FROM draft_tables WHERE id=?',
                [tableId]
            );
            const checkpoint = codec.decode(row.snapshot);
            assert(!checkpoint.seats[0].collection.includes(discarded));
            assert(!checkpoint.cards.has(discarded));
            clock +=
                require('../server/game/draft/content').config.preparationMs +
                1;
            await manager.tick();
            r = manager.tables.get(tableId);
            assert.equal(r.phase, 'tournament');
            const deadline = r.matches[0].battle.deadline,
                token = r.matches[0].battle.token;
            const old = sockets[0];
            old.disconnect();
            sockets[0] = await connect(accounts[0]);
            assert.equal(
                manager.tables.get(tableId).matches[0].battle.deadline,
                deadline
            );
            await command(0, 'action', {
                id: tableId,
                matchId: r.matches[0].id,
                turnId: token,
                action: 'attack',
                number: 0,
            });
            await command(1, 'action', {
                id: tableId,
                matchId: r.matches[0].id,
                turnId: token,
                action: 'flee',
            });
            r = manager.tables.get(tableId);
            const second = r.matches[1];
            await command(2, 'action', {
                id: tableId,
                matchId: second.id,
                turnId: second.battle.token,
                action: 'attack',
                number: 0,
            });
            await command(3, 'action', {
                id: tableId,
                matchId: second.id,
                turnId: second.battle.token,
                action: 'flee',
            });
            await command(0, 'continue', { id: tableId });
            await command(2, 'continue', { id: tableId });
            r = manager.tables.get(tableId);
            const final = r.matches.find((m) => m.round === 'final');
            assert(final);
            await command(0, 'action', {
                id: tableId,
                matchId: final.id,
                turnId: final.battle.token,
                action: 'attack',
                number: 0,
            });
            await command(2, 'action', {
                id: tableId,
                matchId: final.id,
                turnId: final.battle.token,
                action: 'flee',
            });
            assert.equal(manager.tables.get(tableId).phase, 'finished');
            for (let i = 0; i < 4; i++) {
                const [[u]] = await db.execute(
                    'SELECT money FROM users WHERE id=?',
                    [accounts[i].id]
                );
                assert.equal(
                    Number(u.money),
                    i === 0 ? 151000 : i === 2 ? 51000 : 1000
                );
                assert(
                    parties[i].equals(
                        codec.encode(await teams.loadEquipe(accounts[i].id))
                    )
                );
                assert.equal(
                    manager.contexts.get(accounts[i].id).getPlayer().inbattle,
                    false
                );
            }
            assert.equal(xp, 0);
        } finally {
            draft.getDraftManager = original;
            for (const s of sockets) s.close();
            await manager?.stop();
            if (io) {
                await require('../server/realtime/raidManager')
                    .getRaidManager(io)
                    .stop();
                require('../server/realtime/whitepeakClub').getClub(io).close();
                await new Promise((r) => io.close(r));
                await require('../server/realtime/accountConnection').waitForAccountConnections(
                    io
                );
            }
            if (tableId)
                await db.execute('DELETE FROM draft_tables WHERE id=?', [
                    tableId,
                ]);
            for (const u of accounts)
                await db.execute('DELETE FROM users WHERE id=?', [u.id]);
            await db.end();
        }
    }
);
