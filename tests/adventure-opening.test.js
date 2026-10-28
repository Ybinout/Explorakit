const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const opening = require('../server/game/world/adventureOpening');
const dialogue = require('../server/game/world/interactionRepository');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

test('opening is opt-in for new adventures, separate from the finale and ordinary healing', () => {
    assert.equal(opening.waking('etage', {}), false);
    assert(opening.waking('etage', { flags: { adventure_opening: 'sleeping' } }));
    assert.equal(opening.waking('start', { flags: { adventure_opening: 'sleeping' } }), false);
    assert.equal(opening.entryDialogue('start', { flags: { adventure_opening: 'outside' } }), opening.config.dialogue);
    for (const stage of ['sleeping', 'awake', 'complete']) assert.equal(opening.entryDialogue('start', { flags: { adventure_opening: stage } }), null);
    const [sentences] = dialogue.getSentenceForName(opening.config.dialogue);
    assert(sentences.some(s => s.text.includes('Lucie')));
    assert(sentences.some(s => s.text.includes('Wayne')));
    assert.equal(dialogue.getEndSentenceInformation(opening.config.dialogue), undefined);
    assert.equal(dialogue.getEndSentenceInformation('dia0'), 'heal');
    const tiles = require('../server/game/world/mapRepository').loadCollisionData('etage');
    assert.equal(tiles[10][18], 0, 'bed arrival remains walkable');
});

function event(socket, name, accept = () => true) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { socket.off(name, receive); reject(Error('Missing ' + name)); }, 8000);
        function receive(value) { if (!accept(value)) return; clearTimeout(timer); socket.off(name, receive); resolve(value); }
        socket.on(name, receive);
    });
}

test('SQL/socket first wake, manual exit, interruption, no healing, once-only and legacy isolation', {
    skip: process.env.RUN_MYSQL_TESTS !== '1', timeout: 30000
}, async () => {
    assert.match(process.env.DB_NAME || '', /test/i);
    const express = require('express'), http = require('node:http'), { Server } = require('socket.io');
    const { io: client } = require('../vue-explorakit/node_modules/socket.io-client');
    const { dbPool: db } = require('../server/config/database');
    const teams = require('../server/persistence/teamRepository');
    const repository = require('../server/persistence/adventureOpeningRepository');
    const app = express(), server = http.createServer(app), io = new Server(server), users = [], sockets = [];
    app.use(express.json()); app.use('/api', require('../server/http/routes'));
    io.use(require('../server/http/authMiddleware').authenticateSocket); require('../server/realtime/socketHandler')(io);
    let base;
    async function create() {
        const r = await fetch(base + '/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'opening_' + randomUUID(), password: randomUUID(), starterId: 7 }) });
        assert.equal(r.status, 201); const user = await r.json(); users.push(user.user.id); return user;
    }
    async function connect(user, capability = true) {
        const s = client(base, { autoConnect: false, auth: { token: user.token, adventureOpening: capability }, transports: ['websocket'], reconnection: false });
        sockets.push(s); s.scenes = []; s.speeches = []; s.players = {};
        s.on('adventureOpening', value => s.scenes.push(value)); s.on('dialogue', value => s.speeches.push(value));
        s.on('playersList', value => { s.players = value; });
        s.on('newmap', value => { s.players = value.playersList; });
        s.on('playerMoved', value => { s.players[value.id] = value.player; });
        const ready = event(s, 'pokedexState'); s.connect(); await ready; await pause(80); return s;
    }
    const close = async s => { s.disconnect(); await pause(100); };
    const ack = s => new Promise(resolve => s.emit('adventureOpeningDone', resolve));
    async function place(user, map, x, y) { await db.execute('UPDATE users SET map=?,x=?,y=? WHERE id=?', [map, x, y, user.user.id]); }
    try {
        server.listen(0, '127.0.0.1'); await once(server, 'listening'); base = `http://127.0.0.1:${server.address().port}`;
        const a = await create(), b = await create();
        const team = await teams.loadEquipe(a.user.id); team.pokemons[0].currentHp = 3; team.pokemons[0].movePp[0] = 1; await teams.editEquipe(a.user.id, team);
        let s = await connect(a); assert.equal(s.scenes.length, 1); assert.equal(s.players[s.id].currentmap, 'etage'); assert.equal(s.players[s.id].x, 592); assert.equal(s.players[s.id].y, 336);
        s.emit('playerAction', 'move_s'); s.emit('Space'); await pause(200); assert.equal(s.players[s.id].y, 336); assert.equal(s.speeches.length, 0);
        await close(s); s = await connect(a); assert.equal(s.scenes.length, 1, 'interrupted wake resumes');
        assert.equal((await ack(s)).success, true); assert.equal((await ack(s)).success, true, 'lost acknowledgements are safe');
        await close(s); s = await connect(a); assert.equal(s.scenes.length, 0, 'no replay after waking');
        const rejected = event(s, 'interactionRejected'); s.emit('onEndDialogue', opening.config.dialogue); await rejected;
        assert.equal(await repository.finishMother(a.user.id), false, 'no completion before the real exit');
        await close(s); await place(a, 'maison', 272, 464); s = await connect(a); assert.equal(s.speeches.length, 0);
        const spoken = event(s, 'dialogue', value => value[1] === opening.config.dialogue), changed = event(s, 'newmap');
        s.emit('playerAction', 'move_s'); await changed; assert.equal((await spoken)[2].entryMap, 'start');
        const before = { x: s.players[s.id].x, y: s.players[s.id].y }; s.emit('playerAction', 'move_d'); await pause(200); assert.deepEqual({ x: s.players[s.id].x, y: s.players[s.id].y }, before);
        await close(s); s = await connect(a); assert.equal(s.speeches[0][1], opening.config.dialogue, 'interrupted conversation resumes');
        const completed = event(s, 'progressionState', value => value.flags.adventure_opening === 'complete'); s.emit('onEndDialogue', opening.config.dialogue); await completed;
        const saved = await teams.loadEquipe(a.user.id); assert.equal(saved.pokemons[0].currentHp, 3); assert.equal(saved.pokemons[0].movePp[0], 1);
        await close(s); await place(a, 'maison', 272, 464); s = await connect(a); const again = event(s, 'newmap'); s.emit('playerAction', 'move_s'); await again; await pause(150); assert.equal(s.speeches.length, 0);
        // Existing accounts have no opening flag: never teleport or start a new scene.
        await db.execute('DELETE FROM player_story_flags WHERE user_id=? AND flag_key=?', [b.user.id, opening.config.flag]); await place(b, 'start', 80, 208);
        const old = await connect(b); assert.equal(old.players[old.id].currentmap, 'start'); assert.equal(old.scenes.length, 0); assert.equal(old.speeches.length, 0);
        assert.equal(await repository.noteExit(b.user.id), false);
        const c = await create(), compatible = await connect(c, false); assert.equal(compatible.scenes.length, 0); assert.equal(compatible.players[compatible.id].currentmap, 'etage');
        const [rows] = await db.execute('SELECT flag_value FROM player_story_flags WHERE user_id=? AND flag_key=?', [c.user.id, opening.config.flag]); assert.equal(rows[0].flag_value, 'awake');
    } finally {
        for (const s of sockets) s.disconnect(); await pause(150); await new Promise(resolve => io.close(resolve));
        for (const id of users) await db.execute('DELETE FROM users WHERE id=?', [id]); await db.end();
    }
});
