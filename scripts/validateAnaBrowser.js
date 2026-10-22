// Real encounter on a dedicated database; never touch an existing player's save.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { once } = require('node:events'), { randomUUID } = require('node:crypto');
if (!/test/i.test(process.env.DB_TEST_NAME || '')) throw Error('Dedicated test DB required');
process.env.DB_NAME = process.env.DB_TEST_NAME;
process.env.NODE_ENV = 'test';
const express = require('express'), { Server } = require('socket.io'), { chromium } = require('playwright');
const { dbPool } = require('../server/config/database');
const output = process.env.RELEASE_SCREENSHOTS || '/tmp/explorakit-ana-team-browser';
const dist = process.env.RELEASE_DIST_DIR || '/tmp/explorakit-ana-team-dist';
fs.mkdirSync(output, { recursive: true });
const app = express(), server = http.createServer(app), io = new Server(server, { path: '/explorakit/socket.io' });
app.use(express.json());
app.use('/explorakit/api', require('../server/http/routes'));
app.use('/explorakit', express.static(dist));
app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
const cleanup = require('../server/realtime/driftLobbyHandler').registerDriftLobbies(io, { runtimeOptions: { random: () => .9, paceMs: 0 } });
let browser, page, userId, success = false;
const errors = [];
(async () => {
    try {
        server.listen(0, '127.0.0.1'); await once(server, 'listening');
        const base = `http://127.0.0.1:${server.address().port}/explorakit`;
        const response = await fetch(base + '/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'ana_' + randomUUID(), password: randomUUID(), starterId: 7 }) });
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
            window.anaVm = el.__vue__; return true;
        });
        await page.evaluate(() => { window.anaVm.showMobileControls = true; window.anaVm.updatePreferences({ ...window.anaVm.preferences, masterVolume: 0 }); });
        const player = cleanup.runtime.playerFor({ id: userId });
        const lead = require('../server/game/drift/pokemonFactory').create(9, 100, true);
        lead.abilities = ['Surf']; lead.movePp = [15]; lead.currentSpecialAttack = 9999; lead.currentSpeed = 999;
        lead.maxHp = lead.currentHp = 5000;
        player.equipe.pokemons = [lead]; player.currentmap = 'ville3_arene'; player.x = 432; player.y = 208;
        cleanup.runtime.enter(fixture.user, { id: player.socketId });
        await page.waitForFunction(() => window.anaVm.map === 'ville3_arene');
        const opponent = { npc: true, equipe: require('../server/game/world/pnjTeamFactory').getPnjTeam('ana'), drifts: [], equipped: [], chain: 0 };
        const battle = cleanup.runtime.battle(player, opponent, 'arena', 'champion_ana');
        battle.deadline = Date.now() + 240000;
        const encountered = new Set([53]), speeches = [];
        const emit = battle.emit;
        battle.emit = (owner, event, payload) => {
            if (event === 'introAnimation') {
                if (payload.wildPokemon) encountered.add(payload.wildPokemon.data.id);
                speeches.push(...payload.transitions.filter(t => t.trainerSpeech));
            }
            return emit(owner, event, payload);
        };
        await page.locator('.action-attack:enabled').waitFor();
        assert.equal(battle.active(1).data.id, 53);
        let turns = 0;
        while (battle.active(1).data.id !== 282 && turns++ < 20) {
            await page.locator('.action-attack:enabled').click();
            await page.locator('.battle-grid-attacks button:enabled').first().click();
            battle.deadline = Date.now() + 240000;
            encountered.add(battle.active(1).data.id);
            if (battle.active(1).data.id !== 282) await page.locator('.action-attack:enabled').waitFor();
            encountered.add(battle.active(1).data.id);
        }
        assert.deepEqual([...encountered].sort((a, b) => a - b), [53,78,148,154,282,407]);
        assert.equal(battle.active(1).data.id, 282);
        assert.equal(battle.active(1).k, 4);
        assert(opponent.equipe.pokemons.filter(p => p.data.id !== 282).every(p => p.currentHp <= 0));
        assert.equal(speeches.length, 1);
        await page.locator('[data-trainer-speech]').waitFor();
        assert.match(await page.locator('[data-trainer-speech]').innerText(), /Ana.*Gardevoir/s);
        for (const [width, height] of [[393,852], [1365,900]]) {
            await page.setViewportSize({ width, height });
            await page.waitForTimeout(150);
            assert(await page.locator('[data-trainer-speech]').evaluate(el => { const r = el.getBoundingClientRect(); return r.x >= 0 && r.right <= innerWidth + 1 && r.y >= 0 && r.bottom <= innerHeight; }));
            await page.screenshot({ path: path.join(output, `gardevoir-${width}.png`) });
        }
        await page.locator('.action-attack:enabled').waitFor();
        await page.locator('.action-attack:enabled').click();
        await page.locator('.battle-grid-attacks button:enabled').first().click();
        await page.waitForFunction(() => !window.anaVm.battle);
        assert(battle.finished);
        assert.deepEqual(errors, []);
        success = true;
        console.log(JSON.stringify({ realAnaTeam: true, formsPreserved: true, aceLast: true, aceK: 4, trainerSpeech: true, viewports: 2, errors, output }));
    } finally {
        if (!success && page) await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
        await browser?.close(); cleanup(); await new Promise(resolve => io.close(resolve));
        if (userId) await dbPool.execute('DELETE FROM users WHERE id=?', [userId]);
        await dbPool.end();
    }
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
