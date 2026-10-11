const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const {
    findBrowserExecutable, waitForServer, stopChild, waitForDebugPage, CdpClient,
    evaluate, waitForExpression, registerFixture, cleanupFixture, gameVm,
    projectRoot, testDatabaseName, serverPort, debugPort, baseUrl
} = require('./validatePokedexViewports');

// Controls exist only in this child process over IPC. The shipped application
// exposes neither a battle injection endpoint nor a test-only Socket command.
const harness = `
const express = require('express'), http = require('http'), path = require('path');
const { Server } = require('socket.io');
const app = express(), server = http.createServer(app), io = new Server(server);
const factory = require('./server/game/drift/pokemonFactory');
const { loadEquipe } = require('./server/persistence/teamRepository');
const startWildBattle = require('./server/game/battle/wildBattle');
io.use(require('./server/http/authMiddleware').authenticateSocket);
app.use(express.json());
app.use('/api', require('./server/http/routes'));
app.use(express.static(path.resolve('dist')));
app.get('*', (req, res) => res.sendFile(path.resolve('dist/index.html')));
require('./server/realtime/socketHandler')(io);
let movements = 0, dialogueCompletions = 0, pendingBattle = null;
io.on('connection', socket => {
    socket.on('playerAction', () => movements++);
    socket.on('onEndDialogue', () => dialogueCompletions++);
});
process.on('message', async message => {
    try {
        const socket = io.sockets.sockets.get(message.socketId);
        if (!socket) throw Error('Socket de test absente.');
        const userId = socket.data.user.id;
        if (message.type === 'fixture') {
            const player = { id: socket.id, userId, equipe: { pokemons: [factory.create(1, 12)] } };
            socket.emit('battletrigger', { battleType: message.payload.battleType || 'wild' });
            socket.emit('introAnimation', { player, wildPokemon: factory.create(19, 7) });
            setTimeout(() => {
                socket.emit('endbattle', message.payload);
                for (const followUp of message.afterEnd || []) socket.emit(followUp.event, followUp.payload);
            }, 100);
        }
        if (message.type === 'capture') {
            const player = { id: socket.id, userId, equipe: await loadEquipe(userId) };
            const wildPokemon = factory.create(19, 2);
            wildPokemon.currentHp = 1;
            socket.emit('battletrigger', { battleType: 'wild' });
            const previousRandom = Math.random;
            Math.random = () => 0;
            pendingBattle = startWildBattle(player, wildPokemon, io, userId)
                .finally(() => { Math.random = previousRandom; });
        }
        if (message.type === 'settled') await pendingBattle;
        process.send({ id: message.id, ok: true, movements, dialogueCompletions });
    } catch (error) {
        process.send({ id: message.id, ok: false, message: error.stack });
    }
});
server.listen(process.env.PORT, () => console.log('Server is running'));
`;

const viewports = [
    { name: 'desktop', width: 1440, height: 900, mobile: false },
    { name: 'mobile', width: 390, height: 844, mobile: true },
    { name: 'small-mobile', width: 320, height: 568, mobile: true },
    { name: 'landscape', width: 844, height: 390, mobile: true }
];
const summary = (outcome, extra = {}) => ({
    outcome, mode: 'adventure', experience: [], money: 0, loot: [],
    capturedPokemon: null, lostPokemon: [], ...extra
});

