// Real encounter on a dedicated database; never touch an existing player's save.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { once } = require('node:events'), { randomUUID } = require('node:crypto');
if (!/test/i.test(process.env.DB_TEST_NAME || '')) throw Error('Dedicated test DB required');
process.env.DB_NAME = process.env.DB_TEST_NAME;
process.env.NODE_ENV = 'test';
const express = require('express'), { Server } = require('socket.io'), { chromium } = require('playwright');
const { dbPool } = require('../server/config/database');
const output = process.env.RELEASE_SCREENSHOTS || '/tmp/explorakit-raph-browser';
const dist = process.env.RELEASE_DIST_DIR || '/tmp/explorakit-raph-dist';
fs.mkdirSync(output, { recursive: true });
const prefix = (process.env.RELEASE_PUBLIC_PATH || '/explorakit').replace(/\/$/, '');
const app = express(), server = http.createServer(app), io = new Server(server, { path: prefix + '/socket.io' });
app.use(express.json());
app.use(prefix + '/api', require('../server/http/routes'));
app.use(prefix || '/', express.static(dist));
app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
const cleanup = require('../server/realtime/driftLobbyHandler').registerDriftLobbies(io, { runtimeOptions: { random: () => .9, paceMs: 0 } });
let browser, page, userId, success = false;
const errors = [];
(async () => {
    try {
        server.listen(0, '127.0.0.1'); await once(server, 'listening');
        const base = `http://127.0.0.1:${server.address().port}${prefix}`;
        const response = await fetch(base + '/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'raph_' + randomUUID(), password: randomUUID(), starterId: 7 }) });
        assert.equal(response.status, 201);
        const fixture = await response.json(); userId = fixture.user.id;
        browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
        const context = await browser.newContext({ viewport: { width: 393, height: 852 }, hasTouch: process.env.RAPH_DESKTOP !== '1', isMobile: process.env.RAPH_DESKTOP !== '1' });
        await context.addInitScript(value => localStorage.setItem('explorakit.user', JSON.stringify(value)), { ...fixture.user, token: fixture.token });
        page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
        page.on('response', r => { if (r.url().startsWith(base) && r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
        await page.goto(base + '/colosseum', { waitUntil: 'networkidle' });
        await page.locator('[data-colosseum-start]:enabled').click();
        await page.locator('[data-starter-choice]').first().click();
        await page.locator('.starter-backdrop').waitFor({ state: 'hidden' });
        await page.waitForFunction(() => {
            let el = document.querySelector('.game-stage'); while (el && !el.__vue__) el = el.parentElement;
            if (!el?.__vue__?.socket?.connected) return false;
            window.raphVm = el.__vue__; return true;
        });
        await page.evaluate(() => { window.raphVm.showMobileControls = true; window.raphVm.updatePreferences({ ...window.raphVm.preferences, masterVolume: 0 }); });
        const player = cleanup.runtime.playerFor({ id: userId });
        const lead = require('../server/game/drift/pokemonFactory').create(9, 100, true);
        lead.abilities = ['Flamethrower']; lead.movePp = [15]; lead.currentSpecialAttack = lead.currentSpeed = 999;
        lead.maxHp = lead.currentHp = 5000;
        player.equipe.pokemons = [lead]; player.currentmap = 'gen_arene5'; player.x = 432; player.y = 208;
        cleanup.runtime.enter(fixture.user, { id: player.socketId });
        await page.waitForFunction(() => window.raphVm.map === 'gen_arene5');
        const opponent = { npc: true, equipe: require('../server/game/world/pnjTeamFactory').getPnjTeam('raphael'), drifts: [], equipped: [], chain: 0 };
        const battle = cleanup.runtime.battle(player, opponent, 'arena', 'champion_raphael');
        battle.deadline = Date.now() + 240000;
        const encountered = new Set([158]), speeches = [];
        const emit = battle.emit;
        battle.emit = (owner, event, payload) => {
            if (event === 'introAnimation') {
                if (payload.wildPokemon) encountered.add(payload.wildPokemon.data.id);
                speeches.push(...payload.transitions.filter(t => t.trainerSpeech));
            }
            return emit(owner, event, payload);
        };
        await page.locator('.action-attack:enabled').waitFor();
        await page.waitForFunction(() => window.raphVm.$refs.battleOverlay.music?.readyState >= 2);
        assert.equal(await page.evaluate(() => window.raphVm.$refs.battleOverlay.musicKind), 'raph');
        await page.evaluate(() => { window.raphMusic = window.raphVm.$refs.battleOverlay.music; });
        for (const [width, height] of [[320,568], [393,852], [844,390], [1365,900]]) {
            await page.setViewportSize({ width, height });
            await page.waitForTimeout(200);
            await page.evaluate(width => { window.raphVm.showMobileControls = width < 1000; }, width);
            await page.waitForTimeout(50);
            assert.equal(await page.locator('.game-root').evaluate(el => el.classList.contains('is-mobile')), width < 1000);
            const backdrop = page.locator('[data-battle-environment="raph-gym"] img');
            await backdrop.evaluate(el => el.decode());
            const source = await backdrop.evaluate(el => el.currentSrc);
            assert.match(source, width <= 720 ? /raph-mobile/ : /raph-wide/);
            for (const side of ['wild']) {
                const platform = await page.locator('[data-battle-platform="'+side+'"]').boundingBox();
                const sprite = await page.locator('.battle-sprite-'+side).boundingBox();
                assert(Math.abs(platform.x - sprite.x) < 1 && Math.abs(platform.y - sprite.y) < 1, 'Shared ground anchors');
                assert.equal(await page.locator('[data-battle-platform="'+side+'"] .raph-disc').count(), 1);
            }
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
            await page.screenshot({ path:path.join(output, 'raph-arena-'+width+'.png') });
        }
        await page.setViewportSize({ width:393, height:852 });
        await page.evaluate(() => { window.raphVm.showMobileControls = true; });
        await page.evaluate(() => window.raphVm.updatePreferences({ ...window.raphVm.preferences, masterVolume: .3 }));
        await page.locator('.battle-status-wild').click();
        await page.waitForFunction(() => !window.raphMusic.paused && window.raphMusic.currentTime > 0);
        assert.equal(battle.active(1).data.id, 158);
        let turns = 0;
        while (battle.active(1).data.id !== 212 && turns++ < 12) {
            await page.locator('.action-attack:enabled').click();
            await page.locator('.battle-grid-attacks button:enabled').first().click();
            battle.deadline = Date.now() + 240000;
            encountered.add(battle.active(1).data.id);
            if (battle.active(1).data.id !== 212) await page.locator('.action-attack:enabled').waitFor();
            encountered.add(battle.active(1).data.id);
        }
        assert.deepEqual([...encountered].sort((a, b) => a - b), [55,158,212,330,359]);
        assert.equal(battle.active(1).data.id, 212);
        assert(await page.evaluate(() => window.raphMusic === window.raphVm.$refs.battleOverlay.music), 'Track must continue through turns and switches');
        assert.equal(battle.active(1).k, 4);
        assert(opponent.equipe.pokemons.filter(p => p.data.id !== 212).every(p => p.currentHp <= 0));
        assert.equal(speeches.length, 1);
        await page.locator('[data-trainer-speech]').waitFor();
        assert.match(await page.locator('[data-trainer-speech]').innerText(), /Raphael.*Cizayox/s);
        for (const [width, height] of [[393,852], [1365,900]]) {
            await page.setViewportSize({ width, height });
            await page.waitForTimeout(150);
            assert(await page.locator('[data-trainer-speech]').evaluate(el => { const r = el.getBoundingClientRect(); return r.x >= 0 && r.right <= innerWidth + 1 && r.y >= 0 && r.bottom <= innerHeight; }));
            await page.screenshot({ path: path.join(output, `cizayox-${width}.png`) });
        }
        await page.locator('.action-attack:enabled').waitFor();
        await page.locator('.action-attack:enabled').click();
        await page.locator('.battle-grid-attacks button:enabled').first().click();
        await page.waitForFunction(() => !window.raphVm.battle);
        assert(battle.finished);
        assert.deepEqual(errors, []);
        success = true;
        console.log(JSON.stringify({ realRaphTeam: true, formsPreserved: true, aceLast: true, aceK: 4, trainerSpeech: true, viewports: 4, raphBackground:true, alignedPlatforms:true, continuousMusic:true, errors, output }));
    } finally {
        if (!success && page) await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
        await browser?.close(); cleanup(); await new Promise(resolve => io.close(resolve));
        if (userId) await dbPool.execute('DELETE FROM users WHERE id=?', [userId]);
        await dbPool.end();
    }
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
