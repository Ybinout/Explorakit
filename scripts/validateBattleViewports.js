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
const outputDirectory = path.resolve(process.env.BATTLE_SCREENSHOT_DIR || path.join(projectRoot, 'docs', 'validation'));

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
        expression,
        awaitPromise: true,
        returnByValue: true
    });
    if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.text || 'Erreur JavaScript dans le navigateur.');
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

function validateLayout(layout, viewport) {
    const failures = [];
    const tolerance = 2;
    const required = ['battle', 'scene', 'actions', 'wildSprite', 'playerSprite', 'wildStatus', 'playerStatus'];
    for (const key of required) {
        if (!layout.rects[key]) failures.push(`${key} absent`);
    }
    if (failures.length) return failures;

    const withinViewport = (rect) => rect.left >= -tolerance
        && rect.right <= viewport.width + tolerance
        && rect.top >= -tolerance
        && rect.bottom <= viewport.height + tolerance;
    if (!withinViewport(layout.rects.battle)) failures.push('combat hors du viewport');
    if (!withinViewport(layout.rects.actions)) failures.push('commandes hors du viewport');
    if (!withinViewport(layout.rects.wildStatus)) failures.push('statut adverse hors du viewport');
    if (!withinViewport(layout.rects.playerStatus)) failures.push('statut joueur hors du viewport');
    if (layout.documentWidth > viewport.width + tolerance) failures.push('débordement horizontal du document');
    if (layout.rects.scene.height < 250) failures.push('zone de combat trop basse');
    if (viewport.mobile && layout.minimumButtonHeight < 44) failures.push('cible tactile inférieure à 44 px');

    const intersectsScene = (rect) => rect.right > layout.rects.scene.left
        && rect.left < layout.rects.scene.right
        && rect.bottom > layout.rects.scene.top
        && rect.top < layout.rects.scene.bottom;
    if (!intersectsScene(layout.rects.wildSprite)) failures.push('sprite adverse non visible dans la scène');
    if (!intersectsScene(layout.rects.playerSprite)) failures.push('sprite joueur non visible dans la scène');
    return failures;
}

