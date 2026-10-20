const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const mysql = require('mysql2/promise');
const {
    findBrowserExecutable, waitForServer, stopChild, waitForDebugPage, CdpClient,
    evaluate, waitForExpression, registerFixture, cleanupFixture, gameVm,
    getDatabaseConfig, projectRoot, testDatabaseName, serverPort, debugPort, baseUrl
} = require('./validatePokedexViewports');

async function run() {
    const executable = findBrowserExecutable();
    assert.ok(executable, 'Chromium/Chrome requis');
    const directory = path.resolve(process.env.STORY_SCREENSHOT_DIR || path.join(os.tmpdir(), 'explorakit-story-validation'));
    fs.mkdirSync(directory, { recursive: true });
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'explorakit-story-browser-'));
    const server = spawn(process.execPath, ['server/index.js'], {
        cwd: projectRoot,
        env: { ...process.env, PORT: String(serverPort), DB_NAME: testDatabaseName, JWT_SECRET: 'story-visual-test' },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let browser, client, userId, connection;
    try {
        await waitForServer(server);
        const fixture = await registerFixture();
        userId = fixture.user.id;
        connection = await mysql.createConnection(getDatabaseConfig());
        await connection.execute('UPDATE users SET map = ?, x = ?, y = ? WHERE id = ?', ['ville_safe1_arene', 13 * 32 + 16, 6 * 32 + 16, userId]);
        await connection.execute("INSERT INTO player_story_flags (user_id, flag_key, flag_value) VALUES (?, 'moonpunch_defeated', 'true')", [userId]);
        browser = spawn(executable, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run',
            `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, `${baseUrl}/connexion`], { stdio: 'ignore' });
        client = new CdpClient((await waitForDebugPage()).webSocketDebuggerUrl);
        await client.connect();
        await client.send('Page.enable');
        await client.send('Runtime.enable');
        await waitForExpression(client, `location.origin === ${JSON.stringify(baseUrl)}`);
        await evaluate(client, `localStorage.setItem('user', ${JSON.stringify(JSON.stringify({ ...fixture.user, token: fixture.token }))})`);
        await client.send('Page.navigate', { url: `${baseUrl}/game` });
        await waitForExpression(client, `Boolean(${gameVm}?.socket?.connected && ${gameVm}?.players[${gameVm}?.socket?.id])`);
        await evaluate(client, `const vm = ${gameVm}; vm.preferences.textSpeed = 10000; vm.socket.emit('Space'); true;`);
        await waitForExpression(client, `Boolean(document.querySelector('.dialogue-layer .imagetoto')?.naturalWidth)`);
        assert.equal(await evaluate(client, `${gameVm}.endSentences`), 'champion_hoze');
        for (const [name, width, height, mobile] of [
            ['desktop', 1440, 900, false], ['mobile', 390, 844, true],
            ['small-mobile', 320, 568, true], ['landscape', 844, 390, true]
        ]) {
            await client.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
            await new Promise((resolve) => setTimeout(resolve, 250));
            const layout = await evaluate(client, `(() => {
                return ['.dialogue-layer .text', '.dialogue-layer .texts'].map(selector => {
                    const el = document.querySelector(selector), rect = el.getBoundingClientRect();
                    return { selector, left:rect.left, right:rect.right, top:rect.top, bottom:rect.bottom,
                        overflow:el.scrollWidth > el.clientWidth + 1 || (selector.endsWith('.text') && el.scrollHeight > el.clientHeight + 1) };
                });
            })()`);
            for (const rect of layout) {
                assert.ok(rect.left >= -1 && rect.right <= width + 1 && rect.top >= -1 && rect.bottom <= height + 1,
                    `${name} : ${rect.selector} hors écran (${JSON.stringify(rect)})`);
                assert.equal(rect.overflow, false, `${name} : contenu tronqué`);
            }
            const shot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
            fs.writeFileSync(path.join(directory, `hoze-${name}.png`), Buffer.from(shot.data, 'base64'));
            console.log(`[story] Dialogue de Hoze ${name} : portrait chargé et texte visible.`);
        }
        // Passer réellement au texte suivant via la commande tactile existante.
        const actionButton = await evaluate(client, `(() => {
            const rect = document.querySelector('.mobile-action-a').getBoundingClientRect();
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        })()`);
        await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [actionButton] });
        await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await waitForExpression(client, `document.querySelector('.dialogue-layer .text')?.textContent.includes('Trois Pokémon')`);
        await evaluate(client, `const vm = ${gameVm}; vm.socket.disconnect(); vm.textImageSequence = [];`);
        await connection.execute('UPDATE users SET map = ?, x = ?, y = ? WHERE id = ?', ['gen_ville5', 12 * 32 + 16, 12 * 32 + 16, userId]);
        await client.send('Page.navigate', { url: `${baseUrl}/game` });
        await waitForExpression(client, `${gameVm}?.map === 'gen_ville5' && ${gameVm}?.pnjs?.length === 3`);
        await client.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
        await new Promise((resolve) => setTimeout(resolve, 400));
        const shot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        fs.writeFileSync(path.join(directory, 'ocreville-mobile.png'), Buffer.from(shot.data, 'base64'));
        console.log(`[story] Commande tactile et trois PNJ d’Ocreville chargés. Captures : ${directory}`);
    } finally {
        client?.close();
        await stopChild(browser);
        await stopChild(server);
        if (connection) await connection.end();
        await cleanupFixture(userId);
        fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
