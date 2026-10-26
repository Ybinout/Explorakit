const test = require('node:test'), assert = require('node:assert/strict');
test('SQL/socket: takeover waits for the retiring Adventure save, preserves the position and crosses modes', { skip: process.env.RUN_MYSQL_TESTS !== '1', timeout: 20000 }, async () => {
    assert.match(process.env.DB_NAME || '', /test/i);
    process.env.NODE_ENV = 'test';
    const express = require('express'), http = require('node:http'), { once } = require('node:events'), { randomUUID } = require('node:crypto');
    const { Server } = require('socket.io'), { io: client } = require('../vue-explorakit/node_modules/socket.io-client');
    const { dbPool: db } = require('../server/config/database'), repository = require('../server/persistence/playerRepository');
    const originalSave = repository.saveUserPosition, sockets = []; let id, release, started, hold = false;
    const gate = new Promise(resolve => { release = resolve; }), writing = new Promise(resolve => { started = resolve; });
    repository.saveUserPosition = async (userId, position) => { if (hold && userId === id) { started(); await gate; } return originalSave(userId, position); };
    const app = express(), server = http.createServer(app), io = new Server(server);
    app.use(express.json()); app.use('/api', require('../server/http/routes'));
    io.use(require('../server/http/authMiddleware').authenticateSocket); require('../server/realtime/socketHandler')(io);
    const stop = require('../server/realtime/driftLobbyHandler').registerDriftLobbies(io, { appearanceRepository: { async loadUserSprite() { return 'sprite.png'; } } });
    const event = (socket, name) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => { socket.off(name, done); reject(Error('Missing ' + name)); }, 6000);
        function done(value) { clearTimeout(timer); socket.off(name, done); resolve(value); } socket.on(name, done);
    });
    const command = (s, name, payload) => new Promise((resolve, reject) => {
        const reply = (error, result) => error ? reject(Error(name + ': ' + error.message)) : resolve(result);
        if (payload === undefined) s.timeout(6000).emit(name, reply);
        else s.timeout(6000).emit(name, payload, reply);
    });
    try {
        server.listen(0, '127.0.0.1'); await once(server, 'listening'); const base = 'http://127.0.0.1:' + server.address().port;
        const response = await fetch(base + '/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'lease_' + randomUUID(), password: randomUUID(), starterId: 7 }) });
        assert.equal(response.status, 201); const account = await response.json(); id = account.user.id;
        const maps = require('../server/game/world/mapRepository'), grid = maps.loadCollisionData('centre'), portals = maps.changeMapData('centre'); let tile;
        for (let y = 10; y < grid.length - 2 && !tile; y++) for (let x = 3; x < grid[y].length - 3 && !tile; x++) if (grid[y][x] === 0 && grid[y][x + 1] === 0 && !portals[y]?.[x] && !portals[y]?.[x + 1]) tile = { x, y };
        assert(tile); await originalSave(id, { map: 'centre', x: tile.x * 32 + 16, y: tile.y * 32 + 16 });
        const make = (namespace = '') => { const socket = client(base + namespace, { auth: { token: account.token }, autoConnect: false, transports: ['websocket'], forceNew: true, reconnection: false }); sockets.push(socket); return socket; };
        const first = make(), firstReady = event(first, 'playersList'); first.connect(); await firstReady;
        assert.equal((await command(first, 'requestGameSave')).success, true); hold = true;
        const moved = event(first, 'playerMoved'); first.emit('playerAction', 'move_d'); const movement = await moved;
        assert.equal(movement.player.x, (tile.x + 1) * 32 + 16); await writing;
        const notice = event(first, 'session:replaced'), disconnected = event(first, 'disconnect');
        const second = make(), connected = event(second, 'connect'), ready = event(second, 'playersList'); second.connect(); await connected; await notice; await disconnected;
        assert(!first.connected); assert.equal(io.sockets.sockets.size, 1); release();
        const players = await ready, restored = players[second.id]; assert(restored);
        assert.equal(restored.x, movement.player.x); assert.equal(restored.y, movement.player.y);
        const [[row]] = await db.execute('SELECT x,y,map FROM users WHERE id=?', [id]); assert.equal(row.map, 'centre'); assert.equal(row.x, restored.x); assert.equal(row.y, restored.y);
        const replaced = event(second, 'session:replaced'), lobby = make('/drift'), boot = event(lobby, 'drift:bootstrap'); lobby.connect(); await boot; await replaced;
        assert(!second.connected); assert.equal((await command(lobby, 'colosseum:start', { durationMinutes: 30 })).ok, true);
        const entry = await command(lobby, 'drift:enter', {}); assert(entry.success); const runId = entry.state.id;
        const replacedLobby = event(lobby, 'session:replaced'), resume = make('/drift'), bootResume = event(resume, 'drift:bootstrap'); resume.connect(); await bootResume; await replacedLobby;
        const resumed = await command(resume, 'drift:enter', {}); assert(resumed.success); assert.equal(resumed.state.id, runId); assert.deepEqual(resumed.state.team, entry.state.team);
        assert.equal(io.of('/drift').sockets.size, 1); assert.equal(io.sockets.sockets.size, 0);
    } finally {
        release(); sockets.forEach(s => s.disconnect()); stop(); await new Promise(r => io.close(r));
        await require('../server/realtime/accountConnection').waitForAccountConnections(io);
        await new Promise(r => setTimeout(r, 50)); repository.saveUserPosition = originalSave;
        if (id) await db.execute('DELETE FROM users WHERE id=?', [id]); await db.end();
    }
});
