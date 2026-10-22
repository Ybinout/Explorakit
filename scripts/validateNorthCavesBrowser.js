// Ordinary movement and interactions on isolated server / dedicated database only.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { once } = require('node:events'), { randomUUID } = require('node:crypto');
if (!/test/i.test(process.env.DB_TEST_NAME || '')) throw Error('Dedicated test database required');
process.env.DB_NAME = process.env.DB_TEST_NAME; process.env.NODE_ENV = 'test';
const express = require('express'), { Server } = require('socket.io'), { chromium } = require('playwright');
const { dbPool } = require('../server/config/database');
const { validateNorthCaves } = require('./validateNorthCavesUi');
const { io: connectClient } = require('../vue-explorakit/node_modules/socket.io-client');
const factory = require('../server/game/drift/pokemonFactory');
const dist = process.env.RELEASE_DIST_DIR || '/tmp/explorakit-north-caves-dist';
const output = process.env.RELEASE_SCREENSHOTS || '/tmp/explorakit-north-caves-browser'; fs.mkdirSync(output, { recursive: true });
const app = express(), server = http.createServer(app), io = new Server(server, { path: '/explorakit/socket.io' });
app.use(express.json()); app.use('/explorakit/api', require('../server/http/routes')); app.use('/explorakit', express.static(dist));
app.get('*', (_q, r) => r.sendFile(path.join(dist, 'index.html')));
io.use(require('../server/http/authMiddleware').authenticateSocket); require('../server/realtime/socketHandler')(io);
const store = require('../server/game/drift/lobbyStore').createLobbyStore();
const cleanup = require('../server/realtime/driftLobbyHandler').registerDriftLobbies(io, { store, runtimeOptions: { paceMs: 0 } });
let browser, page, base, partnerSocket, success = false;
const ids = [], errors = [], originalRandom = Math.random;
async function create() {
    const r = await fetch(base + '/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'north_' + randomUUID(), password: randomUUID(), starterId: 7 }) });
    assert.equal(r.status, 201); const f = await r.json(); ids.push(f.user.id); return f;
}
function seed(p) { Object.assign(p, { currentmap: 'ville4', x: 432, y: 144, equipe: { pokemons: [factory.create(9, 100, true)] }, items: { max_repel: 8 }, money: 5000, lastMove: 0 }); }
async function capture(label, mode) {
    for (const [width, height] of mode === 'adventure' ? [[320, 480], [393, 852], [844, 390], [1365, 900]] : [[393, 852]]) {
        await page.setViewportSize({ width, height });
        await page.waitForFunction(() => {
            const v = window.cavesVm;
            return v.mapImage.naturalWidth === 448 && v.foregroundImage.naturalWidth === 448 && document.documentElement.scrollWidth <= innerWidth + 1;
        });
        await page.screenshot({ path: path.join(output, `${mode}-${label}-${width}.png`) });
    }
}
(async () => { try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening'); base = `http://127.0.0.1:${server.address().port}/explorakit`;
    const fixture = await create();
    const repo = require('../server/persistence/teamRepository');
    await repo.editEquipe(fixture.user.id, { pokemons: [factory.create(9, 100, true)] });
    await dbPool.execute('UPDATE users SET map=?,x=?,y=?,money=5000 WHERE id=?', ['ville4', 432, 144, fixture.user.id]);
    await dbPool.execute("INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,'max_repel',8)", [fixture.user.id]);
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true });
    await context.addInitScript(s => { if (/^https?:$/.test(location.protocol)) localStorage.setItem('explorakit.user', JSON.stringify(s)); }, { ...fixture.user, token: fixture.token });
    page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    page.on('response', r => { if (r.url().startsWith(base) && r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
    let adventure = null, colosseum = null;
    if (!process.env.NORTH_CAVES_RIFT_ONLY) {
        await page.goto(base + '/game', { waitUntil: 'networkidle' });
        adventure = await validateNorthCaves(page, { capture: label => capture(label, 'adventure') });
        await page.goto(base + '/colosseum', { waitUntil: 'networkidle' });
        await page.locator('[data-colosseum-start]:enabled').click(); await page.locator('[data-starter-choice]').first().click();
        await page.locator('.starter-backdrop').waitFor({ state: 'hidden' });
        const p = cleanup.runtime.playerFor(fixture.user); seed(p);
        await page.reload({ waitUntil: 'networkidle' });
        colosseum = await validateNorthCaves(page, { capture: label => capture(label, 'colosseum') });
        cleanup.runtime.abandon(p); store.leave(fixture.user);
    }
    const second = await create(); store.connect(fixture.user, 'north-host');
    // The longer city journey exceeds the disconnect grace period. Keep the
    // second player genuinely connected throughout the Rift round trip.
    partnerSocket = connectClient(base.replace(/\/explorakit$/, '') + '/drift', {
        path: '/explorakit/socket.io', auth: { token: second.token }, transports: ['websocket'], reconnection: false, autoConnect: false
    });
    await new Promise((resolve, reject) => {
        partnerSocket.once('connect', resolve); partnerSocket.once('connect_error', reject); partnerSocket.connect();
    });
    const lobby = store.create(fixture.user, { capacity: 2, durationMinutes: 30 }); store.join(second.user, lobby.code);
    for (const f of [fixture, second]) store.ready(f.user, true);
    await cleanup.runtime.start(fixture.user);
    for (const f of [fixture, second]) { const player = cleanup.runtime.playerFor(f.user); cleanup.runtime.chooseStarter(player, player.starterChoices[0].uuid); seed(player); }
    const partnerEntry = await new Promise((resolve, reject) => partnerSocket.timeout(8000).emit('drift:enter', {}, (error, response) => error ? reject(error) : resolve(response)));
    assert(partnerEntry.success);
    assert.equal(cleanup.runtime.playerFor(second.user).socketId, partnerSocket.id);
    assert.equal(cleanup.runtime.playerFor(second.user).disconnectedAt, null);
    await page.goto(base + '/drift/game', { waitUntil: 'networkidle' });
    const rift = await validateNorthCaves(page, { capture: label => capture(label, 'rift') });
    // Real wild encounter on this owned fixture, with RNG controlled only here.
    await page.goto('about:blank'); await page.waitForTimeout(250);
    const maps = require('../server/game/world/mapRepository'), name = 'cave_rochebrume3';
    const c = maps.loadCollisionData(name), t = maps.changeMapData(name), wild = maps.battleMapData(name);
    let pair;
    for (let y = 1; y < 19 && !pair; y++) for (let x = 1; x < 26 && !pair; x++) {
        if (wild[y][x + 1] && !c[y][x] && !c[y][x + 1] && !t[y][x] && !t[y][x + 1]) pair = { x, y };
    }
    assert(pair);
    await dbPool.execute('UPDATE users SET map=?,x=?,y=?,repel_steps=0 WHERE id=?', [name, pair.x * 32 + 16, pair.y * 32 + 16, fixture.user.id]);
    await page.goto(base + '/game', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => {
        const v = document.querySelector('.game-root')?.__vue__;
        if (!v?.socket?.connected || v.renderedMap !== 'cave_rochebrume3' || v.mapLoading) return false;
        window.cavesVm = v; return true;
    });
    Math.random = () => 0;
    await page.evaluate(() => window.cavesVm.socket.emit('playerAction', 'move_d'));
    await page.locator('.action-flee:enabled').waitFor(); Math.random = originalRandom;
    assert.equal(await page.evaluate(() => window.cavesVm.$refs.battleOverlay.environment), 'cave');
    assert.equal(await page.evaluate(() => window.cavesVm.$refs.battleOverlay.fieldState.weather), null);
    assert.equal(await page.locator('.cave-disc').count(), 2);
    for (const [width, height] of [[320, 480], [393, 852], [844, 390], [1365, 900]]) {
        await page.setViewportSize({ width, height });
        await page.waitForFunction(() => [...document.querySelectorAll('.battle-background')].some(i => i.complete && i.naturalWidth > 0));
        await page.screenshot({ path: path.join(output, `battle-${width}.png`) });
    }
    await page.locator('.action-flee:enabled').click();
    await page.locator('[data-battle-result-continue]').waitFor();
    await page.locator('[data-battle-result-continue]').click();
    await page.waitForFunction(() => !window.cavesVm.battle);
    assert.deepEqual(errors, []); success = true;
    console.log(JSON.stringify({ adventure, colosseum, rift, realCaveEncounterAndFlee: true, cavePlatforms: 2, viewports: 4, errors, output }));
} finally {
    Math.random = originalRandom;
    if (!success && page) await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
    await browser?.close(); partnerSocket?.disconnect(); cleanup(); await new Promise(resolve => io.close(resolve)); await new Promise(resolve => setTimeout(resolve, 200));
    for (const id of ids) await dbPool.execute('DELETE FROM users WHERE id=?', [id]);
    await dbPool.end();
} })().catch(e => { console.error(e.stack); process.exitCode = 1; });