async function captureViewport(client, viewport) {
    await client.send('Emulation.setDeviceMetricsOverride', {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        mobile: viewport.mobile
    });
    await new Promise((resolve) => setTimeout(resolve, 350));

    const layout = await evaluate(client, `(() => {
        const readRect = (selector) => {
            const element = document.querySelector(selector);
            if (!element) return null;
            const rect = element.getBoundingClientRect();
            return {
                left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
                width: rect.width, height: rect.height
            };
        };
        const buttonHeights = [...document.querySelectorAll('.battle-main-btn')]
            .map((button) => button.getBoundingClientRect().height);
        return {
            documentWidth: document.documentElement.scrollWidth,
            minimumButtonHeight: buttonHeights.length ? Math.min(...buttonHeights) : 0,
            rects: {
                battle: readRect('.battle'),
                scene: readRect('.battle-scene'),
                actions: readRect('.battle-action-shell'),
                wildSprite: readRect('.battle-sprite-wild .battle-sprite'),
                playerSprite: readRect('.battle-sprite-player .battle-sprite'),
                wildStatus: readRect('.battle-status-wild'),
                playerStatus: readRect('.battle-status-player')
            }
        };
    })()`);
    const failures = validateLayout(layout, viewport);
    if (failures.length) {
        throw new Error(`${viewport.name}: ${failures.join(', ')}`);
    }

    const screenshot = await client.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: false
    });
    const filename = `battle-${viewport.name}.png`;
    fs.writeFileSync(path.join(outputDirectory, filename), Buffer.from(screenshot.data, 'base64'));

    const targeting = await evaluate(client, `(() => {
        let node = document.querySelector('.game-stage');
        while (node && !node.__vue__) node = node.parentElement;
        const overlay = node.__vue__.$refs.battleOverlay;
        overlay.playMoveAnimation({ actor: 'player', moveName: 'Water Gun', moveType: 'Water', damageClass: 'special' });
        const target = overlay.getSpriteGeometry('wild');
        return {
            targetX: target.centerX,
            targetY: target.centerY,
            pathX: overlay.movePath.targetX,
            pathY: overlay.movePath.targetY
        };
    })()`);
    if (Math.abs(targeting.targetX - targeting.pathX) > 2 || Math.abs(targeting.targetY - targeting.pathY) > 2) {
        throw new Error(`${viewport.name}: l'attaque ne cible pas le centre visible du sprite`);
    }

    await evaluate(client, `(() => {
        let node = document.querySelector('.game-stage');
        while (node && !node.__vue__) node = node.parentElement;
        node.__vue__.$refs.battleOverlay.playCaptureAnimation({
            itemKey: 'superball', itemName: 'Super Ball', success: true, shakes: 3,
            wildPokemonName: 'Racaillou'
        });
        return true;
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 710));
    const captureTargeting = await evaluate(client, `(() => {
        const scene = document.querySelector('.battle-scene').getBoundingClientRect();
        const ball = document.querySelector('.capture-fx-ball').getBoundingClientRect();
        let node = document.querySelector('.game-stage');
        while (node && !node.__vue__) node = node.parentElement;
        const captureFx = node.__vue__.$refs.battleOverlay.captureFx;
        return {
            state: captureFx.state,
            targetContained: captureFx.targetContained,
            targetX: scene.left + captureFx.path.targetX,
            targetY: scene.top + captureFx.path.targetY,
            ballX: ball.left + ball.width / 2,
            ballY: ball.top + ball.height / 2
        };
    })()`);
    if (captureTargeting.state !== 'absorb' || !captureTargeting.targetContained) {
        throw new Error(`${viewport.name}: la phase d'absorption de capture est absente`);
    }
    if (Math.abs(captureTargeting.targetX - captureTargeting.ballX) > 3
        || Math.abs(captureTargeting.targetY - captureTargeting.ballY) > 3) {
        throw new Error(`${viewport.name}: la Ball ne touche pas le centre visible du Pokémon`);
    }
    const captureScreenshot = await client.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: false
    });
    const captureFilename = `battle-capture-${viewport.name}.png`;
    fs.writeFileSync(path.join(outputDirectory, captureFilename), Buffer.from(captureScreenshot.data, 'base64'));
    await evaluate(client, `(() => {
        let node = document.querySelector('.game-stage');
        while (node && !node.__vue__) node = node.parentElement;
        const overlay = node.__vue__.$refs.battleOverlay;
        overlay.clearCaptureTimers();
        Object.assign(overlay.captureFx, { visible: false, state: 'idle', targetContained: false });
        return true;
    })()`);
    return { ...viewport, filename, captureFilename, targeting, captureTargeting, layout };
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

