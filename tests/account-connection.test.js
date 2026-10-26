const test = require('node:test'), assert = require('node:assert/strict');
const http = require('node:http'), { once, EventEmitter } = require('node:events');
const { Server } = require('socket.io');
const { io: client, Manager } = require('../vue-explorakit/node_modules/socket.io-client');
const { signAccessToken } = require('../server/config/auth');
const { authenticateSocket } = require('../server/http/authMiddleware');
const { exclusiveAccountConnection, onAccountEvent, waitForAccountConnections } = require('../server/realtime/accountConnection');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function event(socket, name) {
    return new Promise((resolve, reject) => {
        const done = value => { clearTimeout(timer); socket.off(name, done); resolve(value); };
        const timer = setTimeout(() => { socket.off(name, done); reject(Error('Missing ' + name)); }, 4000);
        socket.on(name, done);
    });
}
const command = (socket, name, payload = {}) => new Promise((resolve, reject) => socket.timeout(4000).emit(name, payload, (error, result) => error ? reject(error) : resolve(result)));
async function harness(t, setup = (socket, account) => {
    account.on('probe', (_payload, reply) => reply({ userId: socket.data.user.id }));
    socket.emit('connectionReady');
}) {
    const server = http.createServer(), io = new Server(server), sockets = [];
    for (const name of ['/', '/drift']) io.of(name).use(authenticateSocket).on('connection', exclusiveAccountConnection(setup));
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const base = 'http://127.0.0.1:' + server.address().port;
    t.after(async () => { sockets.forEach(socket => socket.disconnect()); await new Promise(r => io.close(r)); });
    const make = (id, namespace = '/', token = signAccessToken({ id, username: 'Trainer' + id })) => {
        const socket = client(base + (namespace === '/' ? '' : namespace), { auth: { token }, autoConnect: false, transports: ['websocket'], forceNew: true, reconnection: false });
        sockets.push(socket); return socket;
    };
    const connect = async socket => { const ready = event(socket, 'connectionReady'); socket.connect(); await ready; return socket; };
    return { io, base, sockets, make, connect };
}

test('one account: new socket really disconnects the old one; other accounts and rejected tokens are unaffected', async t => {
    const h = await harness(t), first = await h.connect(h.make(11)), other = await h.connect(h.make(12));
    const invalid = h.make(11, '/', 'invalid'), refused = event(invalid, 'connect_error'); invalid.connect();
    assert.match((await refused).message, /Session invalide/); assert(first.connected);
    const notice = event(first, 'session:replaced'), disconnected = event(first, 'disconnect'), oldId = first.id;
    const second = await h.connect(h.make(11));
    assert.equal((await notice).code, 'session_replaced'); assert.equal(await disconnected, 'io server disconnect');
    assert(!h.io.sockets.sockets.has(oldId)); assert(!first.active, 'server disconnect must not automatically reconnect');
    assert.deepEqual(await command(second, 'probe', { userId: 12 }), { userId: 11 });
    assert.deepEqual(await command(other, 'probe'), { userId: 12 });
});

test('Adventure, Rift and Colosseum lobby share the same account lease', async t => {
    const h = await harness(t); let current = await h.connect(h.make(21));
    for (const namespace of ['/drift', '/', '/drift']) {
        const old = current, notice = event(old, 'session:replaced'); current = await h.connect(h.make(21, namespace)); await notice;
        assert(!old.connected); assert.deepEqual(await command(current, 'probe'), { userId: 21 });
        assert.equal([...h.io.sockets.sockets.values(), ...h.io.of('/drift').sockets.values()].filter(s => s.data.user.id === 21).length, 1);
    }
});

test('namespace replacement preserves the new connection on a shared Socket.IO transport', async t => {
    const h = await harness(t), manager = new Manager(h.base, { autoConnect: false, transports: ['websocket'], reconnection: false });
    const auth = { token: signAccessToken({ id: 31, username: 'Shared' }) };
    const first = manager.socket('/', { auth }), second = manager.socket('/drift', { auth }); h.sockets.push(first, second);
    await h.connect(first); const notice = event(first, 'session:replaced'); await h.connect(second); await notice;
    assert(!first.connected); assert(second.connected); assert.deepEqual(await command(second, 'probe'), { userId: 31 });
});

