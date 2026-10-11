const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const mysql = require('mysql2/promise');

const projectRoot = path.resolve(__dirname, '..');
const testDatabaseName = process.env.DB_TEST_NAME || `${process.env.DB_NAME || 'pokemon_game'}_test`;
const serverPort = Number(process.env.VISUAL_TEST_SERVER_PORT || 31235);
const debugPort = Number(process.env.VISUAL_TEST_DEBUG_PORT || 31236);
const baseUrl = `http://127.0.0.1:${serverPort}`;
const outputDirectory = path.resolve(process.env.POKEDEX_SCREENSHOT_DIR || path.join(os.tmpdir(), 'explorakit-pokedex-validation'));

if (!/test/i.test(testDatabaseName)) {
    console.error('Le test visuel refuse une base dont le nom ne contient pas « test ».');
    process.exit(1);
}

function getDatabaseConfig() {
    return {
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: testDatabaseName
    };
}

function findBrowserExecutable() {
    const candidates = [
        process.env.BROWSER_PATH,
        '/opt/google/chrome/chrome',
        '/usr/bin/chromium',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
    ].filter(Boolean);
    return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function waitForServer(child) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Démarrage du serveur visuel trop long.')), 10000);
        child.stdout.on('data', (chunk) => {
            if (String(chunk).includes('Server is running')) {
                clearTimeout(timeout);
                resolve();
            }
        });
        child.stderr.on('data', (chunk) => {
            const output = String(chunk).trim();
            if (output) process.stderr.write(`${output}\n`);
        });
        child.once('exit', (code) => {
            clearTimeout(timeout);
            reject(new Error(`Le serveur visuel s'est arrêté (${code}).`));
        });
    });
}

async function stopChild(child) {
    if (!child || child.exitCode !== null) return;
    await new Promise((resolve) => {
        const timeout = setTimeout(resolve, 3000);
        child.once('exit', () => {
            clearTimeout(timeout);
            resolve();
        });
        child.kill('SIGTERM');
    });
}

async function waitForDebugPage() {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
            const pages = await response.json();
            const page = pages.find((entry) => entry.type === 'page'
                && entry.webSocketDebuggerUrl
                && typeof entry.url === 'string'
                && entry.url.startsWith(baseUrl));
            if (page) return page;
        } catch (error) {
            // Le navigateur n'écoute pas encore.
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('Connexion au navigateur headless impossible.');
}

class CdpClient {
    constructor(webSocketUrl) {
        this.socket = new WebSocket(webSocketUrl);
        this.nextId = 1;
        this.pending = new Map();
    }

    async connect() {
        await new Promise((resolve, reject) => {
            this.socket.addEventListener('open', resolve, { once: true });
            this.socket.addEventListener('error', reject, { once: true });
        });
        this.socket.addEventListener('message', (event) => {
            const message = JSON.parse(event.data);
            if (!message.id || !this.pending.has(message.id)) return;
            const { resolve, reject } = this.pending.get(message.id);
            this.pending.delete(message.id);
            if (message.error) reject(new Error(message.error.message));
            else resolve(message.result || {});
        });
        this.socket.addEventListener('close', (event) => {
            for (const { reject } of this.pending.values()) {
                reject(new Error(`Connexion CDP fermée prématurément (${event.code}: ${event.reason || 'sans raison'}).`));
            }
            this.pending.clear();
        });
    }

    send(method, params = {}) {
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`Commande CDP trop longue: ${method}`));
            }, 10000);
            this.pending.set(id, {
                resolve: (value) => {
                    clearTimeout(timeout);
                    resolve(value);
                },
                reject: (error) => {
                    clearTimeout(timeout);
                    reject(error);
                }
            });
            this.socket.send(JSON.stringify({ id, method, params }));
        });
    }

    close() {
        this.socket.close();
    }
}

async function evaluate(client, expression) {
    const result = await client.send('Runtime.evaluate', {
        expression: `(async () => { return eval(${JSON.stringify(expression)}); })()`,
        awaitPromise: true,
        returnByValue: true
    });
    if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Erreur JavaScript dans le navigateur.');
    }
    return result.result?.value;
}

