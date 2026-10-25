// Real encounter on a dedicated database; never touch an existing player's save.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { once } = require('node:events'), { randomUUID } = require('node:crypto');
if (!/test/i.test(process.env.DB_TEST_NAME || '')) throw Error('Dedicated test DB required');
process.env.DB_NAME = process.env.DB_TEST_NAME;
process.env.NODE_ENV = 'test';
const express = require('express'), { Server } = require('socket.io'), { chromium } = require('playwright');
const { dbPool } = require('../server/config/database');
const output = process.env.RELEASE_SCREENSHOTS || '/tmp/riftmon-gym-backgrounds-browser';
const dist = process.env.RELEASE_DIST_DIR || '/tmp/riftmon-gym-backgrounds-dist';
fs.mkdirSync(output, { recursive: true });
const prefix = (process.env.RELEASE_PUBLIC_PATH || '/explorakit').replace(/\/$/, '');
const app = express(), server = http.createServer(app), io = new Server(server, { path: prefix + '/socket.io' });
app.use(express.json());
app.use(prefix + '/api', require('../server/http/routes'));
app.use(prefix || '/', express.static(dist));
app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
const cleanup = require('../server/realtime/driftLobbyHandler').registerDriftLobbies(io, { checkpointRepository: {async save(){}}, runtimeOptions: { random: () => .9, paceMs: 0 } });
let browser, page, userId, success = false;
const errors = [];
(async () => {
    try {
        server.listen(0, '127.0.0.1'); await once(server, 'listening');
        const base = `http://127.0.0.1:${server.address().port}${prefix}`;
        const response = await fetch(base + '/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'gyms_' + randomUUID(), password: randomUUID(), starterId: 7 }) });
        assert.equal(response.status, 201);
        const fixture = await response.json(); userId = fixture.user.id;
        browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
        const context = await browser.newContext({ viewport: { width: 393, height: 852 }, hasTouch: process.env.GYM_DESKTOP !== '1', isMobile: process.env.GYM_DESKTOP !== '1' });
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
            window.gymVm = el.__vue__; return true;
        });
        await page.evaluate(() => { window.gymVm.showMobileControls = true; window.gymVm.updatePreferences({ ...window.gymVm.preferences, masterVolume: 0 }); });
        const player = cleanup.runtime.playerFor({ id: userId });
        const cases=[['ville_safe1_arene','hoze','hoze'],['ville3_arene','ana','ana'],['ville4_arene','wanda','wanda'],['ville5_arene','sevenp','7p']];
        const report=[];
        for(const [map,team,key]of cases){
            const lead=require('../server/game/drift/pokemonFactory').create(9,100,true);lead.maxHp=lead.currentHp=5000;
            player.equipe.pokemons=[lead];player.currentmap=map;player.x=432;player.y=208;
            cleanup.runtime.enter(fixture.user,{id:player.socketId});
            await page.waitForFunction(map=>window.gymVm.map===map,map);
            const battle=cleanup.runtime.battle(player,{npc:true,equipe:require('../server/game/world/pnjTeamFactory').getPnjTeam(team),drifts:[],equipped:[],chain:0},'arena','champion_'+team);
            battle.deadline=Date.now()+240000;
            await page.locator('[data-arena-intro]').waitFor();
            await page.locator('.action-attack:enabled').waitFor();
            for(const [width,height]of [[320,568],[393,852],[844,390],[1365,900]]){
                await page.setViewportSize({width,height});await page.waitForTimeout(250);
                await page.evaluate(async width=>{window.gymVm.showMobileControls=width<1000;await window.gymVm.$nextTick();},width);
                const background=page.locator(`[data-battle-environment="${key}-gym"] .battle-background`);
                await background.evaluate(el=>el.decode());
                const src=await background.evaluate(el=>({url:el.currentSrc,w:el.naturalWidth,h:el.naturalHeight}));
                const portrait=width<height&&width<1000;
                assert(src.url.includes(key+(portrait?'-mobile-v1':'-wide-v1')),src.url);
                assert.equal(src.w,portrait?1024:1536);assert.equal(src.h,portrait?1536:1024);
                const geometry=await page.evaluate(()=>{
                    const b=window.gymVm.$refs.battleOverlay,scene=document.querySelector('.battle-scene').getBoundingClientRect();
                    return ['wild'].map(side=>{
                        const platform=document.querySelector(`[data-battle-platform="${side}"]`),disc=platform.querySelector('.gym-disc').getBoundingClientRect(),sprite=b.getSpriteGeometry(side),anchor=platform.getBoundingClientRect();
                        return {side,anchorX:anchor.x,anchorY:anchor.y,x:scene.x+sprite.centerX,y:scene.y+sprite.bottomY,disc:{top:disc.top,bottom:disc.bottom,left:disc.left,right:disc.right}};
                    });
                });
                for(const g of geometry){assert(Math.abs(g.x-g.anchorX)<1,JSON.stringify(g));assert(Math.abs(g.y-g.anchorY)<1,JSON.stringify(g));assert(g.y>=g.disc.top-1&&g.y<=g.disc.bottom+2,JSON.stringify(g));}
                assert.equal(await page.locator('.gym-disc').count(),1);
                assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
                await page.screenshot({path:path.join(output,`${key}-gym-${width}.png`)});
            }
            for(const weather of ['rain','hail','sandstorm',null]){
                await page.evaluate(weather=>window.gymVm.$refs.battleOverlay.updateFieldState({weather}),weather);
                assert.equal(await page.locator(`[data-battle-environment="${key}-gym"]`).count(),1);
            }
            await page.evaluate(()=>window.gymVm.$refs.battleOverlay.challenge={wave:1,label:'Test'});
            await page.locator('.battle-colosseum').waitFor();assert.equal(await page.locator('.gym-disc').count(),0);
            await page.evaluate(()=>window.gymVm.$refs.battleOverlay.challenge=null);
            battle.finish(null,'fled');await page.locator('[data-battle-result-continue]').click();await page.locator('.battle-scene').waitFor({state:'hidden'});
            report.push({champion:key,viewports:4,groundContact:true,portraitAndLandscape:true,weatherPreservesInterior:true,colosseumPriority:true});
        }
        assert.deepEqual(errors,[]);success=true;console.log(JSON.stringify({report,realArenaEncounters:true,errors,output}));
    } finally {
        if (!success && page) await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
        await browser?.close(); cleanup(); await new Promise(resolve => io.close(resolve));
        if (userId) await dbPool.execute('DELETE FROM users WHERE id=?', [userId]);
        await dbPool.end();
    }
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