async function run() {
    const directory = path.resolve(process.env.BATTLE_RESULTS_SCREENSHOT_DIR || path.join(os.tmpdir(), 'explorakit-battle-results'));
    fs.mkdirSync(directory, { recursive: true });
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'explorakit-battle-results-browser-'));
    const server = spawn(process.execPath, ['-e', harness], {
        cwd: projectRoot,
        env: {
            ...process.env, PORT: String(serverPort), DB_NAME: testDatabaseName,
            JWT_SECRET: 'battle-results-visual-test', NODE_ENV: 'test', BATTLE_DELAY_SCALE: '0'
        },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    });
    let browser, client, userId, socketId, sequence = 0;
    const runtimeErrors = [];
    function control(type, extra = {}) {
        return new Promise((resolve, reject) => {
            const id = ++sequence;
            const timer = setTimeout(() => { server.off('message', listener); reject(Error('IPC timeout : ' + type)); }, 10000);
            const listener = message => {
                if (message.id !== id) return;
                clearTimeout(timer); server.off('message', listener);
                if (message.ok) resolve(message); else reject(Error(message.message));
            };
            server.on('message', listener);
            server.send({ type, id, socketId, ...extra });
        });
    }
    async function click(selector) {
        const point = await evaluate(client, `(() => {
            const button = document.querySelector(${JSON.stringify(selector)});
            if (!button || button.disabled) throw Error('Commande absente ou inactive : ' + ${JSON.stringify(selector)});
            const r = button.getBoundingClientRect();
            if (!r.width || !r.height) throw Error('Commande masquée : ' + ${JSON.stringify(selector)});
            return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        })()`);
        await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
        await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
    }
    async function press(key, code = key, modifiers = 0) {
        await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, modifiers });
        await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers });
    }
    async function waitForResult(outcome) {
        await waitForExpression(client, `Boolean(document.querySelector('[data-battle-result]')) && ${gameVm}.battleResult?.outcome === ${JSON.stringify(outcome)}`);
        assert.equal(await evaluate(client, `${gameVm}.battle`), false, 'le combat est terminé sous le bilan');
        assert.equal(await evaluate(client, "document.querySelector('[data-battle-result]').contains(document.activeElement)"), true, 'le bilan reçoit le focus');
        assert.equal(await evaluate(client, "document.querySelector('[data-battle-result]').getAttribute('aria-modal')"), 'true');
    }
    async function capture(name) {
        for (const viewport of viewports) {
            await client.send('Emulation.setDeviceMetricsOverride', { ...viewport, name: undefined, deviceScaleFactor: 1 });
            await evaluate(client, 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
            const layout = await evaluate(client, `(() => {
                const nodes = ['[data-battle-result]', '[data-battle-result-continue]', '#battle-result-title'];
                return {
                    width: document.documentElement.scrollWidth,
                    rects: nodes.map(selector => {
                        const node = document.querySelector(selector), r = node.getBoundingClientRect();
                        return { selector, left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height,
                            overflow: node.scrollWidth > node.clientWidth + 1 };
                    })
                };
            })()`);
            assert.ok(layout.width <= viewport.width + 1, `${name}/${viewport.name} : débordement document`);
            for (const rect of layout.rects) {
                assert.ok(rect.left >= -1 && rect.right <= viewport.width + 1 && rect.top >= -1 && rect.bottom <= viewport.height + 1,
                    `${name}/${viewport.name} : élément hors écran ${JSON.stringify(rect)}`);
                assert.equal(rect.overflow, false, `${name}/${viewport.name} : débordement ${rect.selector}`);
            }
            assert.ok(layout.rects[1].height >= 44, 'Continuer reste une cible tactile de 44 px');
            const shot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
            fs.writeFileSync(path.join(directory, `${name}-${viewport.name}.png`), Buffer.from(shot.data, 'base64'));
        }
    }
    async function assertMovementBlocked() {
        const before = (await control('count')).movements;
        await press('d', 'KeyD');
        await evaluate(client, `(() => {
            const vm = ${gameVm}; vm.onMobileDirectionPress('d'); vm.updatePlayerPosition(); vm.onMobileDirectionRelease('d');
            return true;
        })()`);
        await new Promise(resolve => setTimeout(resolve, 220));
        assert.equal((await control('count')).movements, before, 'aucun déplacement clavier/tactile émis pendant le bilan');
        assert.equal(await evaluate(client, `${gameVm}.keysPressed.d`), false, 'aucune touche de déplacement conservée');
        await press('Tab');
        assert.equal(await evaluate(client, "document.querySelector('[data-battle-result]').contains(document.activeElement)"), true, 'Tab reste dans le bilan');
        await press('Tab', 'Tab', 8);
        assert.equal(await evaluate(client, "document.querySelector('[data-battle-result]').contains(document.activeElement)"), true, 'Maj+Tab reste dans le bilan');
        await new Promise(resolve => setTimeout(resolve, 900));
        assert.equal(await evaluate(client, "Boolean(document.querySelector('[data-battle-result]'))"), true, 'le bilan attend une confirmation explicite');
    }
    async function dismiss(key) {
        if (key) await press(key); else await click('[data-battle-result-continue]');
        await waitForExpression(client, "!document.querySelector('[data-battle-result]')");
    }
    try {
        await waitForServer(server);
        const fixture = await registerFixture(); userId = fixture.user.id;
        browser = spawn(findBrowserExecutable(), [
            '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run',
            `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, baseUrl + '/'
        ], { stdio: 'ignore' });
        client = new CdpClient((await waitForDebugPage()).webSocketDebuggerUrl); await client.connect();
        client.socket.addEventListener('message', event => {
            const message = JSON.parse(event.data);
            if (message.method === 'Runtime.exceptionThrown') runtimeErrors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
        });
        await client.send('Page.enable'); await client.send('Runtime.enable');
        await waitForExpression(client, `location.origin === ${JSON.stringify(baseUrl)}`);
        await evaluate(client, `localStorage.setItem('user', ${JSON.stringify(JSON.stringify({ ...fixture.user, token: fixture.token }))})`);
        await client.send('Page.navigate', { url: baseUrl + '/game' });
        await waitForExpression(client, `Boolean(${gameVm}?.socket?.connected && ${gameVm}.players[${gameVm}.socket.id])`);
        socketId = await evaluate(client, `${gameVm}.socket.id`);
        // The map introduction is unrelated to battle-result rendering.
        await evaluate(client, `${gameVm}.textImageSequence=[]; ${gameVm}.lock=false; true;`);
        const cases = [
            ['victory', { playerWon: true, reason: 'victory', battleType: 'trainer', summary: summary('victory', {
                experience: [{ uuid: 'bulbasaur', pokemonId: 1, name: 'Bulbizarre', xpGained: 164, previousLevel: 11, level: 12 }],
                money: 450, loot: ['Badge des racines', 'Lettre pour les archives de Clairbois']
            }) }],
            ['defeat', { playerWon: false, reason: 'defeat', summary: summary('defeat') }],
            ['fled', { playerWon: false, reason: 'fled', fled: true, summary: summary('fled') }],
            ['draw', { playerWon: false, reason: 'finished', draw: true, battleType: 'pvp', summary: summary('draw') }],
            ['interrupted', { playerWon: false, reason: 'timeout', interrupted: true, summary: summary('interrupted') }]
        ];
        for (const [outcome, payload] of cases) {
            // These two follow-ups reproduce the production Socket ordering,
            // with fixture content. Only the capture below plays a real battle.
            const afterEnd = outcome === 'victory' ? [{ event: 'dialogue', payload: [[
                { text: 'Bravo ! La route de Clairbois t’attend.', imageName: 'a.png' },
                { text: 'Prends soin de ton équipe avant de repartir.', imageName: 'a.png' }
            ], 'visual_battle_followup'] }] : outcome === 'defeat' ? [{
                event: 'blackout', payload: { message: 'Ton équipe a été soignée et ramenée au Centre Pokémon.' }
            }] : [];
            const completedBefore = (await control('count')).dialogueCompletions;
            await control('fixture', { payload, afterEnd }); await waitForResult(outcome);
            if (outcome === 'victory') {
                assert.match(await evaluate(client, "document.querySelector('.result-experience').textContent"), /164/);
                assert.match(await evaluate(client, "document.querySelector('.level-gained').textContent"), /11.*12/s);
                assert.match(await evaluate(client, "document.querySelector('.result-money').textContent"), /450/);
                assert.match(await evaluate(client, "document.querySelector('.result-loot').textContent"), /Badge des racines/);
                await waitForExpression(client, `${gameVm}.textImageSequence.length === 2`);
                assert.equal(await evaluate(client, "Boolean(document.querySelector('.dialogue-layer'))"), false, 'la scène de victoire attend derrière le bilan');
            }
            if (outcome === 'defeat') {
                await waitForExpression(client, `Boolean(${gameVm}.battleResult?.recoveryMessage)`);
                assert.match(await evaluate(client, "document.querySelector('.result-recovery').textContent"), /soignée.*Centre Pokémon/);
                assert.equal(await evaluate(client, "Boolean(document.querySelector('[data-battle-result]'))"), true, 'blackout complète le bilan sans le fermer');
            }
            await capture(outcome); await assertMovementBlocked();
            assert.equal((await control('count')).dialogueCompletions, completedBefore, 'aucun dialogue consommé pendant le bilan');
            await dismiss(outcome === 'victory' ? ' ' : outcome === 'defeat' ? 'Escape' : outcome === 'draw' ? 'Enter' : null);
            if (outcome === 'victory') {
                await waitForExpression(client, "Boolean(document.querySelector('.dialogue-layer'))");
                assert.match(await evaluate(client, "document.querySelector('.dialogue-layer .text').textContent"), /Bravo.*Clairbois/);
                assert.equal((await control('count')).dialogueCompletions, completedBefore, 'Continuer révèle la première phrase sans consommer le dialogue');
                await press(' ', 'Space');
                await waitForExpression(client, "document.querySelector('.dialogue-layer .text').textContent.includes('Prends soin')");
                await press(' ', 'Space');
                await waitForExpression(client, "!document.querySelector('.dialogue-layer')");
                assert.equal((await control('count')).dialogueCompletions, completedBefore + 1, 'le dialogue se termine une seule fois après sa lecture');
            }
        }
        // Legacy servers still send only reason/playerWon; do not require the
        // additive summary field for a clear, non-misleading result.
        for (const [outcome, payload] of [
            ['victory', { playerWon: true }], ['defeat', { playerWon: false }],
            ['captured', { playerWon: true, captured: true, reason: 'captured' }],
            ['fled', { playerWon: false, reason: 'fled' }],
            ['draw', { playerWon: false, draw: true, reason: 'finished', battleType: 'pvp' }],
            ['interrupted', { playerWon: false, reason: 'timeout' }]
        ]) {
            await control('fixture', { payload }); await waitForResult(outcome); await dismiss();
        }
        // Exercise the actual Adventure capture orchestrator, item consumption,
        // persistence and the frontend bag action; this result is not a fixture.
        await control('capture');
        await waitForExpression(client, `Boolean(${gameVm}.battle && ${gameVm}.$refs.battleOverlay.canChooseAction)`);
        await click('.action-bag');
        await waitForExpression(client, "Boolean(document.querySelector('.battle-choice-btn-bag'))");
        await click('.battle-choice-btn-bag');
        await waitForResult('captured'); await control('settled');
        assert.match(await evaluate(client, "document.querySelector('[data-battle-result]').textContent"), /Rattata/);
        const captureResult = await evaluate(client, `${gameVm}.battleResult.capturedPokemon`);
        assert.equal(captureResult.pokemonId, 19, 'la capture réelle fournit la bonne espèce');
        await capture('captured'); await assertMovementBlocked(); await dismiss();
        const before = (await control('count')).movements;
        await evaluate(client, `(() => {
            const vm = ${gameVm}; document.activeElement?.blur(); vm.onMobileDirectionPress('d'); vm.updatePlayerPosition(); vm.onMobileDirectionRelease('d'); return true;
        })()`);
        await new Promise(resolve => setTimeout(resolve, 180));
        assert.ok((await control('count')).movements > before, 'les déplacements reprennent après Continuer');
        assert.deepEqual(runtimeErrors, [], 'aucune exception navigateur');
        console.log('Résultats Aventure : victoire, défaite, fuite, égalité, interruption et capture réelle, six anciens payloads compatibles, quatre formats, focus, clavier/tactile bloqués pendant le bilan puis reprise après confirmation. Séquences Socket simulées : dialogue post-victoire révélé et lu après Continuer seulement ; blackout conservant le bilan et ajoutant le soin. ' + directory);
    } finally {
        client?.close(); await stopChild(browser); await stopChild(server); await cleanupFixture(userId);
        fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
}

if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
