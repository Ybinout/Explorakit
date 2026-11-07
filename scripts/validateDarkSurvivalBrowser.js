// Disposable SQL account, real browser actions and a private encounter fixture.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const {once} = require('node:events'), {randomUUID, createHash} = require('node:crypto');
assert.equal(process.env.DB_TEST_NAME, 'explorakit_test'); process.env.DB_NAME = 'explorakit_test'; process.env.NODE_ENV = 'test';
const express = require('express'), {Server} = require('socket.io'), playwright = require('playwright');
const {dbPool: db} = require('../server/config/database'), teams = require('../server/persistence/teamRepository');
const factory = require('../server/game/drift/pokemonFactory'), items = require('../server/persistence/itemRepository');
const contexts = new Map(), battleHandlers = require('../server/realtime/handlers/darkBattleHandlers'), originalBattle = battleHandlers.createHandlers;
battleHandlers.createHandlers = options => {const h = originalBattle(options); contexts.set(options.userId, {...options, h}); return h;};
const travel = new Map(), darkHandlers = require('../server/realtime/handlers/darkContinentHandlers'), originalDark = darkHandlers.createHandlers;
darkHandlers.createHandlers = options => {travel.set(options.userId, options); return originalDark(options);};
const engine = process.env.PRESENTATION_BROWSER || 'chromium', dist = process.env.RELEASE_DIST_DIR;
assert(['chromium', 'webkit'].includes(engine)); assert(dist && fs.existsSync(path.join(dist, 'index.html')));
const out = '/tmp/riftmon-dark-survival-' + engine; fs.mkdirSync(out, {recursive: true});
const app = express(), server = http.createServer(app), io = new Server(server);
app.use(express.json()); app.use('/api', require('../server/http/routes')); app.use(express.static(dist)); app.get('*', (_q, r) => r.sendFile(path.join(dist, 'index.html')));
io.use(require('../server/http/authMiddleware').authenticateSocket); require('../server/realtime/socketHandler')(io);
const errors = [], checks = [], views = []; let user, browser, page, success = false, fogPerformance;
async function ready() {await page.waitForFunction(() => {const v = document.querySelector('.game-root')?.__vue__; if (v?.socket?.connected && !v.mapLoading && v.map === v.renderedMap && v.players[v.socket.id]) {window.v = v; return true;}});}
async function capture(label, selector) {
    for (const [width, height] of [[393, 852], [1365, 900]]) {
        await page.setViewportSize({width, height}); await page.waitForTimeout(200);
        if (selector) {const b = await page.locator(selector).evaluate(n => {const r = n.getBoundingClientRect(); return {left: r.left, right: r.right, top: r.top, bottom: r.bottom, overflow: n.scrollWidth > n.clientWidth + 1};}); assert(b.left >= -1 && b.right <= width + 1 && b.top >= -1 && b.bottom <= height + 1 && !b.overflow, JSON.stringify(b));}
        const file = label + '-' + width + '.png'; await page.screenshot({path: path.join(out, file)}); views.push(file);
    }
    await page.setViewportSize({width: 393, height: 852});
}
async function wallet() {return Number((await db.execute('SELECT money FROM users WHERE id=?', [user.id]))[0][0].money);}
(async () => {
    try {
        server.listen(0, '127.0.0.1'); await once(server, 'listening');
        user = await require('../server/persistence/userRepository').createUserWithStarter('Kit_' + randomUUID().slice(0, 8), randomUUID());
        const hero = factory.create(7, 5, true), reserve = factory.create(143, 150, true);
        hero.name = 'Compagnon'; hero.currentHp = 1; reserve.name = 'Réserve';
        for (const [p, move] of [[hero, 'Splash'], [reserve, 'Tackle']]) {p.passiveAbility = null; p.heldItem = null; p.abilities = []; p.movePp = []; p.addAbility(move);}
        await teams.editEquipe(user.id, {pokemons: [hero, reserve]});
        await db.execute("UPDATE users SET map='jungle1',x=208,y=368,money=200000,repel_steps=30000 WHERE id=?", [user.id]);
        for (const [key, value] of [['adventure_opening', 'complete'], ['dark_rules_read', 'true']]) await db.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)', [user.id, key, value]);
        await db.execute("INSERT INTO user_items(user_id,item_key,quantity)VALUES(?,'professional_trainer_card',1)", [user.id]);
        await require('../server/persistence/patchNotesRepository').acknowledge(user.id, require('../data/game/latest_patch.json').version);
        browser = await playwright[engine].launch({headless: true});
        const context = await browser.newContext({viewport: {width: 393, height: 852}, hasTouch: engine === 'webkit', serviceWorkers: 'block'});
        await context.addInitScript(auth => {if (!location.protocol.startsWith('http')) return; localStorage.setItem('explorakit.user', JSON.stringify(auth)); localStorage.setItem('explorakitGamePreferences', JSON.stringify({masterVolume: 0, textSpeed: 10000, animationsEnabled: true}));}, {...user, token: require('../server/config/auth').signAccessToken(user)});
        page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
        page.on('response', r => {if (r.status() >= 400 && /\/(?:img|js|css)\//.test(r.url())) errors.push(r.status() + ' ' + r.url());});
        await page.goto('http://127.0.0.1:' + server.address().port + '/game'); await ready();
        await page.waitForFunction(() => v._placeAmbience?.profile?.kind === 'dark-continent' && v._placeAmbience.darkMist?.cloud);
        for (const map of ['jungle1', 'jungle5', 'jungle9']) {
            if (map !== 'jungle1') {await travel.get(user.id).travel({map, x: 208, y: 368}); await page.waitForFunction(map => v.map === map, map); await ready();}
            await page.waitForFunction(() => v._placeAmbience?.profile?.kind === 'dark-continent'); await capture(map + '-mist');
        }
        const first = await page.evaluate(() => v._placeAmbience.canvas.toDataURL()); await page.waitForTimeout(800);
        assert.notEqual(await page.evaluate(() => v._placeAmbience.canvas.toDataURL()), first); checks.push('mist-visibly-drifts-on-nine-map-profile');
        await page.evaluate(() => v.updatePreferences({...v.preferences, animationsEnabled: false})); await page.waitForTimeout(150);
        const still = await page.evaluate(() => v._placeAmbience.canvas.toDataURL()); await page.waitForTimeout(250);
        assert.equal(await page.evaluate(() => v._placeAmbience.canvas.toDataURL()), still); checks.push('reduced-motion-retains-a-static-violet-haze');
        fogPerformance = await page.evaluate(() => {
            const r = v._placeAmbience, old = r.darkMist.createCanvas; let allocations = 0;
            r.darkMist.createCanvas = () => {allocations++; return old();}; const start = performance.now();
            for (let n = 0; n < 120; n++) r.paint(500 + n / 20, true, 0, 0);
            const msPerFrame = (performance.now() - start) / 120; r.darkMist.createCanvas = old;
            const data = r.canvas.getContext('2d').getImageData(0, 0, 448, 320).data; let alpha = 0;
            for (let i = 3; i < data.length; i += 4) alpha += data[i];
            return {msPerFrame, allocations, meanAlpha: alpha / (448 * 320)};
        });
        assert.equal(fogPerformance.allocations, 0); assert(fogPerformance.msPerFrame < 4); assert(fogPerformance.meanAlpha > 20 && fogPerformance.meanAlpha < 140); checks.push('cached-mist-draw-budget-and-readable-opacity');
        await travel.get(user.id).travel({map: 'jungle1', x: 208, y: 368}); await page.waitForFunction(() => v.map === 'jungle1'); await ready();
        await page.evaluate(() => v.socket.emit('Space')); await page.locator('[data-dark-buy-kit]').waitFor(); await capture('guide-kit', '.dark-continent-panel');
        await page.locator('[data-dark-buy-kit]').click(); await page.waitForFunction(() => !v.darkBusy && v.darkPanel?.lastKitPurchase);
        assert.equal(await wallet(), 150000); assert.equal((await items.loadUserItems(user.id)).find(i => i.key === 'survival_kit').quantity, 1);
        const replay = await page.evaluate(() => new Promise(resolve => v.socket.emit('dark:buyKit', {requestId: v.darkPanel.lastKitPurchase, quantity: 1, price: 50000}, resolve)));
        assert(replay.success && replay.duplicate); assert.equal(await wallet(), 150000); checks.push('real-guide-purchase-and-response-replay-one-payment');
        await page.locator('.dark-continent-panel header button').click(); await page.locator('.menu-toggle-btn').click(); await page.locator('[data-menu-action=bag]').click();
        await page.waitForFunction(() => !v.bagLoading); await page.locator('[data-bag-pocket=held]').click();
        const row = page.locator('[data-item-key=survival_kit]'); await row.locator('.bag-item-select').click();
        await row.locator('[data-bag-held-target]').selectOption(hero.uuid); await row.locator('[data-bag-give-held]').click();
        await page.waitForFunction(() => !v.teamSaving && v.teamPokemons.some(p => p.heldItem === 'survival_kit')); await capture('equipped-kit', '.bag-panel');
        assert.equal((await teams.loadEquipe(user.id)).pokemons.find(p => p.uuid === hero.uuid).heldItem, 'survival_kit'); await page.locator('.bag-panel .panel-close').click(); checks.push('real-bag-equipment-and-new-icon');
        // Only the enemy spawn is staged; attacks, KO, checkpoint and UI are real.
        const enemy = factory.create(445, 150, true); enemy.passiveAbility = null; enemy.abilities = []; enemy.movePp = []; enemy.addAbility('Earthquake'); enemy.currentHp = 1;
        await contexts.get(user.id).h.start(enemy); await page.waitForFunction(() => v.battle && v.$refs.battleOverlay?.canChooseAction, null, {timeout: 25000});
        await page.locator('.action-attack').click(); await page.locator('.battle-move-choice').first().click();
        await page.waitForFunction(() => v.$refs.battleOverlay?.replacementChoice && v.$refs.battleOverlay?.canChooseAction, null, {timeout: 15000});
        let saved = (await teams.loadEquipe(user.id)).pokemons.find(p => p.uuid === hero.uuid); assert(saved); assert.equal(saved.currentHp, 0); assert.equal(saved.heldItem, null);
        await page.reload(); await ready(); await page.waitForFunction(() => v.battle && v.$refs.battleOverlay, null, {timeout: 25000});
        const current = contexts.get(user.id).h.controller; assert(current.run.battle.replacementPhase); saved = (await teams.loadEquipe(user.id)).pokemons.find(p => p.uuid === hero.uuid);
        assert.equal(saved.currentHp, 0); assert.equal(saved.heldItem, null); checks.push('protected-ko-and-reconnect-retain-owner-with-consumed-kit');
        await page.waitForFunction(() => v.$refs.battleOverlay?.replacementChoice && v.$refs.battleOverlay?.canChooseAction, null, {timeout: 15000});
        await page.locator('[data-party-uuid="' + reserve.uuid + '"]').click();
        await page.waitForFunction(() => !v.$refs.battleOverlay?.replacementChoice && v.$refs.battleOverlay?.canChooseAction, null, {timeout: 15000});
        await page.locator('.action-attack').click(); await page.locator('.battle-move-choice').first().click(); await page.locator('[data-battle-result-continue]').waitFor({timeout: 20000});
        await page.locator('[data-battle-result-continue]').click(); await page.waitForFunction(() => !v.battle && !v.battleResult); checks.push('battle-finishes-with-protected-companion-not-lost');
        await page.evaluate(() => v.socket.emit('Space')); await page.locator('[data-dark-heal]').waitFor(); const beforeHeal = await wallet();
        await page.locator('[data-dark-heal]').click(); await page.waitForFunction(() => !v.darkBusy && v.darkNotice.includes('terminés'));
        saved = (await teams.loadEquipe(user.id)).pokemons.find(p => p.uuid === hero.uuid); assert.equal(saved.currentHp, saved.maxHp); assert.equal(saved.heldItem, null); assert.equal(await wallet(), beforeHeal - 10000); checks.push('guide-heals-the-protected-ko-without-recreating-a-kit');
        await page.locator('.dark-continent-panel header button').click();
        await travel.get(user.id).travel({map: 'safari8', x: 432, y: 432}); await page.waitForFunction(() => v.map === 'safari8'); await ready();
        assert(!(await page.evaluate(() => v._placeAmbience?.darkMist?.cloud))); checks.push('leaving-the-island-releases-mist-surfaces');
        assert.deepEqual(errors, []); success = true;
    } catch (e) {await page?.screenshot({path: path.join(out, 'failure.png')}).catch(() => {}); throw e;} finally {
        await browser?.close(); require('../server/realtime/whitepeakClub').getClub(io).close(); await new Promise(resolve => io.close(resolve));
        await require('../server/realtime/accountConnection').waitForAccountConnections(io);
        if (user) await db.execute('DELETE FROM users WHERE id=?', [user.id]); await db.end();
        fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({success, engine, checks, views, errors, fogPerformance, buildIndexSha256: createHash('sha256').update(fs.readFileSync(path.join(dist, 'index.html'))).digest('hex')}, null, 2));
    }
    console.log(JSON.stringify({success, engine, checks, views: views.length, fogPerformance}));
})().catch(e => {console.error(e.stack); process.exitCode = 1;});
