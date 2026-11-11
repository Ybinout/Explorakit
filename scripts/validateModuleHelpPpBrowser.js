// Genuine compiled Vue components and authenticated HTTP/Socket/SQL purchases.
// All accounts and writes are confined to the dedicated disposable test database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { randomUUID, createHash } = require('node:crypto');

assert.equal(process.env.DB_TEST_NAME, 'explorakit_test', 'Dedicated test database required');
process.env.DB_NAME = 'explorakit_test';
process.env.NODE_ENV = 'test';
process.env.BATTLE_DELAY_SCALE = '0';
const engine = process.env.PRESENTATION_BROWSER || 'chromium';
assert(['chromium', 'webkit'].includes(engine));
const dist = process.env.RELEASE_DIST_DIR || '/tmp/riftmon-module-help-pp-dist';
const output = process.env.RELEASE_SCREENSHOTS || `/tmp/riftmon-module-help-pp-${engine}`;
const indexSha256 = createHash('sha256').update(fs.readFileSync(path.join(dist, 'index.html'))).digest('hex');
fs.mkdirSync(output, { recursive: true });
fs.rmSync(path.join(output, 'report.json'), { force: true });

const { dbPool: db } = require('../server/config/database');
const teams = require('../server/persistence/teamRepository');
const inventory = require('../server/persistence/itemRepository');
const factory = require('../server/game/drift/pokemonFactory');
const modules = require('../server/game/corruption/modules');
const express = require('express');
const app = express();
const server = http.createServer(app);
const io = new (require('socket.io').Server)(server);
app.use(express.json());
app.use('/api', require('../server/http/routes'));
app.use(express.static(dist));
app.get('*', (_req, response) => response.sendFile(path.join(dist, 'index.html')));
io.use(require('../server/http/authMiddleware').authenticateSocket);
require('../server/realtime/socketHandler')(io);