async function run() {
    const browserExecutable = findBrowserExecutable();
    if (!browserExecutable) throw new Error('Edge ou Chrome est requis pour le test visuel.');
    if (!fs.existsSync(path.resolve(projectRoot, 'dist', 'index.html'))) {
        throw new Error('Le client doit être construit avant le test visuel (`npm run build:client`).');
    }

    fs.mkdirSync(outputDirectory, { recursive: true });
    const browserProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'explorakit-visual-'));
    const server = spawn(process.execPath, ['server/index.js'], {
        cwd: projectRoot,
        env: {
            ...process.env,
            PORT: String(serverPort),
            DB_NAME: testDatabaseName,
            JWT_SECRET: 'visual-test-secret-not-for-production'
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let browser = null;
    let client = null;
    let userId = null;
    try {
        console.log('[visual] démarrage du serveur de test');
        await waitForServer(server);
        console.log('[visual] création du compte temporaire');
        const fixture = await registerFixture();
        userId = fixture.user.id;
        const session = { ...fixture.user, token: fixture.token };

        browser = spawn(browserExecutable, [
            '--headless=new',
            '--disable-gpu',
            '--disable-gpu-sandbox',
            '--no-sandbox',
            '--use-angle=swiftshader',
            '--hide-scrollbars',
            '--no-first-run',
            `--remote-debugging-port=${debugPort}`,
            `--user-data-dir=${browserProfile}`,
            `${baseUrl}/connexion`
        ], { stdio: ['ignore', 'pipe', 'pipe'] });
        browser.stdout.on('data', (chunk) => process.stdout.write(`[browser] ${chunk}`));
        browser.stderr.on('data', (chunk) => process.stderr.write(`[browser] ${chunk}`));
        browser.once('exit', (code) => console.log(`[visual] navigateur arrêté (${code})`));

        console.log('[visual] connexion à Edge/Chrome headless');
        const debugPage = await waitForDebugPage();
        client = new CdpClient(debugPage.webSocketDebuggerUrl);
        await client.connect();
        await client.send('Page.enable');
        await client.send('Runtime.enable');
        await waitForExpression(client, `location.origin === ${JSON.stringify(baseUrl)}`);
        console.log('[visual] ouverture du jeu authentifié');
        await evaluate(client, `(() => {
            localStorage.setItem('user', ${JSON.stringify(JSON.stringify(session))});
            return true;
        })()`);
        await client.send('Page.navigate', { url: `${baseUrl}/game` });
        await waitForExpression(client, `(() => {
            let node = document.querySelector('.game-stage');
            while (node && !node.__vue__) node = node.parentElement;
            return Boolean(node && node.__vue__);
        })()`);

        console.log('[visual] injection de la scène de combat');
        await evaluate(client, `(async () => {
            let node = document.querySelector('.game-stage');
            while (node && !node.__vue__) node = node.parentElement;
            const vm = node.__vue__;
            const playerPokemon = {
                uuid: 'visual-player', name: 'Bulbizarre', truename: 'Bulbizarre', level: 12, k: 2,
                currentHp: 31, maxHp: 38, status: 'normal', passiveAbility: 'Overgrow',
                abilities: ['Tackle', 'Growl', 'Vine Whip', 'Growth'], movePp: [35, 40, 25, 20],
                data: { id: 1 }
            };
            const player = { equipe: { pokemons: [playerPokemon] } };
            const opponent = {
                uuid: 'visual-wild', name: 'Racaillou', truename: 'Racaillou', level: 10, k: 1,
                currentHp: 22, maxHp: 30, status: 'paralyze', passiveAbility: 'Rock Head',
                abilities: ['Tackle', 'Defense Curl', 'Rock Throw', 'Rock Polish'], movePp: [35, 40, 15, 20],
                data: { id: 74 }
            };
            vm.battle = true;
            await vm.$nextTick();
            const overlay = vm.$refs.battleOverlay;
            overlay.updateBattleState({ player, wildPokemon: opponent });
            overlay.updateFieldState({ weather: { kind: 'sun', turns: 3 } });
            overlay.requestAction('Quelle est votre prochaine action ?');
            await overlay.$nextTick();
            return true;
        })()`);
        await waitForExpression(client, `Boolean(document.querySelector('.battle-sprite-player'))`);
        await new Promise((resolve) => setTimeout(resolve, 700));

        const viewports = [
            { name: 'desktop', width: 1440, height: 900, mobile: false },
            { name: 'mobile', width: 390, height: 844, mobile: true }
        ];
        const results = [];
        for (const viewport of viewports) {
            console.log(`[visual] validation ${viewport.name} ${viewport.width}x${viewport.height}`);
            results.push(await captureViewport(client, viewport));
        }
        console.log(JSON.stringify({ success: true, browser: browserExecutable, results }, null, 2));
    } finally {
        if (client) client.close();
        await stopChild(browser);
        await stopChild(server);
        await cleanupFixture(userId);
        await new Promise((resolve) => setTimeout(resolve, 250));
        fs.rmSync(browserProfile, {
            recursive: true,
            force: true,
            maxRetries: 10,
            retryDelay: 200
        });
    }
}

run().catch((error) => {
    console.error(`Test visuel échoué : ${error.message}`);
    process.exitCode = 1;
});

