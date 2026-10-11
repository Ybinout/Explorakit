const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const mysql = require('mysql2/promise');
const { io } = require('../vue-explorakit/node_modules/socket.io-client');
const {
    findBrowserExecutable, waitForServer, stopChild, waitForDebugPage, CdpClient,
    evaluate, waitForExpression, registerFixture, cleanupFixture,
    getDatabaseConfig, projectRoot, testDatabaseName, serverPort, debugPort, baseUrl
} = require('./validatePokedexViewports');

const vm = `document.querySelector('.drift-page').__vue__`;
const viewports = [['desktop', 1440, 900, false], ['mobile', 390, 844, true], ['small-mobile', 320, 568, true], ['landscape', 844, 390, true]];

async function run() {
    const directory = path.resolve(process.env.DRIFT_SCREENSHOT_DIR || path.join(os.tmpdir(), 'explorakit-drift-validation'));
    fs.mkdirSync(directory, { recursive: true });
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'explorakit-drift-browser-'));
    const server = spawn(process.execPath, ['server/index.js'], {
        cwd: projectRoot, env: { ...process.env, PORT: String(serverPort), DB_NAME: testDatabaseName, JWT_SECRET: 'drift-visual-test' },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let browser, client, peer, db;
    const users = [];
    async function adventureSnapshot(id) {
        const [users] = await db.execute('SELECT * FROM users WHERE id = ?', [id]);
        const [teams] = await db.execute('SELECT * FROM teams WHERE user_id = ?', [id]);
        const [pokemons] = await db.execute('SELECT p.* FROM pokemons p JOIN teams t ON t.id = p.team_id WHERE t.user_id = ? ORDER BY p.id', [id]);
        const [items] = await db.execute('SELECT * FROM user_items WHERE user_id = ? ORDER BY item_key', [id]);
        return JSON.stringify({ users, teams, pokemons, items });
    }
    async function layout(name, width, height, mobile, prefix) {
        await client.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
        await evaluate(client, 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
        assert.equal(await evaluate(client, 'document.documentElement.scrollWidth > innerWidth + 1'), false, `${prefix} ${name} : débordement horizontal`);
        if (prefix !== 'modes') {
            const controls = await evaluate(client, `Array.from(document.querySelectorAll('.choice-row button, .room-actions button, .join-form button, .lobby-rules select, .catalogue-controls input, .catalogue-controls select, .creation-rules select, .hub-tabs button, .refresh-rooms')).filter(node => node.getClientRects().length).map(node => ({ text: node.textContent.trim(), height: node.getBoundingClientRect().height }))`);
            for (const control of controls) assert.ok(control.height >= 44, `${prefix} ${name} : commande ${control.text} trop petite`);
        }
        const shot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        fs.writeFileSync(path.join(directory, `${prefix}-${name}.png`), Buffer.from(shot.data, 'base64'));
    }
    try {
        await waitForServer(server);
        const first = await registerFixture(); users.push(first.user.id);
        const second = await registerFixture(); users.push(second.user.id);
        db = await mysql.createConnection(getDatabaseConfig());
        const before = await adventureSnapshot(first.user.id);
        browser = spawn(findBrowserExecutable(), ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run',
            `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, `${baseUrl}/`], { stdio: 'ignore' });
        client = new CdpClient((await waitForDebugPage()).webSocketDebuggerUrl);
        await client.connect();
        await client.send('Page.enable'); await client.send('Runtime.enable');
        await waitForExpression(client, "Boolean(document.querySelector('.home-menu .main-action'))");
        assert.equal(await evaluate(client, "document.querySelector('#home-title').textContent.replace('✦', '')"), 'RiftMon');
        for (const viewport of viewports) await layout(...viewport, 'modes');
        await evaluate(client, "document.querySelector('.home-menu .main-action').click(); true;");
        await waitForExpression(client, "location.pathname === '/connexion'");
        await evaluate(client, `const login = document.querySelector('.login-page').__vue__; login.credentials = { username: ${JSON.stringify(first.user.username)}, password: 'mot-de-passe-visuel' }; document.querySelector('form').requestSubmit(); true;`);
        await waitForExpression(client, `Boolean(document.querySelector('.drift-page') && ${vm}.bootstrapped)`);
        assert.equal(await evaluate(client, "location.pathname"), '/', 'la connexion revient au camp RiftMon');
        assert.equal(await evaluate(client, `${vm}.definitions.length`), 59);
        await waitForExpression(client, "document.querySelectorAll('.companion-art img').length === 3 && Array.from(document.querySelectorAll('.companion-art img')).every(image => image.complete && image.naturalWidth > 0)");
        for (const viewport of viewports) await layout(...viewport, 'camp');
        await evaluate(client, "document.querySelector('[data-rift-create-tab]').click(); true;");
        await waitForExpression(client, "document.querySelector('[data-rift-capacity]').getClientRects().length > 0");
        assert.deepEqual(await evaluate(client, "Array.from(document.querySelector('[data-rift-capacity]').options).map(option => Number(option.value))"), Array.from({ length: 15 }, (_, index) => index + 2));
        assert.equal(await evaluate(client, "Boolean(document.querySelector('[data-rift-duration=\"120\"]'))"), true, 'deux heures sont proposées');
        for (const viewport of viewports) await layout(...viewport, 'create');
        await evaluate(client, "document.querySelector('[data-rift-create]').click(); true;");
        await waitForExpression(client, `${vm}.lobby?.players.length === 1 && !${vm}.busy`);
        const code = await evaluate(client, `${vm}.lobby.code`);
        peer = io(`${baseUrl}/drift`, { autoConnect: false, auth: { token: second.token }, transports: ['websocket'] });
        const peerReady = new Promise((resolve, reject) => { peer.once('drift:bootstrap', resolve); peer.once('connect_error', reject); });
        peer.connect(); await peerReady;
        const joined = await new Promise((resolve, reject) => peer.timeout(5000).emit('drift:join', { code }, (error, result) => error ? reject(error) : resolve(result)));
        assert.equal(joined.ok, true);
        await waitForExpression(client, `${vm}.lobby.players.length === 2`);
        await evaluate(client, "const select = document.querySelector('.lobby-rules select'); select.value = '16'; select.dispatchEvent(new Event('change')); true;");
        await waitForExpression(client, `${vm}.lobby.capacity === 16 && !${vm}.busy`);
        assert.equal(await evaluate(client, "document.querySelectorAll('.trainer-seat').length"), 16, 'les seize places du salon sont représentées');
        assert.equal(await evaluate(client, "document.querySelectorAll('.trainer-seat.empty-player').length"), 14, 'deux dresseurs présents, quatorze places libres');
        await evaluate(client, "document.querySelector('.room-actions .gold-button').click(); true;");
        await waitForExpression(client, `${vm}.isReady && !${vm}.busy`);
        for (const viewport of viewports) {
            await evaluate(client, 'window.scrollTo(0, 0); true;');
            await layout(...viewport, 'lobby');
        }
        assert.equal(await evaluate(client, "document.querySelector('.launch-note button').disabled"), true);
        await evaluate(client, "document.querySelector('.catalogue details').open = true; const select = document.querySelector('.catalogue-controls select'); select.value = 'mythic'; select.dispatchEvent(new Event('change')); true;");
        await waitForExpression(client, "document.querySelectorAll('.drift-entry.mythic').length === 59");
        assert.ok((await evaluate(client, "Array.from(document.querySelectorAll('.drift-entry')).find(el => el.textContent.includes('Phénix éternel')).textContent")).includes('15 %'));
        for (const viewport of viewports) {
            await evaluate(client, "document.querySelector('.catalogue').scrollIntoView(); true;");
            await layout(...viewport, 'catalogue');
        }
        await evaluate(client, `const search = document.querySelector('.catalogue-controls input[type="search"]'); search.value = 'regeneration'; search.dispatchEvent(new Event('input')); true;`);
        await waitForExpression(client, "document.querySelectorAll('.drift-entry').length === 1");
        assert.equal(await evaluate(client, "document.querySelector('.drift-entry h3').textContent"), 'Régénération');
        assert.equal(await adventureSnapshot(first.user.id), before, 'l’équipe, les objets, la position et le compte Aventure restent identiques');
        await evaluate(client, "document.querySelector('.room-actions .subtle-button').click(); true;");
        await waitForExpression(client, `${vm}.lobby === null && !${vm}.busy`);
        console.log(`RiftMon : accueil/connexion/camp, création 2–16 joueurs et durée 2 h, salon réel, invitation, 16 places, prêt, catalogue/recherche et 4 formats validés. Sauvegarde Aventure inchangée. Captures : ${directory}`);
    } finally {
        peer?.disconnect(); client?.close();
        await stopChild(browser); await stopChild(server);
        if (db) await db.end();
        for (const id of users) await cleanupFixture(id);
        fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
}

if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
