const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const mysql = require('mysql2/promise');
const {
    findBrowserExecutable, waitForServer, stopChild, waitForDebugPage, CdpClient,
    evaluate, waitForExpression, registerFixture, cleanupFixture, gameVm,
    getDatabaseConfig, projectRoot, testDatabaseName, serverPort, debugPort, baseUrl
} = require('./validatePokedexViewports');

async function run() {
    const directory = path.resolve(process.env.ADVENTURE_SCREENSHOT_DIR || path.join(os.tmpdir(), 'explorakit-adventure-validation'));
    fs.mkdirSync(directory, { recursive: true });
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'explorakit-adventure-browser-'));
    const server = spawn(process.execPath, ['server/index.js'], {
        cwd: projectRoot, env: { ...process.env, PORT: String(serverPort), DB_NAME: testDatabaseName, JWT_SECRET: 'adventure-visual-test' },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let browser, client, userId;
    try {
        await waitForServer(server);
        const fixture = await registerFixture();
        userId = fixture.user.id;
        const db = await mysql.createConnection(getDatabaseConfig());
        try {
            await db.execute('UPDATE users SET map = ?, x = ?, y = ? WHERE id = ?', ['gen_ville5', 21 * 32 + 16, 17 * 32 + 16, userId]);
            await db.execute('UPDATE pokemons p JOIN teams t ON t.id = p.team_id SET p.ev_attack = 100, p.ev_speed = 40 WHERE t.user_id = ?', [userId]);
        } finally { await db.end(); }
        browser = spawn(findBrowserExecutable(), ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run',
            '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, `${baseUrl}/connexion`], { stdio: 'ignore' });
        client = new CdpClient((await waitForDebugPage()).webSocketDebuggerUrl);
        await client.connect();
        await client.send('Page.enable');
        await client.send('Runtime.enable');
        await waitForExpression(client, `location.origin === ${JSON.stringify(baseUrl)}`);
        await evaluate(client, `localStorage.setItem('user', ${JSON.stringify(JSON.stringify({ ...fixture.user, token: fixture.token }))})`);
        await client.send('Page.navigate', { url: `${baseUrl}/game` });
        await waitForExpression(client, `Boolean(${gameVm}?.socket?.connected && ${gameVm}?.pnjs?.length === 3)`);
        await evaluate(client, `window.npcInitial = ${gameVm}.pnjs.map(p => ({ name:p.name, x:p.x, y:p.y })); true;`);
        await waitForExpression(client, `${gameVm}.pnjs.some(p => window.npcInitial.some(old => old.name === p.name && (old.x !== p.x || old.y !== p.y)))`);
        await evaluate(client, `(async () => { const vm = ${gameVm}; await vm.loadTeamPokemons(); vm.isTeamPanelOpen = true; })()`);
        assert.equal(await evaluate(client, `${gameVm}.teamPokemons[0].ev.attack`), 100);
        for (const [name, width, height, mobile] of [
            ['desktop', 1440, 900, false], ['mobile', 390, 844, true], ['small-mobile', 320, 568, true], ['landscape', 844, 390, true]
        ]) {
            await client.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
            await evaluate(client, `const vm = ${gameVm}; vm.isTeamPanelOpen = true; vm.selectedPokemonUuid = null; true;`);
            await waitForExpression(client, `Boolean(document.querySelector('.team-detail-link'))`);
            await evaluate(client, `document.querySelector('.team-detail-link').focus(); document.querySelector('.team-detail-link').click(); true;`);
            await waitForExpression(client, `Boolean(document.querySelector('.companion-radar'))`);
            const metrics = await evaluate(client, `(() => {
                const el = document.querySelector('.companion-sheet'), rect = el.getBoundingClientRect();
                return { left:rect.left, right:rect.right, top:rect.top, bottom:rect.bottom, overflow:el.scrollWidth > el.clientWidth + 1, graph:document.querySelector('.radar-value').getAttribute('points') };
            })()`);
            assert.ok(metrics.left >= 0 && metrics.right <= width && metrics.top >= 0 && metrics.bottom <= height, JSON.stringify(metrics));
            assert.equal(metrics.overflow, false, `${name} : débordement fiche`);
            const shot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
            fs.writeFileSync(path.join(directory, `companion-${name}.png`), Buffer.from(shot.data, 'base64'));
            await evaluate(client, `document.getElementById('companion-tab-ev').click(); true;`);
            assert.notEqual(await evaluate(client, `document.querySelector('.radar-value').getAttribute('points')`), metrics.graph);
            assert.ok((await evaluate(client, `document.querySelector('.companion-tip').textContent`)).includes('140 / 510'));
            await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
            await waitForExpression(client, `!document.querySelector('.companion-sheet')`);
            assert.equal(await evaluate(client, `document.activeElement.classList.contains('team-detail-link')`), true);
            console.log(`[adventure] Fiche ${name} : stats/EV, cadrage, focus et fermeture validés.`);
        }
        await evaluate(client, `const vm = ${gameVm}; vm.isTeamPanelOpen = false; vm.battle = true; true;`);
        await evaluate(client, `const vm = ${gameVm}, overlay = vm.$refs.battleOverlay;
            const pokemon = JSON.parse(JSON.stringify(vm.teamPokemons[0]));
            overlay.updateBattleState({ player:{ equipe:{ pokemons:[pokemon] } }, wildPokemon:{ ...pokemon, uuid:'enemy' } });
            overlay.startMusic('wild'); overlay.requestAction('Que doit faire ton Pokémon ?'); true;`);
        await waitForExpression(client, `Boolean(${gameVm}.$refs.battleOverlay.music?.readyState >= 2)`);
        assert.equal(await evaluate(client, `${gameVm}.$refs.battleOverlay.music.paused`), false);
        await evaluate(client, `${gameVm}.$refs.battleOverlay.toggleSound(); true;`);
        assert.equal(await evaluate(client, `${gameVm}.$refs.battleOverlay.music.paused`), true);
        await evaluate(client, `${gameVm}.$refs.battleOverlay.toggleSound(); true;`);
        for (const kind of ['trainer', 'arena', 'pvp']) {
            await evaluate(client, `${gameVm}.$refs.battleOverlay.startMusic(${JSON.stringify(kind)}); true;`);
            await waitForExpression(client, `Boolean(${gameVm}.$refs.battleOverlay.music?.readyState >= 2)`);
        }
        await evaluate(client, `const o = ${gameVm}.$refs.battleOverlay; o.updateExperience({ pokemon:{ ...o.currentPokemon, experience:100 }, previousLevel:5, xpGained:36 }); true;`);
        assert.ok(await evaluate(client, `Number(document.querySelector('.battle-status-player .experience-track').getAttribute('aria-valuenow')) > 0`));
        for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844], ['small-mobile', 320, 568], ['landscape', 844, 390]]) {
            await client.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: name !== 'desktop' });
            await new Promise(resolve => setTimeout(resolve, 200));
            const boxes = await evaluate(client, `['.battle', '.battle-action-shell', '.battle-status-player', '.battle-status-wild', '.battle-status-player .experience-track'].map(selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { selector, left:r.left, right:r.right, top:r.top, bottom:r.bottom }; })`);
            for (const box of boxes) assert.ok(box.left >= -1 && box.right <= width + 1 && box.top >= -1 && box.bottom <= height + 1, `${name} : ${JSON.stringify(box)}`);
            const shot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
            fs.writeFileSync(path.join(directory, `battle-${name}.png`), Buffer.from(shot.data, 'base64'));
        }
        await evaluate(client, `window.oldMusic = ${gameVm}.$refs.battleOverlay.music; ${gameVm}.battle = false; true;`);
        await waitForExpression(client, `${gameVm}.$refs.battleOverlay.music === null`);
        assert.equal(await evaluate(client, `window.oldMusic.paused`), true);
        const dialogues = require('../data/game/interact.json');
        await evaluate(client, `const vm = ${gameVm}; vm.preferences.textSpeed = 10000; vm.updateTextImageSequence(${JSON.stringify(dialogues.find(d => d.name === 'town_nadir').sentences)}); true;`);
        await waitForExpression(client, `Boolean(document.querySelector('.portrait-atlas'))`);
        const shot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        fs.writeFileSync(path.join(directory, 'npc-portrait.png'), Buffer.from(shot.data, 'base64'));
        console.log(`[adventure] PNJ mobiles, portrait, musique des quatre modes, arrêt et XP validés. Captures : ${directory}`);
    } finally {
        client?.close();
        await stopChild(browser);
        await stopChild(server);
        await cleanupFixture(userId);
        fs.rmSync(profile, { recursive: true, force: true });
    }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
