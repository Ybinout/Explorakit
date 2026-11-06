// Real authenticated Socket.IO journeys on a disposable test account only.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const {once} = require('node:events'), {randomUUID, createHash} = require('node:crypto');
assert.equal(process.env.DB_TEST_NAME, 'explorakit_test');
process.env.DB_NAME = 'explorakit_test'; process.env.NODE_ENV = 'test';
const express = require('express'), {Server} = require('socket.io'), playwright = require('playwright');
const {dbPool: db} = require('../server/config/database'), terrain = require('../server/game/world/mapRepository');
const pnjs = require('../server/game/world/pnjStore'), crafting = require('../server/game/corruption/heldCrafting');
const engine = process.env.PRESENTATION_BROWSER || 'chromium';
assert(['chromium', 'webkit'].includes(engine));
const dist = process.env.RELEASE_DIST_DIR, out = '/tmp/riftmon-safari-lab-market-' + engine;
assert(dist && fs.existsSync(path.join(dist, 'index.html'))); fs.mkdirSync(out, {recursive: true});
const hooks = new Map(), dark = require('../server/realtime/handlers/darkContinentHandlers'), original = dark.createHandlers;
dark.createHandlers = options => {hooks.set(options.userId, options); return original(options);};
const app = express(), server = http.createServer(app), io = new Server(server);
app.use(express.json()); app.use('/api', require('../server/http/routes')); app.use(express.static(dist));
app.get('*', (_q, r) => r.sendFile(path.join(dist, 'index.html')));
io.use(require('../server/http/authMiddleware').authenticateSocket); require('../server/realtime/socketHandler')(io);
const checks = [], errors = [], views = []; let browser, page, user, success = false;
async function ready() {
    await page.waitForFunction(() => {const v = document.querySelector('.game-root')?.__vue__; if (v?.socket?.connected && !v.mapLoading && v.map === v.renderedMap && v.players[v.socket.id]) {window.v = v; return true;}});
}
async function position() {return page.evaluate(() => {const p = v.players[v.socket.id]; return {x: Math.floor(p.x / 32), y: Math.floor(p.y / 32)};});}
async function walk(action, map, x, y) {
    await page.evaluate(action => v.socket.emit('playerAction', action), action);
    await page.waitForFunction(({map, x, y}) => {const p = v.players[v.socket.id]; return v.map === map && Math.floor(p.x / 32) === x && Math.floor(p.y / 32) === y;}, {map, x, y});
    await ready(); await page.waitForTimeout(155);
}
async function navigate(map, target) {
    const start = await position(), q = [{...start, path: []}], seen = new Set();
    for (const p of q) {
        const key = p.x + ',' + p.y; if (seen.has(key)) continue; seen.add(key);
        if (p.x === target.x && p.y === target.y) {for (const s of p.path) await walk(s.action, map, s.x, s.y); return;}
        for (const [dx, dy, action] of [[0, -1, 'move_z'], [0, 1, 'move_s'], [-1, 0, 'move_q'], [1, 0, 'move_d']]) {
            const x = p.x + dx, y = p.y + dy;
            if (terrain.loadCollisionData(map)[y]?.[x] !== 0 || pnjs.isPnjBlockingTile(map, x, y) || terrain.changeMapData(map)[y]?.[x]) continue;
            q.push({x, y, path: [...p.path, {x, y, action}]});
        }
    }
    throw Error('Unreachable target ' + map + ' ' + JSON.stringify(target));
}
async function layout(label, selector) {
    for (const [width, height] of [[393, 852], [1365, 900]]) {
        await page.setViewportSize({width, height}); await page.waitForTimeout(180);
        if (selector) {
            const g = await page.locator(selector).evaluate(n => {const r = n.getBoundingClientRect(); return {left: r.left, right: r.right, top: r.top, bottom: r.bottom, overflow: n.scrollWidth > n.clientWidth + 1};});
            assert(g.left >= -1 && g.right <= width + 1 && g.top >= -1 && g.bottom <= height + 1 && !g.overflow, JSON.stringify(g));
        }
        const file = label + '-' + width + '.png'; await page.screenshot({path: path.join(out, file)}); views.push(file);
    }
}
(async () => {
    try {
        server.listen(0, '127.0.0.1'); await once(server, 'listening');
        user = await require('../server/persistence/userRepository').createUserWithStarter('Lab_' + randomUUID().slice(0, 8), randomUUID());
        await db.execute("UPDATE users SET map='safari8',x=656,y=432,money=100000,repel_steps=30000 WHERE id=?", [user.id]);
        await db.execute("UPDATE player_story_flags SET flag_value='complete' WHERE user_id=? AND flag_key='adventure_opening'", [user.id]);
        await require('../server/persistence/patchNotesRepository').acknowledge(user.id, require('../data/game/latest_patch.json').version);
        for (const [key, quantity] of [['professional_trainer_card', 1], ...crafting.recipe('corrupted_leftovers').cost.map(c => [c.key, c.quantity])])
            await db.execute('INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,?,?) ON DUPLICATE KEY UPDATE quantity=VALUES(quantity)', [user.id, key, quantity]);
        browser = await playwright[engine].launch({headless: true});
        const context = await browser.newContext({viewport: {width: 393, height: 852}, hasTouch: true, serviceWorkers: 'block'});
        await context.addInitScript(auth => {if (!location.protocol.startsWith('http')) return; localStorage.setItem('explorakit.user', JSON.stringify(auth)); localStorage.setItem('explorakitGamePreferences', JSON.stringify({masterVolume: 0, textSpeed: 10000}));}, {...user, token: require('../server/config/auth').signAccessToken(user)});
        page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
        page.on('response', r => {if (r.status() >= 400 && /\/(?:img|js|css)\//.test(r.url())) errors.push(r.status() + ' ' + r.url());});
        await page.goto('http://127.0.0.1:' + server.address().port + '/game'); await ready();
        await walk('move_z', 'safari_shop', 13, 15); checks.push('painted-market-door-and-correct-arrival');
        assert.equal(terrain.resolveMapSourceName('safari_shop'), 'gen_shop1');
        await navigate('safari_shop', {x: 13, y: 9}); await page.evaluate(() => v.socket.emit('Space'));
        await page.waitForFunction(() => v.shop.visible || v.textImageSequence.length);
        for (let n = 0; n < 10 && await page.evaluate(() => !v.shop.visible); n++) {await page.locator('.dialogue-layer [aria-label="Continuer le dialogue"]').click(); await page.waitForTimeout(100);}
        await page.waitForFunction(() => v.shop.visible && !v.shop.loading && !v.shop.error);
        assert.equal(await page.locator('.held-lab').count(), 0); checks.push('seller-opens-normal-market-only');
        await page.evaluate(() => v.shop.visible = false); await layout('market-room');
        await navigate('safari_shop', {x: 13, y: 15}); await walk('move_s', 'safari8', 20, 13); checks.push('market-exit-returns-outside-market');
        await hooks.get(user.id).travel({map: 'safari9', x: 13 * 32 + 16, y: 6 * 32 + 16}); await page.waitForFunction(() => v.map === 'safari9'); await ready(); await page.waitForTimeout(200);
        await walk('move_z', 'safari_lab', 13, 17); checks.push('separate-house-door-and-laboratory-arrival');
        assert(!require('../server/game/world/shopCatalog').isShopMap('safari_lab'));
        await navigate('safari_lab', {x: 18, y: 10}); await page.evaluate(() => v.socket.emit('Space')); await page.locator('.held-lab').waitFor();
        assert.equal(await page.evaluate(() => v.shop.visible), false); await layout('laboratory-crafting', '.held-lab');
        await page.locator('.held-lab [data-recipe="corrupted_leftovers"]').count().then(async count => {
            if (count) await page.locator('.held-lab [data-recipe="corrupted_leftovers"]').click();
            else await page.locator('.held-lab button').filter({hasText: 'Restes Corrompus'}).click();
        });
        const description = await page.locator('.held-lab').innerText(); assert(description.includes('8 %')); assert(description.includes('troisième'));
        await layout('leftovers-recipe', '.held-lab'); checks.push('new-item-description-in-pc-and-mobile-workshop');
        await page.locator('.held-lab-craft').click(); await page.locator('.held-lab-notice').waitFor();
        assert((await page.locator('.held-lab-notice').innerText()).includes('réussie'));
        const [[saved]] = await db.execute("SELECT quantity FROM user_items WHERE user_id=? AND item_key='corrupted_leftovers'", [user.id]); assert.equal(Number(saved.quantity), 1);
        for (const c of crafting.recipe('corrupted_leftovers').cost) {const [[r]] = await db.execute('SELECT quantity FROM user_items WHERE user_id=? AND item_key=?', [user.id, c.key]); assert.equal(Number(r?.quantity || 0), 0);}
        checks.push('real-craft-transaction-in-new-laboratory');
        await page.locator('.held-lab header button').click(); await layout('laboratory-room');
        await navigate('safari_lab', {x: 13, y: 18}); await walk('move_s', 'safari9', 13, 6); checks.push('laboratory-exit-returns-outside-its-house');
        await page.reload(); await ready(); assert.equal(await page.evaluate(() => v.map), 'safari9'); checks.push('reconnect-preserves-return-location');
        assert.deepEqual(errors, []); success = true;
    } catch (e) {await page?.screenshot({path: path.join(out, 'failure.png')}).catch(() => {}); throw e;} finally {
        await browser?.close(); require('../server/realtime/whitepeakClub').getClub(io).close();
        await new Promise(resolve => io.close(resolve)); await require('../server/realtime/accountConnection').waitForAccountConnections(io);
        if (user) await db.execute('DELETE FROM users WHERE id=?', [user.id]); await db.end();
        fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({success, engine, checks, views, errors, buildIndexSha256: createHash('sha256').update(fs.readFileSync(path.join(dist, 'index.html'))).digest('hex')}, null, 2));
    }
    console.log(JSON.stringify({success, engine, checks, views: views.length}));
})().catch(e => {console.error(e.stack); process.exitCode = 1;});
