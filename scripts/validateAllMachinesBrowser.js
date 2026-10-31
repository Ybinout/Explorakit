// Real shop/Socket.IO/SQL recipe on an isolated server, never the production DB.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), net = require('node:net');
const { spawn } = require('node:child_process'), { once } = require('node:events'), { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
if (process.env.DB_TEST_NAME !== 'explorakit_test') throw Error('Dedicated explorakit_test database required');
process.env.DB_NAME = 'explorakit_test'; process.env.NODE_ENV = 'test';
const { dbPool: db } = require('../server/config/database'), teams = require('../server/persistence/teamRepository');
const factory = require('../server/game/drift/pokemonFactory'), { machines } = require('../server/game/items/machines');
const engine = process.env.PRESENTATION_BROWSER || 'chromium';
assert(['chromium', 'webkit'].includes(engine));
const stage = process.env.RELEASE_DIST_DIR || '/tmp/riftmon-all-cs-dist', output = '/tmp/riftmon-all-cs-' + engine;
assert(fs.existsSync(stage + '/index.html')); fs.mkdirSync(output, { recursive: true });
let child, browser, page, user, success = false;
const errors = [], views = [], timings = [], learned = [];
const cases = [[7, 'cs_bite'], [25, 'cs_fly'], [129, 'cs_hydro_pump'], [26, 'cs_celebrate'], [235, 'cs_dark_void']];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function ready() {
    await page.waitForFunction(() => {
        const v = document.querySelector('.game-root')?.__vue__;
        if (v?.socket?.connected && !v.mapLoading && v.renderedMap === v.map && v.players[v.socket.id]) { window.v = v; return true; }
    });
}
(async () => { try {
    const listener = net.createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
    const port = listener.address().port; await new Promise(resolve => listener.close(resolve)); const base = 'http://127.0.0.1:' + port;
    child = spawn(process.execPath, ['--env-file-if-exists=.env', 'server/index.js'], { cwd: root,
        env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', CLIENT_DIST_DIR: stage }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', () => {}); let stderr = ''; child.stderr.on('data', data => stderr += data);
    for (let i = 0; i < 80; i++) {
        if (child.exitCode !== null) throw Error('Server exited ' + stderr);
        try { if ((await fetch(base)).status === 200) break; } catch { /* Starting. */ }
        await pause(100);
    }
    const response = await fetch(base + '/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'all_cs_' + randomUUID(), password: randomUUID(), starterId: 7 }) });
    assert.equal(response.status, 201); user = await response.json();
    await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,'adventure_opening','complete'),(?,'raphael_defeated','true') ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)", [user.user.id, user.user.id]);
    await db.execute("UPDATE users SET map='tour_etage1',x=432,y=464,money=50000 WHERE id=?", [user.user.id]);
    const pokemon = [...cases.map(([id]) => id), 132].map(id => {
        const p = factory.create(id, 30, true); p.abilities = ['Tackle', 'Tail Whip', 'Water Gun', 'Withdraw']; p.movePp = [2, 3, 4, 5]; return p;
    });
    await teams.editEquipe(user.user.id, { pokemons: pokemon });
    browser = await require('playwright')[engine].launch({ headless: true, ...(engine === 'chromium' ? { args: ['--no-sandbox'] } : {}) });
    const context = await browser.newContext({ viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true });
    await context.addInitScript(saved => { if (location.protocol.startsWith('http')) localStorage.setItem('explorakit.user', JSON.stringify(saved)); }, { ...user.user, token: user.token });
    page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(base, { waitUntil: 'networkidle' });
    for (const mode of ['rift', 'colosseum']) assert.equal(await page.locator(`[data-mode="${mode}"]`).getAttribute('aria-disabled'), 'true');
    await page.locator('[data-mode="adventure"]').click(); await ready();
    let balance = 50000;
    for (const [index, [id, key]] of cases.entries()) {
        const machine = machines[key], target = pokemon[index];
        await page.getByRole('button', { name: 'Acheter', exact: true }).click();
        const before = Date.now(); await page.locator('[data-shop-category="machines"]').click();
        assert.equal(await page.locator('.shop-item').count(), 40); assert.match(await page.locator('.counter-heading').innerText(), /633/); timings.push({ step: 'openAllCS', ms: Date.now() - before });
        if(index===0){await page.locator('[data-shop-more]').click();assert.equal(await page.locator('.shop-item').count(),80);}
        await page.getByRole('searchbox').fill(machine.name);
        const stock = page.locator(`[data-shop-item="${key}"]`); await stock.waitFor();
        assert.equal(await stock.getAttribute('data-shop-locked'), null);
        assert((await stock.locator('[data-shop-move-description]').innerText()).length > 15);
        assert.equal(await stock.locator('[data-shop-move-stats] dd').count(), 4);
        await stock.locator('button').click();
        await page.waitForFunction(key => !v.shop.loading && v.bagItems.some(item => item.key === key && item.quantity === 1), key);
        await page.locator('.shop-close').click(); await page.locator('.menu-toggle-btn').click();
        await page.locator('[data-menu-action="bag"]').click(); await page.locator('[data-bag-pocket="machines"]').click();
        const row = page.locator(`[data-item-key="${key}"]`);
        if (await row.locator('.bag-item-select').getAttribute('aria-expanded') !== 'true') await row.locator('.bag-item-select').click();
        assert(await row.locator(`option[value="${pokemon[5].uuid}"]`).evaluate(node => node.disabled), key + ' Ditto must be incompatible');
        await row.locator('[data-machine-target]').selectOption(target.uuid); await row.locator('[data-machine-slot="0"]').click();
        assert(await row.locator('[data-machine-confirm]').isEnabled());
        if (index === 0) for (const [width, height] of [[320, 640], [393, 852], [1365, 900]]) {
            await page.setViewportSize({ width, height });
            for (const themeMode of ['light', 'dark']) {
                await page.evaluate(themeMode => v.updatePreferences({ ...v.preferences, themeMode }), themeMode);
                assert(await row.evaluate(node => node.scrollWidth <= node.clientWidth + 1));
                await row.locator('[data-machine-confirm]').scrollIntoViewIfNeeded();
                await page.screenshot({ path: path.join(output, `cs-${themeMode}-${width}.png`) }); views.push({ width, height, themeMode });
            }
        }
        await row.locator('[data-machine-confirm]').click();
        await page.waitForFunction(() => !v.medicineBusy && v.medicineNotice.includes('sauvegardée'));
        const saved = (await teams.loadEquipe(user.user.id)).pokemons[index];
        assert.deepEqual(saved.abilities, [machine.move, 'Tail Whip', 'Water Gun', 'Withdraw']);
        assert.deepEqual(saved.movePp, [require('../server/game/battle/battleResources').getMaxMovePp(machine.move), 3, 4, 5]);
        assert.equal((await require('../server/persistence/itemRepository').loadUserItems(user.user.id)).find(item => item.key === key)?.quantity || 0, 0);
        balance -= machine.price; const [[wallet]] = await db.execute('SELECT money FROM users WHERE id=?', [user.user.id]); assert.equal(Number(wallet.money), balance);
        learned.push({ species: id, key, price: machine.price });
        await page.locator('.bag-backdrop .panel-close').click();
    }
    await page.reload({ waitUntil: 'networkidle' }); await ready();
    assert.deepEqual(await page.evaluate(() => v.teamPokemons.slice(0, 5).map(p => p.abilities[0])), cases.map(([, key]) => machines[key].move));
    assert.deepEqual(errors, []);
    const report = { success: true, engine, machines: 633, learned, progressiveRendering: true, incompatibleDisabled: true, sqlAndReload: true, closedModesPreserved: true, views, timings, errors, output };
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); success = true; console.log(JSON.stringify(report));
} finally {
    if (!success && page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
    await browser?.close();
    if (child && child.exitCode === null) { child.kill('SIGTERM'); let timer; await Promise.race([once(child, 'exit'), new Promise(resolve => { timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 10000); })]); clearTimeout(timer); }
    if (user) await db.execute('DELETE FROM users WHERE id=?', [user.user.id]); await db.end();
} })().catch(error => { console.error(error.stack); process.exitCode = 1; });
