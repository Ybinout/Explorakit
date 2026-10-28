const test = require('node:test'), assert = require('node:assert/strict');
const http = require('node:http'), { once } = require('node:events'), { randomUUID } = require('node:crypto');
const enabled = process.env.RUN_MYSQL_TESTS === '1';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function event(socket, name, predicate = () => true) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { socket.off(name, receive); reject(Error('Missing ' + name)); }, 10000);
        const receive = value => { if (!predicate(value)) return; clearTimeout(timer); socket.off(name, receive); resolve(value); };
        socket.on(name, receive);
    });
}

test('Adventure sockets: Abra is guaranteed per unseen account, survives interruption, and respects Repel and legendaries', { skip: !enabled, timeout: 60000 }, async () => {
    assert.match(process.env.DB_NAME || '', /test/i, 'Dedicated test database required');
    const express = require('express'), { Server } = require('socket.io');
    const { io: client } = require('../vue-explorakit/node_modules/socket.io-client');
    const { dbPool: db } = require('../server/config/database');
    const account = require('../server/realtime/accountConnection');
    const teams = require('../server/persistence/teamRepository'), progress = require('../server/persistence/progressionRepository');
    const factory = require('../server/game/drift/pokemonFactory');
    const app = express(), server = http.createServer(app), io = new Server(server);
    app.use(express.json()); app.use('/api', require('../server/http/routes'));
    io.use(require('../server/http/authMiddleware').authenticateSocket); require('../server/realtime/socketHandler')(io);
    const ids = [], sockets = [], oldRandom = Math.random, execute = db.execute;
    let base, releaseRead;
    async function create() {
        const response = await fetch(base + '/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'abra_test_' + randomUUID(), password: randomUUID(), starterId: 7 }) });
        assert.equal(response.status, 201); const user = await response.json(); ids.push(user.user.id);
        const lead = factory.create(129, 50, true); lead.abilities = []; lead.movePp = []; lead.addAbility('Splash');
        await teams.editEquipe(user.user.id, { pokemons: [lead] }); return user;
    }
    async function connect(user, repel = 0) {
        await db.execute("UPDATE users SET map='route2', x=48, y=144, repel_steps=? WHERE id=?", [repel, user.user.id]);
        const socket = client(base, { autoConnect: false, auth: { token: user.token }, transports: ['websocket'], reconnection: false });
        sockets.push(socket); const ready = event(socket, 'pokedexState'); socket.connect(); await ready;
        socket.on('requestAction', () => socket.emit('actionResponse', socket.testAction || { action: 'flee' }));
        return socket;
    }
    async function disconnect(socket) {
        await new Promise(resolve => socket.emit('requestGameSave', resolve)); socket.disconnect();
        await account.waitForAccountConnections(io);
    }
    async function encounter(socket, random = .01, action = { action: 'flee' }, direction = 'move_d') {
        socket.testAction = action; Math.random = () => random;
        const intro = event(socket, 'introAnimation'), end = event(socket, 'endbattle');
        const finished = event(socket, 'teamStateChanged', p => p.reason === 'wild_battle_end');
        socket.emit('playerAction', direction); const [payload, result] = await Promise.all([intro, end, finished]); Math.random = oldRandom;
        assert(payload.wildPokemon.level >= 11 && payload.wildPokemon.level <= 15);
        return { pokemon: payload.wildPokemon, result };
    }
    async function seen(user) {
        const [rows] = await db.execute('SELECT seen_count, caught_count FROM user_pokedex WHERE user_id=? AND pokemon_id=63', [user.user.id]);
        return rows[0] || null;
    }
    try {
        server.listen(0, '127.0.0.1'); await once(server, 'listening'); base = `http://127.0.0.1:${server.address().port}`;
        const first = await create(); let socket = await connect(first);
        const before = (await progress.loadProgressState(first.user.id)).money;
        const abra = await encounter(socket, .01, { action: 'attack', number: 0 });
        assert.equal(abra.pokemon.data.id, 63); assert.equal(abra.result.escapeActor, 'opponent', 'Abra retains its real Teleport');
        assert.equal(abra.result.summary.money, 0); assert.deepEqual(abra.result.summary.experience, []);
        assert.equal((await progress.loadProgressState(first.user.id)).money, before);
        assert.equal(Number((await seen(first)).seen_count), 1); assert.equal(Number((await seen(first)).caught_count), 0);
        await disconnect(socket); socket = await connect(first);
        assert.equal((await encounter(socket)).pokemon.data.id, 12, 'reconnect restores ordinary draws after seeing Abra');
        await disconnect(socket);

        const second = await create(); socket = await connect(second);
        assert.equal((await encounter(socket)).pokemon.data.id, 63, 'a different player has an independent guarantee');
        await disconnect(socket);

        const owned = await create(); await progress.markPokemonCaught(owned.user.id, 63); socket = await connect(owned);
        assert.equal((await encounter(socket)).pokemon.data.id, 12, 'a recorded capture also satisfies the guarantee'); await disconnect(socket);

        const repelled = await create(); socket = await connect(repelled, 1);
        let triggered = false; socket.on('battletrigger', () => { triggered = true; });
        const expired = event(socket, 'fieldEffectState', p => p.repelSteps === 0);
        Math.random = () => .01; socket.emit('playerAction', 'move_d'); await expired; await pause(250); Math.random = oldRandom;
        assert(!triggered); assert.equal(await seen(repelled), null, 'the last protected step does not consume anything');
        assert.equal((await encounter(socket, .01, { action: 'flee' }, 'move_q')).pokemon.data.id, 63); await disconnect(socket);

        const lucky = await create(); socket = await connect(lucky);
        assert.equal((await encounter(socket, 0)).pokemon.data.id, 144, 'rare legendary draws are preserved');
        assert.equal(await seen(lucky), null); await disconnect(socket); socket = await connect(lucky);
        assert.equal((await encounter(socket)).pokemon.data.id, 63); await disconnect(socket);

        const interrupted = await create(); socket = await connect(interrupted);
        let readStarted; const reading = new Promise(resolve => { readStarted = resolve; });
        db.execute = async function (sql, args) {
            if (sql.includes('SELECT seen_count, caught_count FROM user_pokedex') && args[0] === interrupted.user.id) {
                await new Promise(resolve => { releaseRead = resolve; readStarted(); });
            }
            return execute.call(this, sql, args);
        };
        Math.random = () => .01; socket.emit('playerAction', 'move_d'); await reading; socket.disconnect(); await pause(60);
        releaseRead(); releaseRead = null; await account.waitForAccountConnections(io); db.execute = execute; Math.random = oldRandom;
        assert.equal(await seen(interrupted), null, 'disconnect during selection must not mark Abra as seen');
        socket = await connect(interrupted); assert.equal((await encounter(socket)).pokemon.data.id, 63); await disconnect(socket);
    } finally {
        releaseRead?.(); db.execute = execute; Math.random = oldRandom;
        for (const socket of sockets) socket.disconnect();
        await account.waitForAccountConnections(io); await new Promise(resolve => io.close(resolve));
        for (const id of ids) await db.execute('DELETE FROM users WHERE id=?', [id]); await db.end();
    }
});