test('last of three simultaneous arrivals wins, including replacement during asynchronous initialization', async t => {
    const entered = deferred(), gate = deferred(), initialized = [], cleaned = [];
    t.after(() => gate.resolve());
    const h = await harness(t, async (socket, account) => {
        account.onClose(() => cleaned.push(socket.id));
        if (!initialized.length) { initialized.push(socket.id); entered.resolve(); await gate.promise; }
        if (!account.active()) return;
        account.on('probe', (_payload, reply) => reply({ userId: socket.data.user.id })); socket.emit('connectionReady');
    });
    const first = h.make(41), connected = event(first, 'connect'); first.connect(); await connected; await entered.promise;
    const second = h.make(41), secondConnected = event(second, 'connect'); second.connect(); await secondConnected;
    const retired = event(second, 'session:replaced'), third = h.make(41), thirdConnected = event(third, 'connect'), ready = event(third, 'connectionReady');
    third.connect(); await thirdConnected; await retired;
    const early = command(third, 'probe'); gate.resolve(); await ready;
    assert.deepEqual(await early, { userId: 41 }); assert(!first.connected); assert(!second.connected);
    assert.equal(cleaned.length, 1, 'a superseded connection that never initialized creates no world to clean');
});

test('pending writes and final save finish before reloading, even after a normal disconnect', async t => {
    const writing = deferred(), gate = deferred(); let saved = 10, cleanupCount = 0;
    t.after(() => gate.resolve());
    const h = await harness(t, (socket, account) => {
        const loaded = saved;
        onAccountEvent(socket, 'saveLater', async (_payload, reply) => { writing.resolve(); await gate.promise; saved = 99; reply({ saved }); });
        account.on('loaded', (_payload, reply) => reply({ loaded, cleanupCount }));
        account.onClose(async () => { await Promise.resolve(); cleanupCount++; });
        socket.emit('connectionReady');
    });
    const first = await h.connect(h.make(51)); first.emit('saveLater', {}); await writing.promise; first.disconnect();
    const second = h.make(51), arrived = event(second, 'connect'), ready = event(second, 'connectionReady'); second.connect(); await arrived;
    const early = command(second, 'loaded'); assert.equal(saved, 10); gate.resolve(); await ready;
    assert.deepEqual(await early, { loaded: 99, cleanupCount: 1 });
});

test('separate server instances do not evict each other or retain a closed lease', async t => {
    const a = await harness(t), b = await harness(t), one = await a.connect(a.make(61)), two = await b.connect(b.make(61));
    assert(one.connected && two.connected); one.disconnect();
    const replacement = await a.connect(a.make(61)); assert(two.connected); assert.deepEqual(await command(replacement, 'probe'), { userId: 61 });
});

test('server shutdown waits for the final save after closing the transports', async t => {
    const saving = deferred(), gate = deferred(); let saved = false, drained = false;
    t.after(() => gate.resolve());
    const h = await harness(t, (socket, account) => {
        account.onClose(async () => { saving.resolve(); await gate.promise; saved = true; }); socket.emit('connectionReady');
    });
    const socket = await h.connect(h.make(71)), pending = waitForAccountConnections(h.io).then(() => { drained = true; });
    socket.disconnect(); await saving.promise; assert(!saved && !drained); gate.resolve(); await pending; assert(saved && drained);
});

test('client replacement is handled once, stops reconnects and keeps shared browser storage intact', async () => {
    const { bindSessionReplacement } = await import('../vue-explorakit/src/services/realtime.js');
    const socket = new EventEmitter(); let disconnected = 0, redirects = 0;
    socket.disconnect = () => { disconnected++; };
    const previous = global.localStorage, store = new Map([['explorakit.user', 'new-session']]);
    global.localStorage = { removeItem: key => store.delete(key) };
    try {
        bindSessionReplacement(socket, () => redirects++); socket.emit('session:replaced'); socket.emit('drift:replaced');
        assert.equal(disconnected, 1); assert.equal(redirects, 1); assert.equal(store.get('explorakit.user'), 'new-session');
    } finally { global.localStorage = previous; }
});