async function waitForExpression(client, expression, timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            if (await evaluate(client, expression)) return;
        } catch (error) {
            if (!/context|navigation|Cannot find context/i.test(error.message)) throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Condition navigateur non satisfaite: ${expression}`);
}

async function registerFixture() {
    const username = `visual_${Date.now()}`;
    const password = 'mot-de-passe-visuel';
    const response = await fetch(`${baseUrl}/api/users`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password, starterId: 1, sprite: 'sprite.png' })
    });
    const payload = await response.json();
    if (!response.ok || !payload?.token || !payload?.user?.id) {
        throw new Error(payload?.message || "La création du compte visuel a échoué.");
    }
    return { user: payload.user, token: payload.token };
}

async function cleanupFixture(userId) {
    if (!userId) return;
    const connection = await mysql.createConnection(getDatabaseConfig());
    try {
        await connection.execute('DELETE FROM users WHERE id = ?', [userId]);
    } finally {
        await connection.end();
    }
}

const gameVm = `(() => {
    let node = document.querySelector('.game-stage');
    while (node && !node.__vue__) node = node.parentElement;
    return node && node.__vue__;
})()`;

async function check(client, expression, message) {
    if (!await evaluate(client, expression)) throw new Error(message);
}

async function capturePokedex(client, viewport) {
    await client.send('Emulation.setDeviceMetricsOverride', {
        width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const layout = await evaluate(client, `(() => {
        const selectors = ['.dex', '.dex-header', '.dex-tools', '.dex-scroll', '.dex-footer', '.dex-close'];
        const rects = selectors.map(selector => {
            const node = document.querySelector(selector);
            const rect = node.getBoundingClientRect();
            return { selector, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
        });
        const scroll = document.querySelector('.dex-scroll');
        return {
            rects,
            overflow: scroll.scrollWidth > scroll.clientWidth + 1,
            columns: getComputedStyle(document.querySelector('.dex-grid')).gridTemplateColumns.split(' ').length,
            font: getComputedStyle(document.querySelector('.dex h3')).fontFamily,
            minimumButtonHeight: Math.min(...[...document.querySelectorAll('.dex button')].map(el => el.getBoundingClientRect().height))
        };
    })()`);
    for (const rect of layout.rects) {
        if (rect.left < -1 || rect.top < -1 || rect.right > viewport.width + 1 || rect.bottom > viewport.height + 1) {
            throw new Error(`${viewport.name}: ${rect.selector} hors écran`);
        }
    }
    if (layout.overflow) throw new Error(`${viewport.name}: débordement horizontal`);
    if (layout.minimumButtonHeight < 44) throw new Error(`${viewport.name}: cible tactile inférieure à 44 px`);
    if (layout.columns !== (viewport.width <= 600 ? 3 : 5)) throw new Error(`${viewport.name}: grille inattendue`);
    if (!layout.font.includes('Arial')) throw new Error('La police globale du jeu écrase le Pokédex');
    await evaluate(client, `document.querySelector('.dex-scroll').scrollTop = 0`);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const shot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(outputDirectory, `pokedex-${viewport.name}.png`), Buffer.from(shot.data, 'base64'));
    await check(client, `(() => {
        const scroll = document.querySelector('.dex-scroll');
        const header = document.querySelector('.dex-header');
        const before = header.getBoundingClientRect().top;
        scroll.scrollTop = scroll.scrollHeight;
        return scroll.scrollTop > 0 && header.getBoundingClientRect().top === before;
    })()`, 'L’en-tête doit rester visible pendant le défilement');
    console.log(`[pokedex] ${viewport.name} : grille, débordements, police, cibles tactiles et défilement OK`);
}

async function run() {
    const executable = findBrowserExecutable();
    if (!executable) throw new Error('Définir BROWSER_PATH vers Chrome ou Chromium.');
    fs.mkdirSync(outputDirectory, { recursive: true });
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'explorakit-pokedex-browser-'));
    const server = spawn(process.execPath, ['server/index.js'], {
        cwd: projectRoot,
        env: { ...process.env, PORT: String(serverPort), DB_NAME: testDatabaseName, JWT_SECRET: 'pokedex-test-secret' },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let browser, client, userId;
    try {
        await waitForServer(server);
        const fixture = await registerFixture();
        userId = fixture.user.id;
        const connection = await mysql.createConnection(getDatabaseConfig());
        try {
            for (let id = 2; id <= 12; id++) {
                await connection.execute(
                    'INSERT INTO user_pokedex (user_id, pokemon_id, seen_count, caught_count) VALUES (?, ?, 1, ?)',
                    [userId, id, id <= 9 ? 1 : 0]
                );
            }
        } finally { await connection.end(); }
        browser = spawn(executable, [
            '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run',
            `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, `${baseUrl}/connexion`
        ], { stdio: 'ignore' });
        client = new CdpClient((await waitForDebugPage()).webSocketDebuggerUrl);
        await client.connect();
        await client.send('Page.enable');
        await client.send('Runtime.enable');
        await waitForExpression(client, `location.origin === ${JSON.stringify(baseUrl)}`);
        await evaluate(client, `localStorage.setItem('user', ${JSON.stringify(JSON.stringify({ ...fixture.user, token: fixture.token }))})`);
        await client.send('Page.navigate', { url: `${baseUrl}/game` });
        await waitForExpression(client, `Boolean(${gameVm}?.socket?.connected)`);
        await evaluate(client, `(async () => { const vm = ${gameVm}; vm.textImageSequence = []; await vm.openServerPanel('pokedex'); })()`);
        await waitForExpression(client, 'document.querySelectorAll(".dex-entry").length === 493');
        await check(client, `(() => {
            const first = document.querySelector('.dex-close');
            const last = document.querySelector('.dex-scroll');
            first.focus();
            first.dispatchEvent(new KeyboardEvent('keydown', {key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));
            if (document.activeElement !== last) return false;
            last.dispatchEvent(new KeyboardEvent('keydown', {key:'Tab',bubbles:true,cancelable:true}));
            return document.activeElement === first;
        })()`, 'La navigation Tab doit rester dans le Pokédex');
        for (const viewport of [
            { name: 'desktop', width: 1440, height: 900, mobile: false },
            { name: 'mobile', width: 390, height: 844, mobile: true },
            { name: 'small-mobile', width: 320, height: 568, mobile: true },
            { name: 'landscape', width: 844, height: 390, mobile: true }
        ]) await capturePokedex(client, viewport);

        // Exercise the actual inputs, preserving undiscovered names and types.
        await check(client, `(() => {
            return [...document.querySelectorAll('.is-unknown')].every(el => !el.querySelector('img, .dex-type'));
        })()`, 'Une espèce inconnue ne doit pas révéler son sprite ou ses types');
        await evaluate(client, `document.querySelectorAll('.dex-filters button')[2].click()`);
        await waitForExpression(client, 'document.querySelectorAll(".dex-entry").length === 9');
        await check(client, 'document.querySelector(".dex-scroll").scrollTop === 0', 'Le filtre doit revenir en haut');
        await evaluate(client, `document.querySelectorAll('.dex-filters button')[0].click(); const input = document.querySelector('.dex-search input'); input.value = '#004'; input.dispatchEvent(new Event('input', { bubbles: true }));`);
        await waitForExpression(client, 'document.querySelectorAll(".dex-entry").length === 1');
        await check(client, `document.querySelector('.dex-entry h3').textContent === 'Salamèche'`, 'La recherche par numéro échoue');
        await evaluate(client, `const input = document.querySelector('.dex-search input'); input.value = 'salameche'; input.dispatchEvent(new Event('input', { bubbles: true }));`);
        await waitForExpression(client, 'document.querySelectorAll(".dex-entry").length === 1');
        await evaluate(client, `const input = document.querySelector('.dex-search input'); input.value = 'aucun-resultat'; input.dispatchEvent(new Event('input', { bubbles: true }));`);
        await waitForExpression(client, 'Boolean(document.querySelector(".dex-empty button"))');
        await evaluate(client, `document.querySelector('.dex-empty button').click(); const select = document.querySelector('.dex-region'); select.value = 'Johto'; select.dispatchEvent(new Event('change', { bubbles: true }));`);
        await waitForExpression(client, 'document.querySelectorAll(".dex-entry").length === 100');
        await check(client, `document.querySelector('.dex-number').textContent === '#152'`, 'Les bornes de région sont incorrectes');
        await evaluate(client, `const vm = ${gameVm}; vm.preferences = { ...vm.preferences, language: 'en' };`);
        await waitForExpression(client, `document.querySelector('.dex-summary-copy').textContent.includes('Your collection')`);

        // Keyboard events must stay inside the dialog and never move the player while searching.
        await check(client, `(() => {
            const vm = ${gameVm}; vm.releaseAllMovementKeys();
            const input = document.querySelector('.dex-search input'); input.focus();
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', bubbles: true }));
            return !Object.values(vm.keysPressed).some(Boolean);
        })()`, 'La recherche déclenche un mouvement');
        await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
        await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
        await waitForExpression(client, '!document.querySelector(".dex")');
        await check(client, `(() => {
            const vm = ${gameVm}; vm.stopMovementLoop(); vm.lock = true; vm.chatSession.visible = false;
            document.activeElement.blur();
            for (const [key, direction] of [['Z','z'],['Q','q'],['S','s'],['D','d'],['w','z'],['a','q'],['ArrowUp','z'],['ArrowLeft','q'],['ArrowDown','s'],['ArrowRight','d']]) {
                window.dispatchEvent(new KeyboardEvent('keydown', {key, cancelable:true}));
                if (!vm.keysPressed[direction]) return false;
                window.dispatchEvent(new KeyboardEvent('keyup', {key: key.toLowerCase()}));
                if (Object.values(vm.keysPressed).some(Boolean)) return false;
            }
            window.dispatchEvent(new KeyboardEvent('keydown', {key:'z',ctrlKey:true}));
            if (Object.values(vm.keysPressed).some(Boolean)) return false;
            vm.onMobileDirectionPress('z');
            if (!vm.keysPressed.z) return false;
            vm.onMobileDirectionRelease('z');
            return !Object.values(vm.keysPressed).some(Boolean);
        })()`, 'Régression des commandes clavier');
        console.log(`[pokedex] Filtres, recherche, confidentialité des inconnus, anglais, fermeture et clavier OK. Captures : ${outputDirectory}`);

        // Cross-check the real production bundle against every active server location.
        const { resolveMapSourceName } = require('../server/game/world/mapRepository');
        const locations = require('../data/game/nextMap.json').maps.map(({ mapName }) => ({
            name: mapName,
            foreground: fs.existsSync(path.join(projectRoot, 'vue-explorakit/src/assets', `${resolveMapSourceName(mapName)}_f.png`))
        }));
        await evaluate(client, `(async () => {
            const vm = ${gameVm};
            vm.socket.disconnect(); vm.stopMovementLoop(); vm.stopGameLoop();
            for (const location of ${JSON.stringify(locations)}) {
                vm.map = location.name;
                vm.loadMapImage(); vm.loadForegroundImage();
                if (!vm.mapImage.src) throw new Error('Décor absent du build : ' + location.name);
                await vm.mapImage.decode();
                if (location.foreground) {
                    if (!vm.foregroundImage?.src) throw new Error('Premier plan absent du build : ' + location.name);
                    await vm.foregroundImage.decode();
                }
            }
        })()`);
        console.log(`[world] Décors et premiers plans des ${locations.length} lieux actifs chargés et décodés dans Chromium.`);
    } finally {
        if (client) client.close();
        await stopChild(browser);
        await stopChild(server);
        await cleanupFixture(userId);
        fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
}

if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });

module.exports = {
    findBrowserExecutable, waitForServer, stopChild, waitForDebugPage, CdpClient,
    evaluate, waitForExpression, registerFixture, cleanupFixture, gameVm,
    getDatabaseConfig, projectRoot, testDatabaseName, serverPort, debugPort, baseUrl
};
