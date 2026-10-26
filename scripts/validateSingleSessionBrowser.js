// Disposable accounts and dedicated SQL database only; no real account reset.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { once } = require('node:events'), { randomUUID } = require('node:crypto');
if (!/test/i.test(process.env.DB_TEST_NAME || '')) throw Error('Dedicated test database required');
process.env.DB_NAME = process.env.DB_TEST_NAME; process.env.NODE_ENV = 'test';
const express = require('express'), { Server } = require('socket.io'), { chromium } = require('playwright');
const { dbPool: db } = require('../server/config/database');
const dist = process.env.RELEASE_DIST_DIR || '/tmp/riftmon-single-session-dist', out = process.env.RELEASE_SCREENSHOTS || '/tmp/riftmon-single-session-browser';
fs.mkdirSync(out, { recursive: true });
const app = express(), server = http.createServer(app), io = new Server(server), ids = [], errors = [];
app.use(express.json()); app.use('/api', require('../server/http/routes')); app.use(express.static(dist)); app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
io.use(require('../server/http/authMiddleware').authenticateSocket); require('../server/realtime/socketHandler')(io);
const stop = require('../server/realtime/driftLobbyHandler').registerDriftLobbies(io);
let browser, page, success = false;
(async () => {
    try {
        server.listen(0, '127.0.0.1'); await once(server, 'listening'); const base = 'http://127.0.0.1:' + server.address().port;
        async function account() {
            const response = await fetch(base + '/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'session_ui_' + randomUUID(), password: randomUUID(), starterId: 7 }) });
            assert.equal(response.status, 201); const result = await response.json(); ids.push(result.user.id); return result;
        }
        browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
        async function context(user) {
            const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true });
            await ctx.addInitScript(session => { if (location.protocol.startsWith('http') && !localStorage.getItem('explorakit.user')) localStorage.setItem('explorakit.user', JSON.stringify(session)); }, { ...user.user, token: user.token });
            ctx.on('page', p => { p.on('pageerror', e => errors.push(e.message)); p.on('response', r => { if (r.url().startsWith(base) && r.status() >= 400) errors.push(r.status() + ' ' + r.url()); }); }); return ctx;
        }
        const user = await account(), ctx = await context(user), first = await ctx.newPage(), second = await ctx.newPage(); page = first;
        const ready = p => p.waitForFunction(() => { const v = document.querySelector('.game-root')?.__vue__; return v?.socket?.connected && v.map === v.renderedMap && !v.mapLoading; });
        async function replaced(p) { await p.waitForURL('**/connexion?reason=session-replaced'); await p.locator('[data-session-replaced]').waitFor(); assert.match(await p.locator('[data-session-replaced]').innerText(), /connecter ailleurs/); }
        await first.goto(base + '/game', { waitUntil: 'networkidle' }); await ready(first);
        await first.evaluate(() => document.querySelector('.game-root').__vue__.updatePreferences({ masterVolume: 0 }));
        await second.goto(base + '/game', { waitUntil: 'networkidle' }); await ready(second); await replaced(first);
        await first.screenshot({ path: path.join(out, 'replaced-mobile.png') });
        assert.equal(await second.evaluate(() => JSON.parse(localStorage.getItem('explorakit.user')).token), user.token);
        await first.setViewportSize({ width: 1365, height: 900 }); await first.screenshot({ path: path.join(out, 'replaced-desktop.png') });
        await first.goto(base + '/colosseum', { waitUntil: 'networkidle' }); await first.waitForFunction(() => document.querySelector('[data-colosseum-lobby]')?.__vue__?.connected); await replaced(second);
        await first.evaluate(() => document.querySelector('[data-colosseum-lobby]').__vue__.start()); await first.waitForURL('**/colosseum/game'); await ready(first);
        const run = await first.evaluate(() => document.querySelector('.game-root').__vue__.driftState?.id); assert(run);
        await second.goto(base + '/drift', { waitUntil: 'networkidle' }); await second.waitForFunction(() => document.querySelector('[data-rift-hub]')?.__vue__?.connected); await replaced(first);
        await first.goto(base + '/colosseum/game', { waitUntil: 'networkidle' }); await ready(first); await replaced(second);
        assert.equal(await first.evaluate(() => document.querySelector('.game-root').__vue__.driftState?.id), run);
        const other = await account(), otherContext = await context(other), peer = await otherContext.newPage(); await peer.goto(base + '/game', { waitUntil: 'networkidle' }); await ready(peer);
        assert(await first.evaluate(() => document.querySelector('.game-root').__vue__.socket.connected));
        const active = [...io.sockets.sockets.values(), ...io.of('/drift').sockets.values()].filter(s => s.data.user.id === user.user.id); assert.equal(active.length, 1);
        assert.deepEqual(errors, []); success = true;
        const result = { adventure: true, riftLobby: true, colosseum: true, sameBrowserTabs: true, sharedTokenPreserved: true, otherAccountUnchanged: true, expeditionResumed: true, viewports: [393, 1365], errors };
        fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
    } finally {
        if (!success && page) await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
        await browser?.close(); stop(); await new Promise(r => io.close(r));
        await require('../server/realtime/accountConnection').waitForAccountConnections(io);
        for (const id of ids) await db.execute('DELETE FROM users WHERE id=?', [id]); await db.end();
    }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
