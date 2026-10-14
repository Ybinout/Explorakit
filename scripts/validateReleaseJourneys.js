const assert = require('node:assert/strict'),
    { spawn } = require('node:child_process'),
    { randomUUID } = require('node:crypto');
const mysql = require('mysql2/promise'),
    { io } = require('../vue-explorakit/node_modules/socket.io-client');
const database = process.env.DB_TEST_NAME;
if (!/test/i.test(database || '')) throw Error('Base de test dédiée requise.');
const port = Number(process.env.RELEASE_TEST_PORT || 31490),
    base = `http://127.0.0.1:${port}`;
let child, db;
const fixtures = [],
    sockets = [];
let runId;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function start() {
    child = spawn(process.execPath, ['server/index.js'], {
        cwd: require('node:path').resolve(__dirname, '..'),
        env: {
            ...process.env,
            DB_NAME: database,
            PORT: String(port),
            NODE_ENV: 'test',
            RIFT_DURABILITY: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(Error('Startup timeout')), 12000);
        child.stdout.on('data', (d) => {
            if (String(d).includes('Server is running')) {
                clearTimeout(timeout);
                resolve();
            }
        });
        child.stderr.on('data', (d) => process.stderr.write(d));
        child.once('exit', (c) => {
            clearTimeout(timeout);
            reject(Error('Server exited ' + c));
        });
    });
}
async function stop(signal = 'SIGTERM') {
    if (!child || child.exitCode !== null) return;
    await new Promise((r) => {
        child.once('exit', r);
        child.kill(signal);
    });
}
async function request(path, token, body) {
    const r = await fetch(base + '/api' + path, {
        method: body ? 'POST' : 'GET',
        headers: {
            ...(token ? { Authorization: 'Bearer ' + token } : {}),
            'Content-Type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert(r.ok, `${r.status}: ${path}`);
    return r.json();
}
async function connect(f) {
    const s = io(base + '/drift', {
        auth: { token: f.token },
        transports: ['websocket'],
        autoConnect: false,
    });
    sockets.push(s);
    await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(Error('connect timeout')), 8000);
        s.once('drift:bootstrap', () => {
            clearTimeout(t);
            resolve();
        });
        s.once('connect_error', reject);
        s.connect();
    });
    return s;
}
const command = (s, event, payload = {}) =>
    new Promise((resolve, reject) =>
        s
            .timeout(8000)
            .emit(event, payload, (e, r) =>
                e
                    ? reject(e)
                    : r?.ok === false || r?.success === false
                    ? reject(Error(r.message))
                    : resolve(r)
            )
    );
(async () => {
    try {
        db = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database,
        });
        await db.execute('DELETE FROM rift_checkpoints');
        await start();
        for (let i = 0; i < 3; i++)
            fixtures.push(
                await request('/users', null, {
                    username: 'journey_' + randomUUID(),
                    password: 'Release-journey-password',
                    starterId: 7,
                })
            );
        let a = await connect(fixtures[0]),
            b = await connect(fixtures[1]);
        const room = await command(a, 'drift:create', {
            capacity: 2,
            durationMinutes: 20,
            visibility: 'private',
        });
        await command(b, 'drift:join', { code: room.lobby.code });
        await command(a, 'drift:ready', { ready: true });
        await command(b, 'drift:ready', { ready: true });
        await command(a, 'drift:start');
        const before = (await command(a, 'drift:enter')).state;
        await command(b, 'drift:enter');
        runId = before.id;
        await pause(1600);
        const [[olderCheckpoint]]=await db.execute('SELECT payload FROM rift_checkpoints WHERE id=1');
        await stop('SIGKILL');
        sockets.forEach((s) => s.disconnect());
        await start();
        a = await connect(fixtures[0]);
        b = await connect(fixtures[1]);
        const restored = (await command(a, 'drift:enter')).state;
        await command(b, 'drift:enter');
        assert.equal(restored.id, before.id);
        assert.equal(restored.team[0].uuid, before.team[0].uuid);
        assert(restored.endsAt >= before.endsAt);
        await pause(350);
        await command(b, 'drift:abandon');
        await pause(700);
        const reports = await request('/rift/history', fixtures[0].token);
        assert.equal(reports.reports[0].runId, runId);
        const outsider = await request('/rift/history', fixtures[2].token);
        assert.equal(outsider.reports.length, 0);
        await stop();
        // Simulate SQL settlement committing just before the final checkpoint write.
        await db.execute('UPDATE rift_checkpoints SET payload=? WHERE id=1',[olderCheckpoint.payload]);
        await start();
        const settled = await connect(fixtures[0]);
        const finalState=(await command(settled,'drift:enter')).state;
        assert.equal(finalState.phase,'results');
        assert.equal(finalState.winnerId,fixtures[0].user.id);
        assert.deepEqual(finalState.report,reports.reports[0]);
        assert.equal((await request('/rift/profile',fixtures[0].token)).wins,1);
        const again = await request('/rift/history', fixtures[0].token);
        assert.equal(again.reports[0].runId, runId);
        console.log(
            JSON.stringify({
                crashRecovery: true,
                sameTeam: true,
                pausedClock: true,
                reportSaved: true,
                reportPrivate: true,
                secondRestart: true,
                olderCheckpointReconciled: true,
            })
        );
    } finally {
        sockets.forEach((s) => s.disconnect());
        await stop();
        if (db) {
            await db.execute('DELETE FROM rift_checkpoints');
            if (runId) await db.execute('DELETE FROM rift_runs WHERE id=?', [runId]);
            for (const f of fixtures) await db.execute('DELETE FROM users WHERE id=?', [f.user.id]);
            await db.end();
        }
    }
})().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