let browser, page, user, hero, full, base;
let success = false, failure = null, deleted = false;
const errors = [], checks = [], views = [], guideTexts = {};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function checked(message) { checks.push(message); console.log(JSON.stringify({ check: message })); }
async function ready() {
    await page.waitForFunction(() => {
        const v = document.querySelector('.game-root')?.__vue__;
        if (!v?.socket?.connected || !v.players[v.socket.id] || v.mapLoading || v.renderedMap !== v.map
            || v.teamLoading || !v.teamPokemons?.length) return false;
        window.v = v;
        return true;
    });
}
async function rpc(event, payload) {
    return page.evaluate(({ event, payload }) => new Promise((resolve, reject) => {
        const ack = (error, result) => error ? reject(error) : resolve(result);
        if (payload === undefined) v.socket.timeout(10000).emit(event, ack);
        else v.socket.timeout(10000).emit(event, payload, ack);
    }), { event, payload });
}
async function view(name, selector) {
    await page.waitForTimeout(100);
    const box = await page.locator(selector).boundingBox();
    const viewport = page.viewportSize();
    assert(box && box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1
        && box.y + box.height <= viewport.height + 1, `${name}: clipped dialog ${JSON.stringify(box)}`);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}: page overflow`);
    assert(await page.locator(selector).evaluate(node => node.scrollWidth <= node.clientWidth + 1), `${name}: dialog overflow`);
    await page.screenshot({ path: path.join(output, `${name}.png`) });
    views.push({ name, ...viewport });
}
async function mountWorkbench(family, type) {
    const items = modules.recipe(family, type).map(item => ({ ...item, quantity: 9999 }));
    await page.evaluate(({ family, items }) => {
        if (window.fixtureVm) {
            const old = fixtureVm.$el;
            fixtureVm.$destroy();
            old.remove();
        }
        window.fixtureEvents = [];
        const Vue = v.$options._base, Component = v.$options.components.CorruptionWorkbench;
        const element = document.createElement('div');
        v.$el.append(element);
        window.fixtureVm = new Vue({
            render: h => h(Component, {
                props: {
                    panel: { station: family, unlocked: true }, items,
                    command: (...args) => { fixtureEvents.push(['command', ...args]); return Promise.resolve({ success: false }); }
                },
                on: { close: () => fixtureEvents.push('close'), bag: () => fixtureEvents.push('bag') }
            })
        }).$mount(element);
    }, { family, items });
    await page.locator('.mutation-workbench').waitFor();
    await page.locator('[data-corruption-type]').selectOption(type);
    for (const item of modules.recipe(family, type)) await page.locator(`[data-corruption-resource="${item.key}"]`).click();
    assert(await page.locator('[data-corruption-craft]').isEnabled());
}
async function closeFixture() {
    await page.evaluate(() => {
        if (!window.fixtureVm) return;
        const node = fixtureVm.$el;
        fixtureVm.$destroy();
        node.remove();
        window.fixtureVm = null;
    });
}
async function helpChecks() {
    const beforeTeam = JSON.stringify(await teams.loadEquipe(user.user.id));
    const beforeItems = JSON.stringify(await inventory.loadUserItems(user.user.id));
    const formats = [[320, 568, 'light'], [393, 852, 'dark'], [1365, 900, 'light'], [1365, 900, 'dark']];
    for (const family of ['move', 'ability', 'type', 'combat']) {
        guideTexts[family] = [];
        for (const [width, height, theme] of formats) {
            await page.setViewportSize({ width, height });
            await page.evaluate(theme => v.updatePreferences({ ...v.preferences, themeMode: theme }), theme);
            await mountWorkbench(family, 'Fire');
            const trigger = page.locator(`[data-corruption-help="${family}"]`);
            await trigger.focus();
            await trigger.click();
            const guide = page.locator(`[data-corruption-guide="${family}"]`);
            await guide.waitFor();
            await page.locator('.coach-card').waitFor({ state: 'visible' });
            await view(`help-${family}-${width}-${theme}-first`, '.coach-card');
            const focusBefore = await page.evaluate(() => document.activeElement?.outerHTML?.slice(0, 500));
            await page.keyboard.press('Tab');
            const trapped = await page.locator('.coach-card').evaluate(node => node.contains(document.activeElement));
            const focusAfter = await page.evaluate(() => document.activeElement?.outerHTML?.slice(0, 500));
            if (!trapped) console.error(JSON.stringify({ focusDiagnostic: await page.evaluate(() => {
                const button = document.querySelector('.coach-dismiss'), card = document.querySelector('.coach-card');
                button?.focus();
                return { visible: getComputedStyle(card).visibility, manualFocusWorks: document.activeElement === button };
            }) }));
            assert(trapped, `Help traps Tab: before=${focusBefore}; after=${focusAfter}`);
            await page.keyboard.press('Escape');
            await guide.waitFor({ state: 'hidden' });
            assert(await trigger.evaluate(node => node === document.activeElement), 'Escape restores help-button focus');
            assert(await page.locator('.mutation-workbench').isVisible());
            assert.equal(await page.locator('.mutation-slots .is-filled').count(), 4);
            await trigger.click();
            await guide.waitFor();
            const texts = [];
            for (let step = 0; step < 16; step++) {
                await page.locator('.coach-card').waitFor({ state: 'visible' });
                const text = await page.locator('.coach-card').innerText();
                texts.push(text);
                const box = await page.locator('.coach-card').boundingBox();
                assert(box && box.x >= -1 && box.y >= -1 && box.x + box.width <= width + 1
                    && box.y + box.height <= height + 1, `${family}: clipped help step ${step}`);
                const next = page.locator('.coach-card footer button').last();
                const last = /Terminer/.test(await next.innerText());
                if (last) await view(`help-${family}-${width}-${theme}-last`, '.coach-card');
                await next.click();
                if (last) break;
                assert(step < 15, 'Guide must finish');
                await pause(40);
            }
            await guide.waitFor({ state: 'hidden' });
            assert(texts.length >= 4, 'Family guide must explain more than its first step');
            if (!guideTexts[family].length) guideTexts[family] = texts;
            assert.equal(await page.locator('.mutation-slots .is-filled').count(), 4);
            assert(await page.locator('[data-corruption-craft]').isEnabled());
            assert.deepEqual(await page.evaluate(() => fixtureEvents), [], 'Reading help never submits a command or closes the station');
            await closeFixture();
        }
        checked(`Read all ${family} guide steps in four desktop/mobile theme combinations; Escape/focus/recipe preserved`);
    }
    assert.equal(JSON.stringify(await teams.loadEquipe(user.user.id)), beforeTeam);
    assert.equal(JSON.stringify(await inventory.loadUserItems(user.user.id)), beforeItems);
    checked('Component-only help fixtures leave persisted team and inventory unchanged');
}
async function purchaseAndUse() {
    await page.setViewportSize({ width: 393, height: 852 });
    await page.evaluate(() => v.updatePreferences({ ...v.preferences, themeMode: 'light' }));
    await page.locator('.location-shop-btn:not([data-open-sell])').click();
    await page.waitForFunction(() => v.shop.visible && !v.shop.loading);
    const offer = await page.evaluate(() => v.shop.catalog.find(item => item.key === 'ether'));
    assert(offer, 'PP Oil is offered at the real shop');
    await page.getByRole('searchbox').fill(offer.name);
    const row = page.locator('[data-shop-item="ether"]');
    await row.waitFor();
    assert.equal(offer.price, 1200);
    assert(!offer.locked, 'New player can buy PP Oil');
    await row.locator('select').selectOption('5');
    await view('pp-oil-shop-mobile', '.shop-card');
    await page.setViewportSize({ width: 1365, height: 900 });
    await view('pp-oil-shop-desktop', '.shop-card');
    await row.locator('.shop-buy-controls button').click();
    await page.waitForFunction(() => !v.shop.loading && v.bagItems.find(item => item.key === 'ether')?.quantity === 5);
    assert.equal(await page.evaluate(() => v.shop.money), 14000);
    const [[money]] = await db.execute('SELECT money FROM users WHERE id=?', [user.user.id]);
    assert.equal(Number(money.money), 14000);
    assert.equal((await inventory.loadUserItems(user.user.id)).find(item => item.key === 'ether').quantity, 5);
    checked('Real novice shop UI purchases five PP Oils for 6000; money and stock persist in SQL');
    await page.keyboard.press('Escape');
    await page.locator('.shop-card').waitFor({ state: 'hidden' });
    await page.evaluate(() => v.handleMenuAction('bag'));
    await page.locator('.bag-panel').waitFor();
    await page.waitForFunction(() => !v.bagLoading && !v.teamLoading);
    await page.locator('[data-bag-pocket="medicine"]').click();
    const oil = page.locator('[data-item-key="ether"]');
    await oil.locator('.bag-item-select').click();
    await oil.locator('[data-medicine-target]').selectOption(hero.uuid);
    const move = oil.locator('[data-medicine-move]');
    await move.waitFor();
    assert(await oil.locator('.bag-use-button').isDisabled(), 'A move must be selected');
    await move.selectOption('1');
    assert(await oil.locator(`[data-medicine-target] option[value="${full.uuid}"]`).isDisabled(), 'Full-PP Pokémon is unavailable in UI');
    await oil.locator('[data-medicine-target]').selectOption('');
    assert.equal(await move.inputValue(), '', 'Clearing the Pokémon clears the old move slot');
    assert(await oil.locator('.bag-use-button').isDisabled(), 'A Pokémon must be selected');
    await oil.locator('[data-medicine-target]').selectOption(hero.uuid);
    assert.equal(await move.inputValue(), '');
    await move.selectOption('1');
    for (const [width, height, theme] of [[320, 568, 'light'], [393, 852, 'dark'], [1365, 900, 'light']]) {
        await page.setViewportSize({ width, height });
        await page.evaluate(theme => v.updatePreferences({ ...v.preferences, themeMode: theme }), theme);
        await move.scrollIntoViewIfNeeded();
        await view(`pp-oil-move-${width}-${theme}`, '.bag-panel');
    }
    assert(await move.locator('option[value="2"]').isDisabled(), 'Full-PP move is unavailable in UI');
    await oil.locator('.bag-use-button').click();
    await page.waitForFunction(() => !v.medicineBusy && v.bagItems.find(item => item.key === 'ether')?.quantity === 4);
    assert.equal(await page.evaluate(() => v.bagError), '');
    let saved = (await teams.loadEquipe(user.user.id)).pokemons;
    assert.deepEqual(saved[0].movePp, [0, 13, 10, 40], 'Oil restores only selected second move even while first is empty');
    const snapshot = JSON.stringify(saved), stock = JSON.stringify(await inventory.loadUserItems(user.user.id));
    for (const payload of [
        { itemKey: 'ether', pokemonUuid: hero.uuid },
        { itemKey: 'ether', pokemonUuid: hero.uuid, moveSlot: 2 },
        { itemKey: 'ether', pokemonUuid: full.uuid, moveSlot: 0 }
    ]) assert.equal((await rpc('useMedicine', payload)).success, false);
    assert.equal(JSON.stringify((await teams.loadEquipe(user.user.id)).pokemons), snapshot);
    assert.equal(JSON.stringify(await inventory.loadUserItems(user.user.id)), stock);
    checked('Real bag UI targets second move; forged missing/full slots refuse without consuming stock or altering PP');
    await page.keyboard.press('Escape');
    await page.reload();
    await ready();
    assert.deepEqual(await page.evaluate(() => v.teamPokemons[0].movePp), [0, 13, 10, 40]);
    assert.equal((await inventory.loadUserItems(user.user.id)).find(item => item.key === 'ether').quantity, 4);
    // Travel only after the authenticated socket has saved and drained its account.
    assert.equal((await rpc('requestGameSave')).success, true);
    await page.evaluate(() => v.socket.disconnect());
    await require('../server/realtime/accountConnection').waitForAccountConnections(io);
    await page.goto('about:blank');
    await db.execute("UPDATE users SET map='ville1_shop',x=432,y=464 WHERE id=?", [user.user.id]);
    await page.goto(base + '/game');
    await ready();
    const ordinary = await rpc('requestShop');
    assert.equal(ordinary.success, true);
    assert.equal(ordinary.catalog.find(item => item.key === 'ether')?.price, 1200);
    checked('PP and stock survive reload; ordinary first-town shop also offers PP Oil at 1200');
}

(async () => {
    try {
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        base = `http://127.0.0.1:${server.address().port}`;
        const response = await fetch(base + '/api/users', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'help_pp_' + randomUUID().slice(0, 12), password: randomUUID(), starterId: 7 })
        });
        assert.equal(response.status, 201);
        user = await response.json();
        hero = factory.create(9, 80, true);
        hero.abilities = ['Tackle', 'Water Gun', 'Protect', 'Growl'];
        hero.movePp = [0, 3, 10, 40];
        full = factory.create(7, 30, true);
        full.abilities = ['Tackle'];
        full.movePp = [35];
        await teams.editEquipe(user.user.id, { pokemons: [hero, full] });
        await db.execute("UPDATE users SET map='tour_rdc',x=432,y=464,money=20000 WHERE id=?", [user.user.id]);
        for (const [key, value] of [
            ['adventure_opening', 'complete'],
            ['early_game_tutorial', JSON.stringify({ version: 1, phase: 'complete', metWayne: true })]
        ]) await db.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)', [user.user.id, key, value]);
        await require('../server/persistence/patchNotesRepository').acknowledge(user.user.id, require('../data/game/latest_patch.json').version);
        browser = await require('playwright')[engine].launch({ headless: true, ...(engine === 'chromium' ? { args: ['--no-sandbox'] } : {}) });
        const context = await browser.newContext({ viewport: { width: 393, height: 852 }, hasTouch: true, serviceWorkers: 'block' });
        await context.addInitScript(user => {
            if (location.protocol === 'http:') localStorage.setItem('explorakit.user', JSON.stringify(user));
        }, { ...user.user, token: user.token });
        page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        page.on('response', response => { if (response.url().startsWith(base) && response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
        await page.goto(base + '/game');
        await ready();
        await page.evaluate(() => v.updatePreferences({ ...v.preferences, masterVolume: 0, animationsEnabled: false }));
        await purchaseAndUse();
        await helpChecks();
        assert.deepEqual(errors, []);
        success = true;
    } catch (error) {
        failure = error.stack;
        console.error(failure);
        if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
        process.exitCode = 1;
    } finally {
        await browser?.close();
        await require('../server/realtime/raidManager').getRaidManager(io).stop();
        require('../server/realtime/whitepeakClub').getClub(io).close();
        await require('../server/realtime/draftManager').getDraftManager(io).stop();
        await new Promise(resolve => io.close(resolve));
        await require('../server/realtime/accountConnection').waitForAccountConnections(io);
        if (user) {
            await db.execute('DELETE FROM users WHERE id=?', [user.user.id]);
            const [[remaining]] = await db.execute('SELECT COUNT(*) n FROM users WHERE id=?', [user.user.id]);
            deleted = Number(remaining.n) === 0;
        }
        await db.end();
        const report = { success, engine, buildIndexSha256: indexSha256, checks, views, guideTexts, errors, failure,
            testAccountDeleted: deleted, productionAccountsTouched: false, helpUsesCompiledComponentFixtures: true,
            purchasesAndMedicineUseNativeHttpSocketSql: true, physicalHardware: false };
        fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
        console.log(JSON.stringify({ success, engine, checks: checks.length, views: views.length, testAccountDeleted: deleted, errors, output }));
    }
})();
