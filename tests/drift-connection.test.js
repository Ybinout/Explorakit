const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { once } = require('node:events');
const { Server } = require('socket.io');
const { signAccessToken } = require('../server/config/auth');
const { authenticateSocket } = require('../server/http/authMiddleware');

async function loadWorldMount(createGameSocket, createDriftSocket) {
    // Execute the actual Vue lifecycle hook; only canvas/DOM rendering is stubbed.
    const { WORLD_WIDTH, WORLD_HEIGHT } = await import('../vue-explorakit/src/services/worldCamera.js');
    const source = fs.readFileSync(path.resolve(__dirname, '../vue-explorakit/src/components/UserMap.vue'), 'utf8');
    const script = require('../vue-explorakit/node_modules/vue-template-compiler').parseComponent(source).script.content;
    const ast = require('../vue-explorakit/node_modules/@babel/parser').parse(script, { sourceType: 'module' });
    const component = ast.program.body.find(node => node.type === 'ExportDefaultDeclaration').declaration;
    const mounted = component.properties.find(node => node.key.name === 'mounted');
    return new Function('createGameSocket', 'createDriftSocket', 'document', 'window', 'console', 'WORLD_WIDTH', 'WORLD_HEIGHT', 'ResizeObserver', 'attachGamePopupLayout',
        `return ({${script.slice(mounted.start, mounted.end)}}).mounted;`)(
        createGameSocket, createDriftSocket, { body: { classList: { add() {} } }, addEventListener() {} },
        { addEventListener() {} }, { log() {}, error() {} }, WORLD_WIDTH, WORLD_HEIGHT,
        class { observe(element) { assert(element, 'The world viewport must be mounted'); } },
        () => () => {} // Layout is exercised in the browser recipe, alongside real DOM geometry.
    );
}

function event(socket, name) {
    return new Promise((resolve, reject) => {
        const listener = value => { clearTimeout(timer); resolve(value); };
        const timer = setTimeout(() => {
            socket.off(name, listener);
            reject(new Error(`Événement absent : ${name}`));
        }, 3000);
        socket.once(name, listener);
    });
}

test('Connexion au camp : distinguer un ancien serveur, une session refusée et une panne réseau', { timeout: 12000 }, async t => {
    const server = http.createServer();
    const io = new Server(server);
    const sockets = [];
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const previousOrigin = process.env.VUE_APP_SOCKET_URL;
    process.env.VUE_APP_SOCKET_URL = `http://127.0.0.1:${server.address().port}`;
    const servicePath = pathToFileURL(path.resolve(__dirname, '../vue-explorakit/src/services/realtime.js'));
    const { createGameSocket, createDriftSocket, getDriftConnectionFailure } = await import(servicePath.href);
    if (previousOrigin === undefined) delete process.env.VUE_APP_SOCKET_URL;
    else process.env.VUE_APP_SOCKET_URL = previousOrigin;
    const makeSocket = token => {
        const socket = createDriftSocket(token);
        socket.io.reconnection(false);
        sockets.push(socket);
        return socket;
    };
    const token = signAccessToken({ id: 73, username: 'Dresseur' });
    let serverClosed = false;
    try {
        await t.test('le compte valide reste utilisable après activation du namespace Drift', async () => {
            const socket = makeSocket(token);
            const refused = event(socket, 'connect_error');
            socket.connect();
            const failure = getDriftConnectionFailure(await refused);
            assert.equal(failure.kind, 'server');
            assert.match(failure.message, /serveur.*Drift/);
            assert.doesNotMatch(failure.message, /compte|session|reconnecte/i);
            assert.equal(socket.active, false, 'un namespace refusé exige un nouvel appel connect');

            io.of('/drift').use(authenticateSocket).on('connection', client => client.emit('drift:bootstrap', { ready: true }));
            const bootstrapped = event(socket, 'drift:bootstrap');
            socket.connect();
            assert.deepEqual(await bootstrapped, { ready: true });
            assert.equal(socket.connected, true, 'la même session rejoint le mode après activation');
            socket.disconnect();
        });

        await t.test('seul un refus d’authentification demande la reconnexion au compte', async () => {
            for (const invalidToken of ['', 'invalid-token']) {
                const socket = makeSocket(invalidToken);
                const refused = event(socket, 'connect_error');
                socket.connect();
                const failure = getDriftConnectionFailure(await refused);
                assert.equal(failure.kind, 'session');
                assert.match(failure.message, /session.*Reconnecte-toi/);
                socket.disconnect();
            }
        });

        await t.test('le bouton solo ouvre le monde Aventure après un camp ayant désactivé autoConnect', async () => {
            io.use(authenticateSocket).on('connection', client => client.emit('adventure:ready', { userId: client.data.user.id }));
            const instance = {
                isDrift: false, pc:{visible:false}, saveState: { lastSyncedAt: null }, $refs: { monCanvas: {}, worldViewport: {} },
                $nextTick: callback => callback(),
                getStoredUserId: () => 73, getStoredUsername: () => 'Dresseur', getStoredToken: () => token,
                ensureSpriteSheet: () => ({ complete: true })
            };
            for (const name of ['loadMapImage', 'loadForegroundImage', 'loadAvailableSprites', 'loadPnjSpriteSources',
                'handleKeydown', 'handleKeyup', 'handleOutsideMenuClick', 'updateMobileControlsVisibility',
                'releaseAllMovementKeys', 'startGameLoop', 'startMovementLoop', 'resizeWorldViewport']) instance[name] = () => {};
            (await loadWorldMount(createGameSocket, createDriftSocket)).call(instance);
            const socket = instance.socket;
            sockets.push(socket);
            socket.io.reconnection(false);
            assert.equal(socket.io, sockets[0].io, 'les deux namespaces réutilisent réellement le manager du premier camp');
            assert.equal(socket.io._autoConnect, false, 'le manager conserve le réglage du camp fermé');
            assert.deepEqual(await event(socket, 'adventure:ready'), { userId: 73 });
            assert.equal(socket.connected, true);
            assert.equal(instance.saveState.message, 'Connecté : sauvegarde automatique active.');
            socket.disconnect();
        });

        await t.test('une panne transport conserve le compte et propose de réessayer', async () => {
            await new Promise(resolve => io.close(resolve));
            serverClosed = true;
            const socket = makeSocket(token);
            const refused = event(socket, 'connect_error');
            socket.connect();
            const failure = getDriftConnectionFailure(await refused);
            assert.equal(failure.kind, 'network');
            assert.match(failure.message, /réessaie/);
            assert.doesNotMatch(failure.message, /compte|session|reconnecte/i);
        });
    } finally {
        sockets.forEach(socket => socket.disconnect());
        if (!serverClosed) await new Promise(resolve => io.close(resolve));
    }
});
