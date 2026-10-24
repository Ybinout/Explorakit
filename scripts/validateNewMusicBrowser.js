// Real encounter on a dedicated database; never touch an existing player's save.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { once } = require('node:events'), { randomUUID } = require('node:crypto');
if (!/test/i.test(process.env.DB_TEST_NAME || '')) throw Error('Dedicated test DB required');
process.env.DB_NAME = process.env.DB_TEST_NAME;
process.env.NODE_ENV = 'test';
const express = require('express'), { Server } = require('socket.io'), { chromium } = require('playwright');
const { dbPool } = require('../server/config/database');
const output = process.env.RELEASE_SCREENSHOTS || '/tmp/riftmon-new-music-browser';
const dist = process.env.RELEASE_DIST_DIR || '/tmp/riftmon-new-music-dist';
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
            body: JSON.stringify({ username: 'newmusic_' + randomUUID(), password: randomUUID(), starterId: 7 }) });
        assert.equal(response.status, 201);
        const fixture = await response.json(); userId = fixture.user.id;
        browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
        const context = await browser.newContext({ viewport: { width: 393, height: 852 }, hasTouch: process.env.MUSIC_DESKTOP !== '1', isMobile: process.env.MUSIC_DESKTOP !== '1' });
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
            window.musicVm = el.__vue__; return true;
        });
        await page.evaluate(() => { window.musicVm.showMobileControls = true; window.musicVm.updatePreferences({ ...window.musicVm.preferences, masterVolume: 0 }); });
        const player=cleanup.runtime.playerFor({id:userId}),results=[];
        await page.evaluate(()=>window.musicVm.updatePreferences({...window.musicVm.preferences,masterVolume:35}));
        await page.keyboard.press('Shift');
        async function locate(map){
            const repo=require('../server/game/world/mapRepository'),c=repo.loadCollisionData(map),changes=repo.changeMapData(map);
            let point;for(let y=1;y<c.length-1&&!point;y++)for(let x=1;x<c[y].length-1;x++)if(c[y][x]===0&&!changes[y]?.[x]){point=[x,y];break;}
            assert(point,map);Object.assign(player,{currentmap:map,x:point[0]*32+16,y:point[1]*32+16});cleanup.runtime.enter(fixture.user,{id:player.socketId});
            await page.waitForFunction(map=>{const v=window.musicVm;return v.map===map&&!v.mapLoading&&v.renderedMap===map;},map);
        }
        async function playing(key){
            await page.waitForFunction(key=>{const a=window.musicVm._worldMusic.tracks.get(key);return a&&!a.paused&&a.readyState>=2&&a.currentTime>.1;},key);
            return page.evaluate(key=>{const a=window.musicVm._worldMusic.tracks.get(key);return {key,src:a.src,time:a.currentTime,volume:a.volume,duration:a.duration};},key);
        }
        await locate('cave1');const cave=await playing('cave');assert.match(cave.src,/cave\.[a-f0-9]+\.mp3/);assert(cave.duration>20);assert(Math.abs(cave.volume-.077)<1e-8);
        await page.evaluate(()=>{window.savedCave=window.musicVm._worldMusic.tracks.get('cave');window.savedCave.currentTime=18;});
        for(const map of ['cave2','cave_rochebrume1','cave_rochebrume3']){await locate(map);const now=await playing('cave');assert(now.time>=cave.time);assert(await page.evaluate(()=>window.savedCave===window.musicVm._worldMusic.tracks.get('cave')));}
        await locate('ville5');const snow=await playing('snow');assert.match(snow.src,/snow\.[a-f0-9]+\.mp3/);assert(snow.duration>20);assert(await page.evaluate(()=>window.savedCave.paused));
        await page.evaluate(()=>window.savedSnow=window.musicVm._worldMusic.tracks.get('snow'));
        for(const map of ['route13','route14','ville5','ville5_shop']){await locate(map);assert((await playing('snow')).time>=snow.time);}assert(await page.evaluate(()=>window.savedSnow===window.musicVm._worldMusic.tracks.get('snow')));
        await page.evaluate(()=>window.musicVm.updatePreferences({...window.musicVm.preferences,masterVolume:0}));await page.waitForFunction(()=>window.savedSnow.paused);
        await page.evaluate(()=>window.musicVm.updatePreferences({...window.musicVm.preferences,masterVolume:35}));await playing('snow');
        await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});assert(await page.evaluate(()=>window.savedSnow.paused));
        await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});await playing('snow');
        // Real HTMLAudioElement seeks: only a change of theme resets the playhead.
        for(const [map,key,away,same]of [['ville3_arene','ana-room','ville3','ville3_arene'],['ville1','village','route1','ville1_shop'],['route1','route','ville1','route2'],['gen_arene5','raph-room','gen_ville5','gen_arene5'],['route13','snow','cave1','route14']]){
            await locate(map);await playing(key);
            await page.evaluate(key=>{window.restartAudio=window.musicVm._worldMusic.tracks.get(key);window.restartAudio.currentTime=18;},key);
            await page.waitForFunction(()=>!window.restartAudio.seeking&&window.restartAudio.currentTime>=18);
            await locate(same);assert((await playing(key)).time>=18,'same theme must continue');
            await locate(away);assert(await page.evaluate(()=>window.restartAudio.paused));
            await locate(map);assert((await playing(key)).time<3,'different theme must restart');
            assert(await page.evaluate(key=>window.restartAudio===window.musicVm._worldMusic.tracks.get(key),key));
        }
        results.push(cave,snow);
        const cases=[['ville3_arene','ana','ana'],['ville4_arene','wanda','wanda'],['ville5_arene','sevenp','7p'],['gen_arene5','raphael','raph'],['ville_safe1_arene','hoze','arena']];
        for(const [map,team,key]of cases){
            await locate(map);const world=map==='ville3_arene'?'ana-room':map==='ville5_arene'?'sevenp-room':map==='ville4_arene'?'wanda-room':map==='gen_arene5'?'raph-room':'village';const room=await playing(world);if(world.endsWith('-room')){assert(room.src.includes(map==='ville3_arene'?'ana_arene.':map==='ville5_arene'?'arene7p.':map==='gen_arene5'?'areneraph.':'areneWanda.'));assert(room.duration>20);}
            await page.evaluate(world=>window.beforeBattleWorld=window.musicVm._worldMusic.tracks.get(world),world);
            const lead=require('../server/game/drift/pokemonFactory').create(9,100,true);lead.maxHp=lead.currentHp=5000;player.equipe.pokemons=[lead];
            const battle=cleanup.runtime.battle(player,{npc:true,equipe:require('../server/game/world/pnjTeamFactory').getPnjTeam(team),drifts:[],equipped:[],chain:0},'arena','champion_'+team);battle.deadline=Date.now()+240000;
            await page.locator('.action-attack:enabled').waitFor();await page.keyboard.press('Shift');
            await page.waitForFunction(key=>{const b=window.musicVm.$refs.battleOverlay;return b.musicKind===key&&b.music.readyState>=2&&!b.music.paused&&b.music.currentTime>.1;},key);
            assert(await page.evaluate(()=>window.beforeBattleWorld.paused));
            const audio=await page.evaluate(()=>{const b=window.musicVm.$refs.battleOverlay;window.keptBattleMusic=b.music;return {key:b.musicKind,src:b.music.src,time:b.music.currentTime,duration:b.music.duration,loop:b.music.loop,volume:b.music.volume};});
            assert(audio.duration>20);assert(audio.loop);assert(Math.abs(audio.volume-.14)<1e-8);
            assert(audio.src.includes('/'+(key==='arena'?'arene':key)+'.'));
            battle.sync();await page.waitForTimeout(350);assert(await page.evaluate(()=>{const b=window.musicVm.$refs.battleOverlay;return b.music===window.keptBattleMusic&&!b.music.paused;}));
            assert((await page.evaluate(()=>window.keptBattleMusic.currentTime))>=audio.time);
            battle.finish(null,'fled');await page.locator('[data-battle-result-continue]').waitFor();assert(await page.evaluate(()=>window.beforeBattleWorld.paused));await page.locator('[data-battle-result-continue]').click();await playing(world);
            assert(await page.evaluate(()=>window.musicVm.$refs.battleOverlay.music===null));results.push(audio);
        }
        await locate('cave1');const restored=await playing('cave');assert(restored.time<3);assert(await page.evaluate(()=>window.savedCave===window.musicVm._worldMusic.tracks.get('cave')));
        assert.deepEqual(errors,[]);success=true;console.log(JSON.stringify({results,caveContinuity:true,reentryRestarts:true,snowRoutesCityAndShop:true,arenaRoomTracks:true,realArenaMusic:true,syncDoesNotRestart:true,noBattleOverlap:true,resumeWorld:true,volumeAndVisibility:true,errors}));
    } finally {
        if (!success && page) await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
        await browser?.close(); cleanup(); await new Promise(resolve => io.close(resolve));
        if (userId) await dbPool.execute('DELETE FROM users WHERE id=?', [userId]);
        await dbPool.end();
    }
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
