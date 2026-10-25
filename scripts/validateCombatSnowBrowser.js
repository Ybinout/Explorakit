// Real encounter on a dedicated database; never touch an existing player's save.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { once } = require('node:events'), { randomUUID } = require('node:crypto');
if (!/test/i.test(process.env.DB_TEST_NAME || '')) throw Error('Dedicated test DB required');
process.env.DB_NAME = process.env.DB_TEST_NAME;
process.env.NODE_ENV = 'test';
const express = require('express'), { Server } = require('socket.io'), { chromium } = require('playwright');
const { dbPool } = require('../server/config/database');
const output = process.env.RELEASE_SCREENSHOTS || '/tmp/explorakit-combat-snow-browser';
const dist = process.env.RELEASE_DIST_DIR || '/tmp/explorakit-combat-snow-dist';
fs.mkdirSync(output, { recursive: true });
const app = express(), server = http.createServer(app), io = new Server(server, { path: '/explorakit/socket.io' });
app.use(express.json());
app.use('/explorakit/api', require('../server/http/routes'));
app.use('/explorakit', express.static(dist));
app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
const cleanup = require('../server/realtime/driftLobbyHandler').registerDriftLobbies(io, { runtimeOptions: { random: () => .9, paceMs: 0 } });
let browser, page, userId, success = false;
const errors = [];
let holdSnow = true; const heldSnow = [];
(async () => {
    try {
        server.listen(0, '127.0.0.1'); await once(server, 'listening');
        const base = `http://127.0.0.1:${server.address().port}/explorakit`;
        const response = await fetch(base + '/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'snow_combat_' + randomUUID(), password: randomUUID(), starterId: 7 }) });
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
            window.snowCombatVm = el.__vue__; return true;
        });
        await page.evaluate(() => { window.snowCombatVm.showMobileControls = true; window.snowCombatVm.updatePreferences({ ...window.snowCombatVm.preferences, masterVolume: 0 }); });
        await page.route('**/img/snow-*.webp', async route => { if (holdSnow) await new Promise(resolve => heldSnow.push(resolve)); await route.continue().catch(() => {}); });
        const player = cleanup.runtime.playerFor({ id: userId });
        const factory = require('../server/game/drift/pokemonFactory');
        const lead = factory.create(460, 45, true), foe = factory.create(19, 40, true);
        lead.passiveAbility = 'Run Away'; lead.abilities = ['Sunny Day','Tackle']; lead.movePp = [5,35];
        lead.currentHp = lead.maxHp = 1000; lead.currentSpeed = 999;
        foe.currentHp = foe.maxHp = 1000; foe.passiveAbility = 'Run Away';
        foe.abilities = ['Tackle']; foe.movePp = [35]; foe.currentAttack = 1;
        player.equipe.pokemons = [lead]; player.currentmap = 'route13'; player.x = 432; player.y = 592;
        cleanup.runtime.enter(fixture.user, { id: player.socketId });
        await page.waitForFunction(() => window.snowCombatVm.map === 'route13');
        const opponent = { npc: true, equipe: { pokemons: [foe] }, drifts: [], equipped: [], chain: 0 };
        const battle = cleanup.runtime.battle(player, opponent, 'wild');
        battle.deadline = Date.now() + 240000;
        await page.locator('[data-battle-entrance][data-phase="holding"]').waitFor();
        await page.waitForTimeout(650); assert(heldSnow.length > 0);
        assert.equal(await page.locator('.battle-scene').evaluate(el => getComputedStyle(el).visibility),'hidden');
        holdSnow = false; heldSnow.splice(0).forEach(resolve => resolve());
        await page.locator('.action-attack:enabled').waitFor();
        assert.deepEqual(battle.state.weather, {kind:'hail',turns:0,persistent:true,source:'map'});
        assert.equal(await page.locator('[data-battle-weather]').getAttribute('aria-label'),'Grêle');
        const probes = [], scenery = [];
        for (const [width,height] of [[320,480],[393,852],[844,390],[1365,900]]) {
            await page.setViewportSize({width,height});
            await page.waitForTimeout(300);
            await page.evaluate(width => { window.snowCombatVm.showMobileControls = width <= 920; }, width);
            await page.waitForFunction(() => {
                const c = document.querySelector('[data-battle-snow]'), r = c?.getBoundingClientRect();
                return c?.__vue__?._snowRenderer?.frames > 0 && Math.abs(c.width - Math.round(r.width * Math.min(1.5,devicePixelRatio || 1))) <= 1;
            });
            // Weather stays in the scene corner; it never consumes the action/announcement slot.
            const icons = await page.evaluate(async () => {
                const b = window.snowCombatVm.$refs.battleOverlay, result = [];
                const buttons = () => { const r = document.querySelector('.battle-main-actions').getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; };
                const before = buttons();
                for (const [kind,label] of [['rain','Pluie'],['sun','Soleil'],['sandstorm','Tempête de sable'],['hail','Grêle']]) {
                    b.updateFieldState({weather:{kind}}); await b.$nextTick();
                    const icon = document.querySelector('[data-battle-weather]'), rect = icon.getBoundingClientRect(), scene = document.querySelector('.battle-scene').getBoundingClientRect(), card = document.querySelector('.battle-status-wild').getBoundingClientRect();
                    result.push({kind,label:icon.getAttribute('aria-label'),title:icon.title,path:icon.querySelector('path').getAttribute('d'),width:rect.width,height:rect.height,top:rect.top-scene.top,right:scene.right-rect.right,overlap:rect.left<card.right&&rect.right>card.left&&rect.top<card.bottom&&rect.bottom>card.top,bottomLabel:!!document.querySelector('.battle-announcements .battle-field-label'),text:icon.textContent.trim(),buttons:buttons()});
                }
                b.updateFieldState({weather:{kind:'rain'},terrain:{kind:'grassy_terrain'}}); await b.$nextTick();
                const terrain = [...document.querySelectorAll('.battle-announcements .battle-field-label')].map(el=>el.textContent.trim());
                b.updateFieldState({weather:{kind:null}}); await b.$nextTick(); const dry = !document.querySelector('[data-battle-weather]');
                b.updateFieldState({weather:{kind:'hail'}}); await b.$nextTick();
                return {before,result,terrain,dry};
            });
            assert.equal(new Set(icons.result.map(i=>i.path)).size,4);
            for (const [i,label] of icons.result.map((item,i)=>[item,['Pluie','Soleil','Tempête de sable','Grêle'][i]])) {
                assert.equal(i.label,label); assert.equal(i.title,label); assert.equal(i.text,''); assert.equal(i.bottomLabel,false); assert.equal(i.overlap,false);
                assert.equal(i.width,34); assert.equal(i.height,34); assert(Math.abs(i.top-10)<1&&Math.abs(i.right-10)<1);
                for (const key of ['x','y','width','height']) assert(Math.abs(i.buttons[key]-icons.before[key])<1);
            }
            assert(icons.dry); assert.deepEqual(icons.terrain,['Champ Herbu']);
            const probe = await page.locator('[data-battle-snow]').evaluate(async c => {
                const v = c.__vue__, renderer = v._snowRenderer, rect = c.getBoundingClientRect();
                const before = renderer.frames, start = performance.now(); await new Promise(resolve => setTimeout(resolve,350));
                return { frames: renderer.frames - before, elapsed: performance.now() - start, stats: renderer.stats,
                    width:c.width,height:c.height,cssWidth:rect.width,cssHeight:rect.height,pointer:getComputedStyle(c).pointerEvents };
            });
            assert(probe.frames > 1 && probe.frames <= Math.ceil(probe.elapsed / (1000/30)) + 1);
            assert(probe.stats.count <= 220 && probe.stats.flakes > 20);
            assert(probe.width <= probe.cssWidth * 1.5 + 1 && probe.height <= probe.cssHeight * 1.5 + 1);
            assert.equal(probe.pointer,'none'); probes.push(probe);
            await page.waitForFunction(() => { const img = document.querySelector('[data-battle-environment="snow"] .battle-background'); return img?.complete && img.naturalWidth > 0; });
            const background = await page.locator('.battle-background').evaluate(img => ({src:img.currentSrc,width:img.naturalWidth,height:img.naturalHeight}));
            const portrait = width <= 920 && width < height;
            assert.match(background.src,portrait ? /snow-mobile-v1/ : /snow-wide-v1/);
            assert.equal(background.width,portrait ? 1024 : 1536); assert.equal(background.height,portrait ? 1536 : 1024);
            const geometry = await page.evaluate(() => {
                const b = window.snowCombatVm.$refs.battleOverlay, scene = document.querySelector('.battle-scene').getBoundingClientRect();
                return ['wild'].map(side => {
                    const el = document.querySelector(`[data-battle-platform="${side}"] .snow-disc`), rect = el.getBoundingClientRect(), foot = b.getSpriteGeometry(side);
                    return {side,center:Math.abs(rect.x + rect.width / 2 - (scene.x + foot.centerX)),foot:scene.y + foot.bottomY,top:rect.top,bottom:rect.bottom,color:getComputedStyle(el).backgroundColor};
                });
            });
            for (const g of geometry) { assert(g.center < 1,JSON.stringify(g)); assert(g.foot >= g.top - 2 && g.foot <= g.bottom + 2,JSON.stringify(g)); assert.equal(g.color,'rgb(237, 247, 255)'); }
            scenery.push({width,portrait,background,platforms:geometry,weatherIcons:true});
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
            await page.screenshot({ path:path.join(output,`snow-${width}.png`) });
        }
        const pixels = await page.evaluate(() => {
            const ctor = document.querySelector('[data-battle-snow]').__vue__._snowRenderer.constructor;
            const r = new ctor(), c = document.createElement('canvas'); c.width = 393; c.height = 590;
            const ctx = c.getContext('2d'), options = {width:393,height:590};
            r.draw(ctx,500,options); const a = ctx.getImageData(0,0,393,590).data;
            r.draw(ctx,1800,options); const b = ctx.getImageData(0,0,393,590).data;
            let changed = 0, visible = 0, opaque = 0;
            for (let i = 3; i < a.length; i += 4) { if (a[i] !== b[i]) changed++; if (b[i]>80) visible++; if(b[i]>240) opaque++; }
            r.destroy(); return {changed,visible,opaque};
        });
        assert(pixels.changed > 500 && pixels.visible > 150);
        await page.emulateMedia({reducedMotion:'reduce'});
        await page.waitForFunction(() => !document.querySelector('[data-battle-snow]').__vue__._snowMotion);
        let frames = await page.locator('[data-battle-snow]').evaluate(c => c.__vue__._snowRenderer.frames);
        await page.waitForTimeout(180);
        assert.equal(await page.locator('[data-battle-snow]').evaluate(c => c.__vue__._snowRenderer.frames),frames);
        assert.equal(await page.locator('[data-battle-snow]').evaluate(c => c.__vue__._snowRenderer.stats.landings),0);
        await page.emulateMedia({reducedMotion:'no-preference'});
        await page.evaluate(() => { window.snowCombatVm.preferences = {...window.snowCombatVm.preferences,animationsEnabled:false}; });
        await page.waitForTimeout(50);
        frames = await page.locator('[data-battle-snow]').evaluate(c => c.__vue__._snowRenderer.frames);
        await page.waitForTimeout(160);
        assert.equal(await page.locator('[data-battle-snow]').evaluate(c => c.__vue__._snowRenderer.frames),frames);
        await page.evaluate(() => { window.snowCombatVm.preferences = {...window.snowCombatVm.preferences,animationsEnabled:true}; });
        await page.locator('[data-battle-snow]').evaluate(c => { window.oldSnowRenderer = c.__vue__._snowRenderer; Object.defineProperty(document,'hidden',{configurable:true,get:()=>true}); document.dispatchEvent(new Event('visibilitychange')); });
        assert.equal(await page.locator('[data-battle-snow]').evaluate(c => c.width),0);
        await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
        await page.waitForFunction(() => document.querySelector('[data-battle-snow]')?.width > 0);
        await page.locator('.action-attack:enabled').click();
        await page.locator('.battle-grid-attacks button:enabled').first().click();
        await page.locator('.battle-scene.weather-sun').waitFor();
        assert.equal(battle.state.weather.kind,'sun');
        // The snowy region stays white under sun; other environments keep priority.
        assert.equal(await page.locator('[data-battle-environment="snow"]').count(),1);
        for (const map of ['route14','ville5']) {
            await page.evaluate(map => { window.snowCombatVm.$refs.battleOverlay.battleMapName = map; },map);
            await page.locator('[data-battle-environment="snow"]').waitFor();
        }
        await page.evaluate(() => { const b = window.snowCombatVm.$refs.battleOverlay; b.battleMapName = 'route11'; b.updateFieldState({weather:{kind:'hail'}}); });
        await page.locator('[data-battle-environment="snow"]').waitFor();
        await page.evaluate(() => { window.snowCombatVm.$refs.battleOverlay.updateFieldState({weather:{kind:null}}); });
        await page.waitForFunction(() => document.querySelector('.battle-background')?.currentSrc.includes('back.'));
        await page.evaluate(() => { const b = window.snowCombatVm.$refs.battleOverlay; b.battleMapName = 'cave_rochebrume3'; b.updateFieldState({weather:{kind:'hail'}}); });
        await page.locator('[data-battle-environment="cave"]').waitFor();
        assert.equal(await page.locator('[data-battle-environment="snow"]').count(),0);
        await page.evaluate(() => { window.snowCombatVm.$refs.battleOverlay.challenge = {wave:1,label:'Test'}; });
        await page.locator('.battle-colosseum').waitFor(); assert.equal(await page.locator('[data-battle-environment="snow"]').count(),0);
        await page.evaluate(() => { const b = window.snowCombatVm.$refs.battleOverlay; b.challenge = null; b.battleMapName = 'route13'; b.updateFieldState({weather:{kind:'sun'}}); });
        await page.locator('[data-battle-environment="snow"]').waitFor();
        assert.equal(await page.locator('[data-battle-snow]').count(),0);
        assert.equal(await page.evaluate(() => window.oldSnowRenderer.destroyed),true);
        assert.equal(await page.evaluate(() => window.oldSnowRenderer.particles.length),0);
        battle.state.weather = {kind:'rain',turns:5}; battle.sync();
        await page.locator('[data-battle-rain]').waitFor();
        assert.equal(await page.locator('[data-battle-snow]').count(),0);
        lead.passiveAbility = 'Snow Warning';
        require('../server/game/battle/battleEngine').applySwitchInEffects(lead,battle.sides[0],battle.sides[1],battle.state,foe);
        assert.deepEqual(battle.state.weather,{kind:'hail',turns:5}); battle.sync();
        await page.locator('[data-battle-snow]').waitFor();
        assert.equal(await page.locator('[data-battle-rain]').count(),0);
        await page.locator('[data-battle-snow]').evaluate(c => { window.lastSnowRenderer = c.__vue__._snowRenderer; });
        await page.locator('.action-flee:enabled').click();
        await page.waitForFunction(() => !window.snowCombatVm.battle);
        assert.equal(await page.evaluate(() => window.lastSnowRenderer.destroyed),true);
        assert.equal(await page.locator('[data-battle-snow]').count(),0);
        assert.deepEqual(errors,[]);
        console.log(JSON.stringify({mapSnowInherited:true,realSnowWarningBattle:true,probes,pixels,scenery,coldSnowAssetHold:true,environmentPriority:true,reducedMotion:true,disabledMotion:true,visibilityRelease:true,weatherReplacement:true,endCleanup:true,errors,output}));
        success = true;
    } finally {
        holdSnow = false; heldSnow.splice(0).forEach(resolve => resolve());
        if (!success && page) await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
        await browser?.close(); cleanup(); await new Promise(resolve => io.close(resolve));
        if (userId) await dbPool.execute('DELETE FROM users WHERE id=?', [userId]);
        await dbPool.end();
    }
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
