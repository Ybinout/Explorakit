const test = require('node:test'), assert = require('node:assert/strict');
const http = require('node:http'), { once } = require('node:events'), { randomUUID } = require('node:crypto');
const enabled = process.env.RUN_MYSQL_TESTS === '1', pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function event(socket, name, accept = () => true) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { socket.off(name, receive); reject(Error('Missing ' + name)); }, 8000);
        const receive = value => { if (!accept(value)) return; clearTimeout(timer); socket.off(name, receive); resolve(value); };
        socket.on(name, receive);
    });
}
test('Wanda calls automatically after the house exit, resumes until acknowledged, and replays privately', { skip: !enabled, timeout: 30000 }, async () => {
    assert.match(process.env.DB_NAME || '', /test/i);
    const express = require('express'), { Server } = require('socket.io');
    const { io: client } = require('../vue-explorakit/node_modules/socket.io-client'), { dbPool: db } = require('../server/config/database');
    const policy = require('../server/game/world/arenaTests'), oldOwner = policy.isOwner, oldNow = Date.now;
    const account = require('../server/realtime/accountConnection'), progression = require('../server/persistence/progressionRepository');
    const app = express(), server = http.createServer(app), io = new Server(server), ids = [], sockets = [];
    app.use(express.json()); app.use('/api', require('../server/http/routes'));
    io.use(require('../server/http/authMiddleware').authenticateSocket); require('../server/realtime/socketHandler')(io);
    let base;
    async function create() {
        const response = await fetch(base + '/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'wanda_ui_' + randomUUID(), password: randomUUID(), starterId: 7 }) });
        assert.equal(response.status, 201); const user = await response.json(); ids.push(user.user.id); return user;
    }
    async function flags(user, entries) {
        for (const [key, value] of Object.entries(entries)) await db.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value)VALUES(?,?,?)ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)', [user.user.id, key, value]);
    }
    async function connect(user, { map = 'route2', expect = false, x = 592, y = 272 } = {}) {
        await db.execute('UPDATE users SET map=?,x=?,y=? WHERE id=?', [map, x, y, user.user.id]);
        const socket = client(base, { autoConnect: false, auth: { token: user.token }, transports: ['websocket'], reconnection: false }); sockets.push(socket);
        socket.speeches = []; socket.actors = []; socket.on('dialogue', p => socket.speeches.push(p)); socket.on('pnjsList', p => { socket.actors = p.pnjs; });
        const ready = event(socket, 'pokedexState'), speech = expect ? event(socket, 'dialogue', p => p[1] === 'wanda_professor') : null;
        socket.connect(); await ready; if (speech) await speech; else { await pause(70); assert.equal(socket.speeches.length, 0); } return socket;
    }
    async function close(socket) { socket.disconnect(); await pause(80); }
    async function exit(socket) {
        const moved = event(socket, 'newmap', p => p.mapname === 'route2'), spoken = event(socket, 'dialogue', p => p[1] === 'wanda_professor');
        socket.emit('playerAction', 'move_s'); const [map, speech] = await Promise.all([moved, spoken]);
        assert.equal(speech[2].entryMap, 'route2'); assert(speech[0][0].text.startsWith('Wanda : Hé !'));
        return map.playersList[socket.id];
    }
    try {
        server.listen(0, '127.0.0.1'); await once(server, 'listening'); base = `http://127.0.0.1:${server.address().port}`;
        const a = await create(), b = await create();
        await flags(a, { lucie_freed: 'true', lucie_departure: 'seen' });
        const peer = await connect(b); let socket = await connect(a, { map: 'route2_maison', x: 432, y: 528 });
        let refused = event(socket, 'interactionRejected'); socket.emit('onEndDialogue', 'wanda_professor'); await refused;
        assert.equal((await progression.loadProgressState(a.user.id)).flags.professor_lead, undefined);
        const position = await exit(socket); assert(socket.actors.some(p => p.name === 'wanda_professor')); assert(!peer.actors.some(p => p.name === 'wanda_professor'));
        let moves = 0; socket.on('playerMoved', p => { if (p.id === socket.id) moves++; });
        socket.emit('playerAction', 'move_d'); socket.emit('Space'); await pause(180);
        assert.equal(moves, 0); assert.equal(socket.speeches.length, 1, 'Action cannot replace the automatic dialogue');
        refused = event(socket, 'interactionRejected'); socket.emit('onEndDialogue', 'professor_lab_rock'); await refused;
        await close(socket);
        assert.equal((await progression.loadProgressState(a.user.id)).flags.professor_lead, undefined);
        socket = await connect(a, { expect: true, x: position.x, y: position.y });
        const done = event(socket, 'progressionState', p => p.flags.professor_lead === 'true');
        Date.now = () => oldNow() + 121000; socket.emit('onEndDialogue', 'wanda_professor'); await done; Date.now = oldNow;
        refused = event(socket, 'interactionRejected'); socket.emit('onEndDialogue', 'wanda_professor'); await refused;
        await close(socket); socket = await connect(a);
        assert.equal(socket.speeches.length, 0, 'acknowledged speech never repeats on reconnect');
        await close(socket);
        assert.equal(peer.speeches.length, 0); assert.equal((await progression.loadProgressState(b.user.id)).flags.professor_lead, undefined);

        // A real owner-only reset uses separate flags and must replay the callout.
        await flags(a, Object.fromEntries(require('../data/game/progression.json').storySteps.map(step => [step.flag, 'true'])));
        await flags(a, { professor_defeated: 'true', professor_departure: 'seen', professor_lab_key: 'true', lab_crystals_cleared: 'true', lucie_rescued: 'true', story_complete: 'true' });
        policy.isOwner = user => user?.id === a.user.id;
        const admin = require('../server/persistence/arenaTestRepository'); await admin.rearm(a.user);
        await admin.complete(a.user, 'lucie_route2'); await require('../server/persistence/lucieDepartureRepository').begin(a.user.id);
        socket = await connect(a, { map: 'route2_maison', x: 432, y: 528 }); await exit(socket);
        const replayDone = event(socket, 'progressionState', p => p.flags.admin_professor_lead === 'true');
        socket.emit('onEndDialogue', 'wanda_professor'); await replayDone; await close(socket);
        const saved = await progression.loadProgressState(a.user.id);
        assert.equal(saved.flags.professor_lead, 'true'); assert.equal(saved.flags.professor_lab_key, 'true'); assert.equal(saved.flags.lucie_rescued, 'true');
        assert.equal(saved.flags.admin_professor_lead, 'true'); assert.equal(saved.flags.admin_professor_lab_key, 'false');
        assert.equal(peer.speeches.length, 0);
    } finally {
        Date.now = oldNow; policy.isOwner = oldOwner; for (const socket of sockets) socket.disconnect();
        await account.waitForAccountConnections(io); await new Promise(resolve => io.close(resolve));
        for (const id of ids) await db.execute('DELETE FROM users WHERE id=?', [id]); await db.end();
    }
});
