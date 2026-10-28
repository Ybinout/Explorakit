// Real encounter on a dedicated database; never touch an existing player's save.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { once } = require('node:events'), { randomUUID } = require('node:crypto');
if (!/test/i.test(process.env.DB_TEST_NAME || '')) throw Error('Dedicated test DB required');
process.env.DB_NAME = process.env.DB_TEST_NAME;
process.env.NODE_ENV = 'test';
const express = require('express'), { Server } = require('socket.io'), { chromium } = require('playwright');
const { dbPool } = require('../server/config/database');
const output = process.env.RELEASE_SCREENSHOTS || '/tmp/riftmon-wanda-rework-browser';
const dist = process.env.RELEASE_DIST_DIR || '/tmp/riftmon-opening-dist';
fs.mkdirSync(output, { recursive: true });
const app = express(), server = http.createServer(app), io = new Server(server);
app.use(express.json());
app.use('/api', require('../server/http/routes'));
app.use(express.static(dist));
app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
const cleanup = require('../server/realtime/driftLobbyHandler').registerDriftLobbies(io, { runtimeOptions: { random: () => .9, paceMs: 0 } });
let browser, page, userId, success = false;
const errors = [];
(async () => {
    try {
        server.listen(0, '127.0.0.1'); await once(server, 'listening');
        const base = `http://127.0.0.1:${server.address().port}`;
        const response = await fetch(base + '/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'wanda_' + randomUUID(), password: randomUUID(), starterId: 7 }) });
        assert.equal(response.status, 201);
        const fixture = await response.json(); userId = fixture.user.id;
        browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
        const context = await browser.newContext({ viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true });
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
            window.wandaVm = el.__vue__; return true;
        });
        await page.evaluate(() => { window.wandaVm.showMobileControls = true; window.wandaVm.updatePreferences({ ...window.wandaVm.preferences, masterVolume: 0 }); });
        const player = cleanup.runtime.playerFor({ id: userId });
        const lead = require('../server/game/drift/pokemonFactory').create(9, 100, true);
        lead.abilities = ['Ice Beam']; lead.movePp = [15]; lead.currentSpecialAttack = 9999; lead.currentSpeed = 999;
        lead.maxHp = lead.currentHp = 5000;
        player.equipe.pokemons = [lead]; player.currentmap = 'ville4_arene'; player.x = 432; player.y = 208;
        cleanup.runtime.enter(fixture.user, { id: player.socketId });
        await page.waitForFunction(() => window.wandaVm.map === 'ville4_arene');
        const opponent = { npc: true, equipe: require('../server/game/world/pnjTeamFactory').getPnjTeam('wanda'), drifts: [], equipped: [], chain: 0 };
        const battle = cleanup.runtime.battle(player, opponent, 'arena', 'champion_wanda');
        battle.deadline = Date.now() + 240000;
        const encountered = new Set([373]), speeches = [];
        const emit = battle.emit;
        battle.emit = (owner, event, payload) => {
            if (event === 'introAnimation') {
                if (payload.wildPokemon) encountered.add(payload.wildPokemon.data.id);
                speeches.push(...payload.transitions.filter(t => t.trainerSpeech));
            }
            return emit(owner, event, payload);
        };
        await page.locator('.action-attack:enabled').waitFor();
        assert.equal(battle.active(1).data.id, 373);
        let turns = 0;
        assert.equal(opponent.equipe.__trainerPlan.aceUuid,undefined);
        for(const [width,height]of [[393,852],[1365,900]]){await page.setViewportSize({width,height});await page.waitForTimeout(300);await page.evaluate(width=>window.wandaVm.showMobileControls=width<=920,width);await page.screenshot({path:path.join(output,`opening-${width}.png`)});}
        await page.setViewportSize({width:393,height:852});await page.waitForTimeout(300);await page.evaluate(()=>window.wandaVm.showMobileControls=true);
        while (!battle.finished && turns++ < 20) {
            await page.locator('.action-attack:enabled').waitFor();
            await page.locator('.action-attack:enabled').click();
            await page.locator('.battle-grid-attacks button:enabled').first().click();
            battle.deadline = Date.now() + 240000;
            if(!battle.finished)await page.waitForFunction(()=>!window.wandaVm.battle||!!document.querySelector('.action-attack:not(:disabled)'));
        }
        await page.waitForFunction(() => !window.wandaVm.battle);
        assert.deepEqual([...encountered].sort((a,b)=>a-b),[6,65,68,121,373,376]);assert.equal(speeches.length,0);
        for(const p of opponent.equipe.pokemons)assert(Object.values(p.iv).every(n=>p.data.id===376?n===31:n>=24&&n<=30));
        assert(battle.finished);
        assert.deepEqual(errors, []);
        success = true;
        console.log(JSON.stringify({ realWandaTeam: true, formsPreserved: true, noReservedAce: true, mixedIv:true,metagrossPerfect:true, viewports: 2, errors, output }));
    } finally {
        if (!success && page) await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
        await browser?.close(); cleanup(); await new Promise(resolve => io.close(resolve));
        if (userId) await dbPool.execute('DELETE FROM users WHERE id=?', [userId]);
        await dbPool.end();
    }
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
