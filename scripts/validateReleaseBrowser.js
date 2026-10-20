const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { validateJournalUi, viewports } = require('./validateJournalUi');
const { validateBattleResultUi, assertResultMode } = require('./validateBattleResultUi');
const { validateMobileWorld } = require('./validateMobileWorld');
const mysql = require('mysql2/promise');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const httpProxy = require('../vue-explorakit/node_modules/http-proxy');
const { io } = require('../vue-explorakit/node_modules/socket.io-client');
const database = process.env.DB_TEST_NAME;
if (!/test/i.test(database || '')) throw Error('Base de test dédiée requise.');
const root = path.resolve(__dirname, '..');
const port = Number(process.env.RELEASE_BROWSER_PORT || 31491);
const origin = `http://127.0.0.1:${port + 1}`,
    base = origin + '/explorakit';
const output = process.env.RELEASE_SCREENSHOTS || '/tmp/explorakit-six-browser';
fs.mkdirSync(output, { recursive: true });
const fixtures = [],
    sockets = [],
    errors = [];
let child, proxy, proxyServer, browser, db, runId, journalRunId;
let successful = false;
async function request(route, token, body) {
    const response = await fetch(base + '/api' + route, {
        method: body ? 'POST' : 'GET',
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: 'Bearer ' + token } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert(response.ok, `HTTP ${response.status}: ${route}`);
    return response.json();
}
const command = (socket, name, payload = {}) =>
    new Promise((resolve, reject) =>
        socket
            .timeout(8000)
            .emit(name, payload, (error, result) =>
                error
                    ? reject(error)
                    : result?.ok === false || result?.success === false
                    ? reject(Error(result.message))
                    : resolve(result)
            )
    );
async function connect(fixture) {
    const socket = io(origin + '/drift', {
        path: '/explorakit/socket.io',
        auth: { token: fixture.token },
        transports: ['websocket'],
        autoConnect: false,
    });
    sockets.push(socket);
    await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(Error('Socket timeout')), 10000);
        socket.once('drift:bootstrap', () => {
            clearTimeout(timeout);
            resolve();
        });
        socket.once('connect_error', reject);
        socket.connect();
    });
    return socket;
}
async function loginContext(fixture, viewport, options = {}) {
    const context = await browser.newContext({ viewport, ...options });
    await context.addInitScript(
        (session) => localStorage.setItem('explorakit.user', JSON.stringify(session)),
        { ...fixture.user, token: fixture.token }
    );
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (response) => {
        if (response.url().startsWith(base) && response.status() >= 400)
            errors.push(`${response.status()} ${response.url()}`);
    });
    return { context, page };
}
async function fit(page, selector, width, height) {
    const bounds = await page.locator(selector).boundingBox();
    assert(
        bounds && bounds.width > 0 && bounds.x >= -1 && bounds.x + bounds.width <= width + 1,
        selector + ' déborde'
    );
    assert(bounds.y >= -1 && bounds.y + bounds.height <= height + 1, selector + ' déborde verticalement');
    assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        'Page trop large'
    );
}
(async () => {
    try {
        db = await mysql.createConnection({
            host: process.env.DB_HOST,
            port: Number(process.env.DB_PORT || 3306),
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database,
        });
        child = spawn(process.execPath, ['server/index.js'], {
            cwd: root,
            env: {
                ...process.env,
                DB_NAME: database,
                NODE_ENV: 'test',
                RIFT_DURABILITY: '0',
                PORT: String(port),
                CLIENT_DIST_DIR: process.env.RELEASE_DIST_DIR || '/tmp/explorakit-six-dist',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(Error('Startup timeout')), 12000);
            child.stdout.on('data', (data) => {
                if (String(data).includes('Server is running')) {
                    clearTimeout(timeout);
                    resolve();
                }
            });
            child.stderr.on('data', (data) => process.stderr.write(data));
            child.once('exit', (code) => {
                clearTimeout(timeout);
                reject(Error('Server exited ' + code));
            });
        });
        proxy = httpProxy.createProxyServer({ target: `http://127.0.0.1:${port}`, ws: true });
        proxy.on('error', (_error, _request, response) => {
            if (response?.writeHead) response.writeHead(502).end();
        });
        const rewrite = (request) => {
            request.url = request.url.replace(/^\/explorakit(?=\/|$)/, '') || '/';
        };
        proxyServer = http.createServer((request, response) => {
            rewrite(request);
            proxy.web(request, response);
        });
        proxyServer.on('upgrade', (request, socket, head) => {
            rewrite(request);
            proxy.ws(request, socket, head);
        });
        proxyServer.listen(port + 1, '127.0.0.1');
        await once(proxyServer, 'listening');
        for (let index = 0; index < 2; index++)
            fixtures.push(
                await request('/users', null, {
                    username: 'browser_' + randomUUID(),
                    password: 'Browser-test-password',
                    starterId: 7,
                })
            );
        const [host, guest] = fixtures;
        await db.execute('INSERT INTO rift_profiles (user_id,coins) VALUES (?,1000)', [host.user.id]);
        await db.execute("INSERT INTO user_items(user_id,item_key,quantity) VALUES (?,'potion',2)", [
            host.user.id,
        ]);
        await db.execute(
            'UPDATE pokemons p JOIN teams t ON t.id=p.team_id SET p.current_hp=1 WHERE t.user_id=?',
            [host.user.id]
        );
        // Create a real report; a clean browser context must retrieve it without localStorage archives.
        const a = await connect(host),
            b = await connect(guest);
        const room = await command(a, 'drift:create', {
            capacity: 2,
            durationMinutes: 20,
            visibility: 'private',
        });
        await command(b, 'drift:join', { code: room.lobby.code });
        await command(a, 'drift:ready', { ready: true });
        await command(b, 'drift:ready', { ready: true });
        await command(a, 'drift:start');
        runId = (await command(a, 'drift:enter')).state.id;
        await command(b, 'drift:enter');
        for(const socket of [a,b]){const state=(await command(socket,'drift:enter')).state;await command(socket,'drift:chooseStarter',{pokemonUuid:state.starterChoices[0].uuid});}
        await command(b, 'drift:abandon');
        await command(a, 'drift:exit');
        await command(b, 'drift:exit');
        sockets.forEach((socket) => socket.disconnect());
        browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
        const { page } = await loginContext(host, { width: 1365, height: 900 });
        await page.goto(base + '/drift', { waitUntil: 'networkidle' });
        await page.locator('[data-rift-hub]').waitFor();
        // Browse/create remain a single clear action on both desktop and mobile.
        for (const [width,height] of [[1365,900],[390,844],[320,568],[844,390]]) {
            await page.setViewportSize({width,height});
            await page.locator('[data-rift-browse-tab]').click();
            await page.locator('[data-rift-browser]').waitFor();
            assert.equal(await page.locator('[data-rift-create]').isVisible(),false);
            await page.screenshot({path:path.join(output,`rift-browse-${width}.png`),fullPage:true});
            await page.locator('[data-rift-create-tab]').click();
            await page.locator('[data-rift-create]:enabled').waitFor();
            assert.equal(await page.locator('[data-rift-browser]').isVisible(),false);
            assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
            await page.screenshot({path:path.join(output,`rift-create-${width}.png`),fullPage:true});
        }
        await page.locator('[data-rift-capacity]').selectOption('16');
        await page.locator('[data-rift-create]').click();await page.locator('.invite').waitFor();
        await page.setViewportSize({width:390,height:844});
        assert.equal(await page.locator('.trainer-seat').count(),16);
        await page.screenshot({path:path.join(output,'rift-lobby-mobile.png'),fullPage:true});
        await page.getByRole('button',{name:'Quitter',exact:true}).click();
        await page.locator('[data-rift-create-tab]').waitFor();
        await page.setViewportSize({width:1365,height:900});
        await page.locator('.collection > summary').click();
        const title = page.locator('.collection article').filter({ hasText: 'Éclaireur des Rifts' });
        await title.getByRole('button', { name: /Acheter/ }).click();
        await title.getByRole('button', { name: 'Équiper', exact: true }).click();
        const frame = page.locator('.collection article').filter({ hasText: 'Cadre Forêt' });
        await frame.getByRole('button', { name: /Acheter/ }).click();
        await frame.getByRole('button', { name: 'Équiper', exact: true }).click();
        await page.locator('.profile-details > summary').click();
        await page.waitForFunction(
            () => document.querySelector('[data-rift-coins]')?.textContent.trim() === '800'
        );
        assert.match(await page.locator('.profile-title').innerText(), /Éclaireur/);
        assert.equal(
            await page.locator('[data-rift-profile]').evaluate((node) => getComputedStyle(node).borderColor),
            'rgb(139, 199, 161)'
        );
        for (const [width, height] of [
            [1365, 900],
            [390, 844],
            [320, 568],
            [844, 390],
        ]) {
            await page.setViewportSize({ width, height });
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
            await page.screenshot({ path: path.join(output, `collection-${width}.png`), fullPage: true });
        }
        const fresh = await loginContext(host, { width: 390, height: 844 });
        await fresh.page.goto(base + '/drift', { waitUntil: 'networkidle' });
        await fresh.page.locator('.profile-details > summary').click();
        assert.match(await fresh.page.locator('.profile-title').innerText(), /Éclaireur/);
        await fresh.page.locator('[data-drift-history-toggle]').click();
        await fresh.page.locator(`[data-drift-history-run="${runId}"]`).click();
        await fresh.page.locator('[data-drift-report]').waitFor();
        assert.match(await fresh.page.locator('[data-report-rating]').innerText(), /1000 → 1024/);
        assert.match(await fresh.page.locator('[data-rift-rank-summary]').innerText(), /Bronze/);
        await fresh.page.screenshot({ path: path.join(output, 'history-fresh-browser.png'), fullPage: true });
        assert.equal(
            await fresh.page.evaluate(() =>
                Object.keys(localStorage).some((key) => key.startsWith('explorakit:drift-reports:'))
            ),
            false
        );
        await fresh.context.close();
        await page.locator('[data-rift-solo]').click();
        await page.locator('.world-viewport canvas').waitFor();
        assert.equal(await page.locator('.adventure-guide').count(), 0);
        await page.locator('.menu-toggle-btn').click();
        await page.locator('[data-menu-action="progress"]').click();
        await page.locator('.adventure-guide').waitFor();
        assert.match(await page.locator('.destination').innerText(), /Ville du Lac/);
        await page.locator('.help > summary').click();
        for (const [width, height] of [
            [1365, 900],
            [390, 844],
            [320, 568],
            [844, 390],
        ]) {
            await page.setViewportSize({ width, height });
            await fit(page, '.info-panel', width, height);
            await page.screenshot({ path: path.join(output, `guide-${width}.png`) });
        }
        await page.locator('.info-panel .close-button').click();
        assert.equal(await page.locator('.adventure-guide').count(), 0);
        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator('.menu-toggle-btn').click();
        await page
            .locator('.menu-dropdown-item')
            .filter({ hasText: /^\s*Sac\s*$/ })
            .click();
        const medicine = page.locator('[data-item-key="potion"] select');
        await medicine.waitFor();
        const uuid = await medicine.locator('option').nth(1).getAttribute('value');
        await medicine.selectOption(uuid);
        await page.locator('[data-item-key="potion"] .bag-use-button').click();
        await page.waitForFunction(
            () => document.querySelector('[data-item-key="potion"] .bag-item-qty')?.textContent === 'x1'
        );
        const [[healed]] = await db.execute('SELECT current_hp FROM pokemons WHERE uuid=?', [uuid]);
        assert(healed.current_hp > 1, 'Le soin doit être sauvegardé');
        await page.screenshot({ path: path.join(output, 'medicine-mobile.png') });
        const journal = await validateJournalUi(page, output, fit);
        const battleResults = await validateBattleResultUi(page, output, fit);
        await page.goto(base + '/drift', { waitUntil: 'networkidle' });
        const mobile = await validateMobileWorld({ loginContext, fixture: host, base, output, fit });
        const learner = await request('/users', null, { username:'learn_'+randomUUID(),password:'Learning-browser-2026',starterId:1 });
        fixtures.push(learner);
        const specimen = require('../server/game/drift/pokemonFactory').create(1,5);
        specimen.gainExperience(specimen.getNextLevelExpForLevel(14)-specimen.experience);
        await db.execute('UPDATE pokemons p JOIN teams t ON t.id=p.team_id SET p.level=?,p.experience=?,p.pending_moves=?,p.ability1=?,p.ability2=?,p.ability3=?,p.ability4=? WHERE t.user_id=?',
            [specimen.level,specimen.experience,JSON.stringify(specimen.pendingMoves),...specimen.abilities,learner.user.id]);
        const learningContext = await loginContext(learner,{width:393,height:852},{isMobile:true,hasTouch:true});
        const learning = await require('./validateExperienceUi').validateLearningUi({page:learningContext.page,base,output,fit,db,userId:learner.user.id});
        await learningContext.context.close();
        // The shared world toolbar must also fit an actual two-player Rift.
        const journalHost = await connect(host), journalGuest = await connect(guest);
        const journalRoom = await command(journalHost, 'drift:create', { capacity: 2, durationMinutes: 20, visibility: 'private' });
        await command(journalGuest, 'drift:join', { code: journalRoom.lobby.code });
        await command(journalHost, 'drift:ready', { ready: true });
        await command(journalGuest, 'drift:ready', { ready: true });
        await command(journalHost, 'drift:start');
        journalRunId = (await command(journalHost, 'drift:enter')).state.id;
        await command(journalGuest, 'drift:enter');
        for(const socket of [journalHost,journalGuest]){const state=(await command(socket,'drift:enter')).state;await command(socket,'drift:chooseStarter',{pokemonUuid:state.starterChoices[0].uuid});}
        journalHost.disconnect();
        await page.goto(base + '/drift/game', { waitUntil: 'networkidle' });
        await page.locator('.game-root.is-drift .drift-hud').waitFor();
        await assertResultMode(page, 'Rift', true);
        for (const [width, height] of [...viewports, [740, 320]]) {
            await page.setViewportSize({ width, height });
            await fit(page, '.world-toolbar', width, height);
            await fit(page, '.location-banner', width, height);
            await fit(page, '.drift-hud-toggle', width, height);
            await page.locator('.menu-toggle-btn').click();
            await fit(page, '.menu-dropdown', width, height);
            assert.equal(await page.locator('[data-menu-action="pokedex"]').count(), 0);
            await page.screenshot({ path: path.join(output, `journal-rift-${width}.png`) });
            await page.keyboard.press('Escape');
            if (width <= 920) {
                await fit(page, '.mobile-dpad', width, height);
                await fit(page, '.mobile-action-a', width, height);
            }
        }
        await command(journalGuest, 'drift:abandon');
        assert.deepEqual(errors, []);
        console.log(
            JSON.stringify({
                subdirectory: true,
                viewports: 4,
                purchaseAndEquip: true,
                balance: 800,
                freshBrowserHistory: true,
                persistedCosmetics: true,
                objectiveAndHelp: true,
                medicine: true,
                journal,
                battleResults,
                mobile,
                learning,
                riftToolbar: true,
                errors,
                output,
            })
        );
        successful = true;
    } finally {
        if (!successful && browser) {
            console.error('Browser errors:', JSON.stringify(errors));
            for (const context of browser.contexts())
                for (const [index, page] of context.pages().entries()) {
                    console.error('Failed page:', page.url());
                    await page
                        .screenshot({ path: path.join(output, `failure-${index}.png`), fullPage: true })
                        .catch(() => {});
                }
        }
        sockets.forEach((socket) => socket.disconnect());
        await browser?.close();
        proxy?.close();
        proxyServer?.close();
        if (child && child.exitCode === null) {
            const stopped = once(child, 'exit');
            child.kill('SIGTERM');
            await stopped;
        }
        if (db) {
            if (runId) await db.execute('DELETE FROM rift_runs WHERE id=?', [runId]);
            if (journalRunId) await db.execute('DELETE FROM rift_runs WHERE id=?', [journalRunId]);
            for (const fixture of fixtures)
                await db.execute('DELETE FROM users WHERE id=?', [fixture.user.id]);
            await db.end();
        }
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
