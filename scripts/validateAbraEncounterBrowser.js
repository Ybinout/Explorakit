// Actual Adventure encounter and capture on a disposable SQL account.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const http = require('node:http'), { once } = require('node:events'), { randomUUID } = require('node:crypto');
if (!/test/i.test(process.env.DB_TEST_NAME || '')) throw Error('Dedicated test DB required');
process.env.DB_NAME = process.env.DB_TEST_NAME; process.env.NODE_ENV = 'test'; process.env.BATTLE_DELAY_SCALE = '0';
const express = require('express'), { Server } = require('socket.io'), { chromium } = require('playwright');
const { dbPool: db } = require('../server/config/database'), teams = require('../server/persistence/teamRepository');
const { waitForAccountConnections } = require('../server/realtime/accountConnection');
const dist = process.env.RELEASE_DIST_DIR || '/tmp/riftmon-aspha-reference-dist';
const out = process.env.RELEASE_SCREENSHOTS || '/tmp/riftmon-abra-browser'; fs.mkdirSync(out, { recursive: true });
const app = express(), server = http.createServer(app), io = new Server(server);
app.use(express.json()); app.use('/api', require('../server/http/routes')); app.use(express.static(dist));
app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
io.use(require('../server/http/authMiddleware').authenticateSocket); require('../server/realtime/socketHandler')(io);
let browser, page, user, base, passed = false;
const errors = [], screenshots = [], originalRandom = Math.random;
async function ready() {
    await page.waitForFunction(() => {
        const v = document.querySelector('.game-root')?.__vue__;
        if (!v?.socket?.connected || v.mapLoading || v.renderedMap !== v.map || !v.players[v.socket.id]) return false;
        window.v = v; return true;
    });
}
async function atGrass() {
    if (await page.locator('.game-root').count()) {
        await page.evaluate(() => new Promise(resolve => v.socket.emit('requestGameSave', resolve)));
        await page.evaluate(() => v.socket.disconnect()); await waitForAccountConnections(io);
        await page.goto('about:blank');
    }
    await db.execute("UPDATE users SET map='route2', x=48, y=144, repel_steps=0 WHERE id=?", [user.user.id]);
    await page.goto(base + '/game', { waitUntil: 'networkidle' }); await ready();
}
async function encounter(expected) {
    Math.random = () => .01; await page.evaluate(() => v.socket.emit('playerAction', 'move_d'));
    await page.locator('.action-bag:enabled').waitFor();
    assert.equal(await page.evaluate(() => v.$refs.battleOverlay.opponent.data.id), expected);
    assert(await page.evaluate(() => v.$refs.battleOverlay.opponent.level >= 11 && v.$refs.battleOverlay.opponent.level <= 15));
    await page.waitForFunction(() => [...document.querySelectorAll('.battle-sprite')].every(image => image.complete && image.naturalWidth > 0));
}
(async () => {
    try {
        server.listen(0, '127.0.0.1'); await once(server, 'listening'); base = `http://127.0.0.1:${server.address().port}`;
        const response = await fetch(base + '/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'abra_ui_' + randomUUID(), password: randomUUID(), starterId: 7 }) });
        assert.equal(response.status, 201); user = await response.json();
        const lead = require('../server/game/drift/pokemonFactory').create(25, 25, true);
        await teams.editEquipe(user.user.id, { pokemons: [lead] });
        await db.execute("INSERT INTO user_items(user_id,item_key,quantity)VALUES(?,'pokeball',5)ON DUPLICATE KEY UPDATE quantity=5", [user.user.id]);
        browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
        const context = await browser.newContext({ viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true });
        await context.addInitScript(value => { if (location.protocol.startsWith('http')) localStorage.setItem('explorakit.user', JSON.stringify(value)); }, { ...user.user, token: user.token });
        page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
        page.on('response', r => { if (r.url().startsWith(base) && r.status() >= 400) errors.push(r.status() + ' ' + r.url()); });
        await atGrass(); await encounter(63);
        for (const [width, height] of [[320, 568], [393, 852], [844, 390], [1365, 900]]) {
            await page.setViewportSize({ width, height });
            await page.evaluate(async width => { v.showMobileControls = width <= 920; await v.$nextTick(); v.resizeWorldViewport(); }, width);
            await page.waitForTimeout(120); const file = 'abra-' + width + '.png'; await page.screenshot({ path: path.join(out, file) }); screenshots.push(file);
        }
        Math.random = () => 0; await page.locator('.action-bag').click();
        await page.locator('.battle-choice-btn-bag').filter({ hasText: 'Pokeball' }).click();
        await page.locator('[data-battle-result-continue]').click();
        await page.waitForFunction(() => !v.battle && !v.movementBlocked); Math.random = originalRandom;
        const caught = (await teams.loadEquipe(user.user.id)).pokemons.find(p => p.data.id === 63); assert(caught);
        await atGrass(); assert((await teams.loadEquipe(user.user.id)).pokemons.some(p => p.uuid === caught.uuid));
        await encounter(12); await page.locator('.action-flee').click();
        await page.locator('[data-battle-result-continue]').click(); await page.waitForFunction(() => !v.battle && !v.movementBlocked);
        const [rows] = await db.execute('SELECT seen_count,caught_count FROM user_pokedex WHERE user_id=? AND pokemon_id=63', [user.user.id]);
        assert(Number(rows[0].seen_count) > 0); assert.equal(Number(rows[0].caught_count), 1); assert.deepEqual(errors, []);
        passed = true; const result = { actualRoute2GrassRoll: true, guaranteedAbra: true, zoneLevelPreserved: true, normalCapture: true,
            captureAndPokedexPersisted: true, reconnect: true, laterDrawIsNormal: true, viewports: 4, screenshots, errors };
        fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result));
    } finally {
        Math.random = originalRandom;
        if (!passed && page) await page.screenshot({ path: path.join(out, 'failure.png'), fullPage: true }).catch(() => {});
        await browser?.close(); await waitForAccountConnections(io); await new Promise(resolve => io.close(resolve));
        if (user) await db.execute('DELETE FROM users WHERE id=?', [user.user.id]); await db.end();
    }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
