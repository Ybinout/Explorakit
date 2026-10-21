const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');

function event(socket, name, predicate = () => true) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            socket.off(name, listener);
            reject(new Error(`Événement ${name} absent`));
        }, 8000);
        const listener = payload => {
            if (!predicate(payload)) return;
            clearTimeout(timer);
            socket.off(name, listener);
            resolve(payload);
        };
        socket.on(name, listener);
    });
}

test('Centre partagé : deux joueurs, reconnexion, redémarrage, nouvelle entrée et défaite gardent le bon retour', {
    skip: process.env.RUN_MYSQL_TESTS !== '1', timeout: 45000
}, async () => {
    const testDatabase = process.env.DB_TEST_NAME || `${process.env.DB_NAME}_test`;
    assert.match(testDatabase, /test/i);
    assert.equal(process.env.DB_NAME, testDatabase, 'Utiliser npm run test:mysql');
    const { dbPool } = require('../server/config/database');
    const { io } = require('../vue-explorakit/node_modules/socket.io-client');
    const url = `http://127.0.0.1:${process.env.CENTER_TEST_PORT || 31239}`;
    const accounts = [];
    let child;
    let logs = '';
    async function start() {
        child = spawn(process.execPath, ['server/index.js'], {
            cwd: path.resolve(__dirname, '..'),
            env: { ...process.env, PORT: new URL(url).port, JWT_SECRET: 'center-test-only', NODE_ENV: 'test' },
            stdio: ['ignore', 'pipe', 'pipe']
        });
        child.stderr.on('data', chunk => { logs += String(chunk); });
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`Démarrage impossible : ${logs}`)), 8000);
            child.stdout.on('data', chunk => {
                if (String(chunk).includes('Server is running')) { clearTimeout(timer); resolve(); }
            });
            child.once('error', error => { clearTimeout(timer); reject(error); });
            child.once('exit', code => { clearTimeout(timer); reject(new Error(`Serveur arrêté : ${code}, ${logs}`)); });
        });
    }
    async function stop() {
        if (child && child.exitCode === null && child.signalCode === null) {
            const stopped = once(child, 'exit');
            child.kill('SIGTERM');
            await stopped;
        }
    }
    async function connect(account) {
        const socket = io(url, { autoConnect: false, auth: { token: account.token }, transports: ['websocket'], reconnection: false });
        account.socket = socket;
        const position = event(socket, 'playersList');
        const ready = event(socket, 'progressionState');
        socket.connect();
        const [players] = await Promise.all([position, ready]);
        return players[socket.id];
    }
    async function save(account) {
        await new Promise((resolve, reject) => account.socket.timeout(5000).emit('requestGameSave', (error, result) => {
            if (error || !result?.success) reject(error || new Error(`Sauvegarde refusée : ${result?.message || result?.code || 'sans motif'}\n${logs}`));
            else resolve();
        }));
    }
    async function move(account, action, changesMap = false) {
        await delay(160);
        const socket = account.socket;
        const response = changesMap ? event(socket, 'newmap') : event(socket, 'playerMoved', payload => payload.id === socket.id);
        socket.emit('playerAction', action);
        return response;
    }
    async function exit(account, expected) {
        if(!['gen_ville5','ville3','ville4'].includes(expected.map))await move(account, 'move_z');
        const result = await move(account, 'move_s', true);
        const player = result.playersList[account.socket.id];
        assert.deepEqual({ map: result.mapname, x: player.x, y: player.y }, expected);
        await save(account);
    }
    try {
        await start();
        for (const [index, map, x, y] of [[0, 'ville1', 496, 304], [1, 'route4', 720, 144], [2, 'gen_ville5', 560, 272], [3, 'ville3', 752, 240], [4, 'ville4', 144, 304]]) {
            const response = await fetch(`${url}/api/users`, {
                method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ username: `center_${Date.now()}_${index}`, password: 'center-test-password', starterId: 7 })
            });
            assert.equal(response.status, 201);
            const registration = await response.json();
            const account = { id: registration.user.id, token: registration.token, origin: { map, x, y } };
            accounts.push(account);
            await dbPool.execute('UPDATE users SET map = ?, x = ?, y = ? WHERE id = ?', [map, x, y, account.id]);
            await connect(account);
            assert.equal((await move(account, 'move_z', true)).mapname, 'centre');
            await save(account);
        }
        // Players from all five entrances share one interior, but their origins must survive a process restart.
        accounts.forEach(account => account.socket.disconnect());
        await stop();
        await start();
        for (const account of accounts) {
            assert.equal((await connect(account)).currentmap, 'centre');
            await exit(account, account.origin);
        }
        const routePlayer = accounts[1];
        // Re-enter, disconnect inside and restore from MySQL again without restarting.
        await move(routePlayer, 'move_z', true);
        await save(routePlayer);
        routePlayer.socket.disconnect();
        assert.equal((await connect(routePlayer)).currentmap, 'centre');
        await exit(routePlayer, routePlayer.origin);

        // A later defeat elsewhere must retain the last center's exterior.
        routePlayer.socket.disconnect();
        await dbPool.execute("UPDATE users SET map = 'ville1', x = 496, y = 304 WHERE id = ?", [routePlayer.id]);
        await dbPool.execute('UPDATE pokemons p JOIN teams t ON t.id = p.team_id SET p.current_hp = 0 WHERE t.user_id = ?', [routePlayer.id]);
        const revived = await connect(routePlayer);
        assert.equal(revived.currentmap, 'centre');
        await move(routePlayer, 'move_s');
        for (let index = 0; index < 4; index++) await move(routePlayer, 'move_d');
        const result = await move(routePlayer, 'move_s', true);
        assert.equal(result.mapname, 'route4');
        assert.equal(result.playersList[routePlayer.socket.id].x, 720);
        assert.equal(result.playersList[routePlayer.socket.id].y, 144);
        await save(routePlayer);
        // A newly visited center replaces the previous return instead of keeping it forever.
        routePlayer.socket.disconnect();
        await dbPool.execute("UPDATE users SET map = 'ville1', x = 496, y = 304 WHERE id = ?", [routePlayer.id]);
        await connect(routePlayer);
        await move(routePlayer, 'move_z', true);
        await exit(routePlayer, accounts[0].origin);
        assert.equal(logs, '', `Aucune erreur serveur attendue : ${logs}`);
    } finally {
        accounts.forEach(account => account.socket?.disconnect());
        await stop();
        for (const account of accounts) await dbPool.execute('DELETE FROM users WHERE id = ?', [account.id]);
        await dbPool.end();
    }
});
