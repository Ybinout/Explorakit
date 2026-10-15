// Real HTTP/Socket/SQL journey with an injected server clock, never a production cheat endpoint.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
if (!/test/i.test(process.env.DB_TEST_NAME || '')) throw Error('Base de test dédiée requise.');
process.env.DB_NAME = process.env.DB_TEST_NAME;
process.env.NODE_ENV = 'test';
const express = require('express');
const { Server } = require('socket.io');
const { chromium } = require('playwright');
const { dbPool } = require('../server/config/database');
const repository = require('../server/persistence/colosseumRepository');
const factory = require('../server/game/drift/pokemonFactory');
const { registerDriftLobbies } = require('../server/realtime/driftLobbyHandler');
const output = process.env.RELEASE_SCREENSHOTS || '/tmp/explorakit-six-browser';
fs.mkdirSync(output,{recursive:true});
const dist = process.env.RELEASE_DIST_DIR || '/tmp/explorakit-release-dist';
const app = express(), server = http.createServer(app), io = new Server(server,{path:'/explorakit/socket.io'});
app.use(express.json());app.use('/explorakit/api',require('../server/http/routes'));
app.use('/explorakit',express.static(dist));app.get('*',(_req,res)=>res.sendFile(path.join(dist,'index.html')));
let offset=0;
const cleanup=registerDriftLobbies(io,{colosseumRepository:repository,runtimeOptions:{now:()=>Date.now()+offset,random:()=>.1,paceMs:0}});
let browser,userId,page,success=false;
const errors=[];
async function waitFor(condition,message) { const end=Date.now()+8000;while(!condition()){if(Date.now()>end)throw Error(message);await new Promise(r=>setTimeout(r,40));} }
async function dismissBattle() {
    const button=page.getByRole('button',{name:/Continuer|Reprendre|Retour à l’exploration/}).filter({visible:true});
    await button.first().click();
}
async function checkWidth() { assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Horizontal overflow'); }
(async()=>{
    try{
        server.listen(0,'127.0.0.1');await once(server,'listening');
        const base=`http://127.0.0.1:${server.address().port}/explorakit`;
        const created=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'colobrowser_'+randomUUID(),password:'Browser-colosseum-test',starterId:7})});
        assert(created.ok);const fixture=await created.json();userId=fixture.user.id;
        const [[adventureBefore]]=await dbPool.execute('SELECT p.uuid,p.current_hp,p.experience FROM pokemons p JOIN teams t ON t.id=p.team_id WHERE t.user_id=?',[userId]);
        browser=await chromium.launch({headless:true,args:['--no-sandbox']});
        const context=await browser.newContext({viewport:{width:1365,height:900},hasTouch:true});
        await context.addInitScript(session=>localStorage.setItem('explorakit.user',JSON.stringify(session)),{...fixture.user,token:fixture.token});
        page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
        page.on('response',r=>{if(r.url().startsWith(base)&&r.status()>=400)errors.push(r.status()+' '+r.url());});
        for(const [width,height] of [[1365,900],[393,852],[320,568],[844,390]]){
            await page.setViewportSize({width,height});await page.goto(base+'/',{waitUntil:'networkidle'});
            assert.equal(await page.locator('[data-mode]').count(),3);await checkWidth();
            await page.screenshot({path:path.join(output,`modes-${width}.png`),fullPage:true});
            await page.locator('[data-mode="colosseum"]').click();await page.locator('[data-colosseum-start]:enabled').waitFor();await checkWidth();
            await page.screenshot({path:path.join(output,`colosseum-lobby-${width}.png`),fullPage:true});
        }
        await page.setViewportSize({width:393,height:852});await page.locator('[data-colosseum-format="30"]').click();
        await page.locator('[data-colosseum-start]').click();
        await page.locator('.drift-hud').waitFor();
        const p=cleanup.runtime.playerFor({id:userId});assert(p);assert.equal(p.run.mode,'colosseum');
        assert.equal(p.run.endsAt-p.run.startedAt,1800000);assert.equal(p.equipe.pokemons.length,1);
        const starter=p.equipe.pokemons[0].uuid,ends=p.run.endsAt;
        await page.reload({waitUntil:'networkidle'});await page.locator('.drift-hud').waitFor();
        assert.equal(p.equipe.pokemons[0].uuid,starter);assert.equal(p.run.endsAt,ends);
        // Use actual controls against the test server's expedition inventory.
        const companion = factory.create(7,30);p.equipe.pokemons.push(companion);
        p.equipe.pokemons[0].currentHp = 1;companion.currentHp = 1;
        Object.assign(p.items,{potion:2,oran_berry:1,antidote:1,lum_berry:1});cleanup.runtime.send(p);
        await page.locator('.menu-toggle-btn').click();await page.locator('[data-menu-action="bag"]').click();
        const useBagItem = async (key,uuid) => {
            const row=page.locator(`[data-item-key="${key}"]`);
            await row.locator('select').selectOption(uuid);await row.locator('.bag-use-button').click();
            await page.getByRole('status').filter({hasText:'Soin sauvegardé.'}).waitFor();
        };
        await useBagItem('drift_potion',starter);assert.equal(p.items.drift_potion,2);
        assert.equal(p.equipe.pokemons[0].currentHp,p.equipe.pokemons[0].maxHp);
        assert.equal(companion.currentHp,1,'Healing must affect the selected target');
        await useBagItem('potion',companion.uuid);assert.equal(companion.currentHp,21);assert.equal(p.items.potion,1);
        await useBagItem('oran_berry',companion.uuid);assert.equal(companion.currentHp,31);assert.equal(p.items.oran_berry,0);
        companion.currentHp=companion.maxHp;companion.status='poison';cleanup.runtime.send(p);
        await useBagItem('antidote',companion.uuid);assert.equal(companion.status,'normal');
        assert(await page.locator('[data-item-key="potion"] .bag-use-button').isDisabled());
        for(const [width,height] of [[320,568],[393,852],[844,390]]) {
            await page.setViewportSize({width,height});await checkWidth();
            const size=await page.locator('[data-item-key="potion"] .bag-use-button').boundingBox();assert(size.height>=44);
            await page.screenshot({path:path.join(output,`colosseum-bag-${width}.png`)});
        }
        await page.locator('.bag-panel .panel-close').click();
        // A real capture through the mobile controls must pay the wallet and show the same gain.
        const moneyBeforeCapture = p.money;
        cleanup.runtime.battle(p,{npc:true,equipe:{pokemons:[factory.create(19,5)]},drifts:[],equipped:[]},'wild');
        await page.locator('.action-bag:enabled').click();
        await page.locator('.battle-choice-btn-bag').first().click();
        await page.locator('[data-battle-result] .result-money').waitFor();
        assert.match(await page.locator('[data-battle-result] .result-money').innerText(),/30/);
        assert.equal(p.money,moneyBeforeCapture+30);
        await page.screenshot({path:path.join(output,'colosseum-capture-reward.png')});
        await dismissBattle();
        await page.reload({waitUntil:'networkidle'});await page.locator('.drift-hud').waitFor();
        assert.equal(p.money,moneyBeforeCapture+30,'Reconnecting must not award the capture again');
        p.equipe.pokemons=p.equipe.pokemons.filter(poke=>poke.uuid===starter);cleanup.runtime.send(p);
        await page.setViewportSize({width:393,height:852});
        await page.locator('.drift-hud-toggle').click();await page.locator('[data-drift-tab="tournament"]').click();
        await page.getByText('30 minutes pour tout préparer',{exact:true}).waitFor();
        await page.locator('[data-colosseum-difficulty]').filter({hasText:'Novice'}).waitFor();
        await page.screenshot({path:path.join(output,'colosseum-exploration.png')});
        // Set up a second survivor to verify the irreversible loss in the actual UI.
        p.equipe.pokemons.push(factory.create(9,25));offset+=1800000;cleanup.runtime.tick();
        await page.locator('[data-colosseum-ready]').waitFor();assert.equal(p.currentmap,'ville1_arene');
        await page.screenshot({path:path.join(output,'colosseum-ready-mobile.png')});
        await page.locator('[data-colosseum-ready]').click();await waitFor(()=>Boolean(p.battle),'Battle missing');
        const battle=p.battle,lost=p.equipe.pokemons[0];lost.currentHp=0;battle.prune();
        for(const enemy of battle.b.equipe.pokemons)enemy.currentHp=0;battle.prune();battle.checkEnd();
        await dismissBattle();await page.locator('[data-colosseum-ready]').waitFor();
        assert.equal(p.equipe.pokemons.length,1);assert.equal(p.equipe.pokemons[0].currentHp,p.equipe.pokemons[0].maxHp);
        assert.equal(p.run.colosseum.score,300);await checkWidth();
        await page.screenshot({path:path.join(output,'colosseum-victory-mobile.png')});
        await page.locator('[data-colosseum-ready]').click();await waitFor(()=>Boolean(p.battle),'Second battle missing');
        const finalBattle=p.battle;p.equipe.pokemons[0].currentHp=0;finalBattle.prune();finalBattle.checkEnd();
        await dismissBattle();await page.getByText('Ton passage au Colosseum',{exact:true}).waitFor();
        await p.run.settling;assert.equal(p.run.settlement.status,'complete');
        await page.screenshot({path:path.join(output,'colosseum-results-mobile.png')});
        await page.locator('[data-drift-action="exit"]').click();
        await page.locator('[data-colosseum-ranking-format="30"]').click();await page.locator('[data-colosseum-personal]').waitFor();
        assert.match(await page.locator('[data-colosseum-personal]').innerText(),/300/);
        assert.equal(await page.locator('.rank-list li').count(),1);
        await page.screenshot({path:path.join(output,'colosseum-record-mobile.png'),fullPage:true});
        const [[adventureAfter]]=await dbPool.execute('SELECT p.uuid,p.current_hp,p.experience FROM pokemons p JOIN teams t ON t.id=p.team_id WHERE t.user_id=?',[userId]);
        assert.deepEqual(adventureAfter,adventureBefore);
        await page.locator('[data-colosseum-ranking-format="60"]').click();
        await page.getByText('La première place t’attend.',{exact:true}).waitFor();
        await page.locator('[data-colosseum-format="60"]').click();await page.locator('[data-colosseum-start]').click();
        await page.locator('.drift-hud').waitFor();const classic=cleanup.runtime.playerFor({id:userId});
        assert.equal(classic.run.endsAt-classic.run.startedAt,3600000);
        // Server-side fixture only: exercise the expert threshold through the actual UI.
        await waitFor(()=>Boolean(classic.socketId) && classic.disconnectedAt===null,'Classic run not connected before clock advance');
        classic.run.colosseum.wins=50;offset+=3600000;cleanup.runtime.tick();
        await page.locator('[data-colosseum-difficulty]').filter({hasText:'Expert'}).waitFor();
        await page.setViewportSize({width:320,height:568});await checkWidth();
        await page.screenshot({path:path.join(output,'colosseum-expert-mobile.png')});
        await page.locator('[data-colosseum-ready]').click();await waitFor(()=>Boolean(classic.battle),'Expert battle missing');
        assert.equal(classic.battle.b.colosseumWave,51);
        assert(classic.battle.b.equipe.pokemons.every(p=>p.heldItem==='leftovers'));
        assert(classic.battle.pending.has(classic.battle.b),'The expert commits before the player acts');
        cleanup.runtime.abandon(classic);await classic.run.settling;
        assert.deepEqual(errors,[]);success=true;
        console.log(JSON.stringify({colosseum:true,viewports:4,fixedThirtyMinutes:true,reconnect:true,arena:true,permadeath:true,healing:true,score:300,leaderboard:true,adventureUnchanged:true,errors,output}));
    }finally{
        if(!success&&page){console.error('Browser errors:',errors);await page.screenshot({path:path.join(output,'colosseum-failure.png'),fullPage:true}).catch(()=>{});}
        await browser?.close();cleanup();await new Promise(resolve=>io.close(resolve));
        if(userId)await dbPool.execute('DELETE FROM users WHERE id=?',[userId]);await dbPool.end();
    }
})().catch(e=>{console.error(e);process.exitCode=1;});
