// Controlled fixtures run exclusively on the dedicated test DB and ephemeral HTTP server.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(!/test/i.test(process.env.DB_TEST_NAME||''))throw Error('Dedicated test database required.');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';
const express=require('express'),{Server}=require('socket.io'),{chromium}=require('playwright');
const {dbPool}=require('../server/config/database'),factory=require('../server/game/drift/pokemonFactory');
const {registerDriftLobbies}=require('../server/realtime/driftLobbyHandler');
const output=process.env.RELEASE_SCREENSHOTS||'/tmp/explorakit-combat-browser',dist=process.env.RELEASE_DIST_DIR||'/tmp/explorakit-release-dist';fs.mkdirSync(output,{recursive:true});
const prefix=(process.env.RELEASE_PUBLIC_PATH||'/explorakit').replace(/\/$/,'');
const app=express(),server=http.createServer(app),io=new Server(server,{path:prefix+'/socket.io'});app.use(express.json());app.use(prefix+'/api',require('../server/http/routes'));app.use(prefix||'/',express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));
let checkpoint;const cleanup=registerDriftLobbies(io,{checkpointRepository:{async save(bytes){checkpoint=bytes;}},runtimeOptions:{random:()=>.9,paceMs:0}});
let browser,page,userId,success=false;const errors=[];
function mon(id,level=20){const m=factory.create(id,level,true);m.passiveAbility=null;m.abilities=['Tackle'];m.movePp=[35];return m;}
async function request(name,data){return page.evaluate(({name,data})=>new Promise(resolve=>window.combatVm.socket.timeout(5000).emit(name,data,(error,result)=>resolve(error?{success:false}:result))),{name,data});}
async function vm(){await page.evaluate(()=>{let e=document.querySelector('.game-stage');while(e&&!e.__vue__)e=e.parentElement;window.combatVm=e.__vue__;window.combatTransitions=[];window.combatObserver?.disconnect();window.combatObserver=new MutationObserver(()=>{for(const el of document.querySelectorAll('.battle-sprite-anchor'))for(const kind of ['recall','faint','enter'])if(el.classList.contains('battle-transition-'+kind)){const label=document.querySelector('[data-battle-transition]')?.textContent||'';if(!window.combatTransitions.some(v=>v.kind===kind&&v.label===label))window.combatTransitions.push({kind,label});}});window.combatObserver.observe(document.body,{subtree:true,attributes:true,childList:true,characterData:true});});}
async function closeResult(){await page.locator('[data-battle-result-continue]').click();if(await page.locator('.learning-sheet').isVisible())await page.getByRole('button',{name:'Plus tard',exact:true}).click();await page.locator('.battle-scene').waitFor({state:'hidden'});}
async function openPanel(){await page.locator('.drift-hud-toggle').evaluate(el=>{if(el.getAttribute('aria-expanded')!=='true')el.click();});await page.locator('.run-panel').waitFor();}
async function closePanel(){await page.getByRole('button',{name:'Fermer le carnet Drift',exact:true}).click();}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}${prefix}`;
 const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'combat_'+randomUUID(),password:randomUUID(),starterId:7})});assert(r.ok);const fixture=await r.json();userId=fixture.user.id;
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true});
 await context.addInitScript(s=>localStorage.setItem('explorakit.user',JSON.stringify(s)),{...fixture.user,token:fixture.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().startsWith(base)&&r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
 await page.goto(base+'/colosseum',{waitUntil:'networkidle'});assert.match(await page.locator('.start-card').innerText(),/×3,456/);await page.locator('[data-colosseum-start]:enabled').click();await page.locator('[data-starter-choice]').first().click();await page.locator('.starter-backdrop').waitFor({state:'hidden'});await vm();
 const p=cleanup.runtime.playerFor({id:userId});p.equipe.pokemons=[mon(7),mon(4),mon(25)];p.run.phase='colosseum_ready';p.run.colosseum.wave=0;p.run.colosseum.next=require('../server/game/drift/colosseum').waveInfo(1);cleanup.runtime.send(p);
 await openPanel();await page.locator('[data-drift-tab="team"]').click();const before=p.equipe.pokemons.map(x=>x.uuid);
 for(const [w,h]of [[320,568],[393,852],[844,390],[1365,900]]){await page.setViewportSize({width:w,height:h});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));const button=page.locator('[data-team-position="1"] [data-team-order="up"]');await button.scrollIntoViewIfNeeded();assert((await button.boundingBox()).height>=44);await page.screenshot({path:path.join(output,`team-order-${w}.png`)});}
 await page.locator('[data-team-position="1"] [data-team-order="up"]').click();await page.waitForFunction(()=>window.combatVm.driftState.team[0].data.id===4);assert.deepEqual(p.equipe.pokemons.map(x=>x.uuid),[before[1],before[0],before[2]]);
 assert.equal((await request('drift:reorder',{orderedUuids:[before[0],before[0],before[2]]})).success,false);await closePanel();await page.reload({waitUntil:'networkidle'});await vm();assert.equal(p.equipe.pokemons[0].uuid,before[1]);
 await page.setViewportSize({width:393,height:852});
 await page.evaluate(()=>{window.combatVm.updatePreferences({...window.combatVm.preferences,themeColor:'lavender',themeMode:'dark'});window.combatVm.openDriftTeam();});
 await page.locator('.team-panel').waitFor();assert.equal(await page.locator('.team-save-btn').count(),0);
 await page.locator('.team-row').first().getByRole('button',{name:/Descendre/}).click();await page.waitForFunction(()=>window.combatVm.driftState.team[0].data.id===7);assert.equal(p.equipe.pokemons[0].data.id,7);
 await page.locator('.team-row').nth(1).getByRole('button',{name:/Monter/}).click();await page.waitForFunction(()=>window.combatVm.driftState.team[0].data.id===4);assert.equal(p.equipe.pokemons[0].data.id,4);
 assert.equal(await page.locator('.team-panel').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(40, 34, 53)');await page.screenshot({path:path.join(output,'colosseum-team-night-393.png')});await page.locator('.team-close').click();
 await openPanel();assert.equal(await page.locator('.run-panel').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(40, 34, 53)');assert.equal(await page.locator('[data-colosseum-strategy]').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(59, 51, 78)');await page.screenshot({path:path.join(output,'colosseum-journal-night-393.png')});await closePanel();
 await page.evaluate(()=>window.combatVm.updatePreferences({...window.combatVm.preferences,themeColor:'blue',themeMode:'light'}));
 // Fractional family strength, equipped deletion confirmation and persisted ownership checks.
 p.drifts=[{uuid:'power',definitionId:'DRF-002',rarity:'rare'},{uuid:'minor',definitionId:'DRF-002',rarity:'common'}];p.equipped=['power'];require('../server/game/drift/fusion').consolidate(p);cleanup.runtime.send(p);
 await openPanel();await page.locator('[data-drift-tab="drifts"]').click();const card=page.locator('[data-drift-id="power"]');assert.equal(await page.locator('[data-drift-id]').count(),1);assert.match(await card.innerText(),/3 \/ 4 essences/);
 const recap=page.locator('[data-drift-recap]');assert.match(await recap.innerText(),/Perce-armure/);assert.match(await recap.innerText(),/12,?\.?5%/);assert.equal(await recap.locator('[data-passive-id]').count(),1);
 for(const width of [320,393]) {
  await page.setViewportSize({width,height:852});await recap.scrollIntoViewIfNeeded();
  const bounds=await recap.boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=width+1);
  assert(await recap.locator('[data-passive-id="DRF-002"]').isVisible());
  await page.screenshot({path:path.join(output,`passives-fused-${width}.png`)});
 }
 await card.locator('[data-drift-action="discard"]').click();assert.match(await page.locator('[role="alertdialog"]').innerText(),/bonus équipé sera aussi retiré/);await page.locator('[data-drift-action="cancel"]').click();assert.equal(p.drifts.length,1);
 await card.locator('[data-drift-action="discard"]').click();await page.locator('[data-drift-action="confirm"]').click();await page.waitForFunction(()=>window.combatVm.driftState.drifts.length===0);assert.deepEqual(p.equipped,[]);await closePanel();
 p.drifts=[{uuid:'pierce',definitionId:'DRF-002',rarity:'mythic'},{uuid:'drain',definitionId:'DRF-005',rarity:'mythic'}];p.equipped=p.drifts.map(d=>d.uuid);p.equipe.pokemons[0].currentHp-=10;p.run.phase='colosseum_battle';p.run.colosseum.wave=1;
 await page.setViewportSize({width:393,height:852});const enemy={npc:true,equipe:{pokemons:[mon(19,25)]},drifts:[],equipped:[]};enemy.equipe.pokemons[0].abilities=['Growl'];enemy.equipe.pokemons[0].movePp=[40];
 const battleOrder=p.equipe.pokemons.map(x=>x.uuid);
 const battle=cleanup.runtime.battle(p,enemy,'arena','colosseum_1');await page.locator('.battle-scene').waitFor();
 await page.locator('[data-battle-effort-yield]').waitFor();const effortPreview=await require('./validateBattleEffortUi').validateBattleEffortUi(page,output);
 await page.locator('.action-attack:enabled').click();await page.locator('.battle-grid-attacks .battle-choice-btn:enabled').first().click();
 await page.locator('[data-battle-drift-effects]').waitFor();assert.match(await page.locator('[data-battle-drift-effects]').innerText(),/Perce-armure|Vampirisme/);await page.screenshot({path:path.join(output,'drift-trigger-mobile.png')});
 await page.waitForFunction(()=>{const b=window.combatVm.$refs.battleOverlay;return b.musicKind==='colosseum'&&b.music.readyState>=2&&!b.music.paused&&b.music.currentTime>0;});
 await page.locator('.battle-status-player .battle-conditions').waitFor();assert.match(await page.locator('.battle-status-player .battle-conditions').innerText(),/ATQ -1/);
 await page.locator('.action-pokemon:enabled').click();await page.locator('.battle-pokemon-choice:enabled').first().click();
 await page.locator('.battle-transition-recall').waitFor();assert.match(await page.locator('[data-battle-transition]').innerText(),/rappelé/);await page.screenshot({path:path.join(output,'recall-mobile.png')});
 await page.waitForFunction(()=>window.combatTransitions.some(e=>e.kind==='enter'&&e.label.includes('entre en combat')));await page.locator('.action-attack:enabled').waitFor();
 await page.evaluate(()=>{window.combatTransitions=[];});const fallen=p.equipe.pokemons[0].uuid;p.equipe.pokemons[0].currentHp=1;
 const foe=enemy.equipe.pokemons[0];foe.abilities=['Tackle'];foe.movePp=[35];foe.currentAttack=999;foe.currentSpeed=999;
 await page.locator('.action-attack:enabled').click();await page.locator('.battle-grid-attacks .battle-choice-btn:enabled').first().click();
 await page.locator('.battle-transition-faint').waitFor();assert.match(await page.locator('[data-battle-transition]').innerText(),/K.O./);await page.screenshot({path:path.join(output,'faint-mobile.png')});
 await page.locator('[data-replacement-choice="true"] .battle-pokemon-choice:enabled').first().waitFor();
 assert.deepEqual(await page.locator('.battle-pokemon-choice').evaluateAll(els=>els.map(el=>el.dataset.partyUuid)),battleOrder);
 assert.equal(battle.active(0).uuid,fallen);assert(battle.replacementPhase);const choice=p.equipe.pokemons[2].uuid;
 for(const [width,height]of [[320,480],[393,852],[844,390],[1365,900]]){
  await page.setViewportSize({width,height});await page.evaluate(width=>{window.combatVm.showMobileControls=width<=920;},width);
  for(const action of ['attack','bag','flee'])assert(await page.locator('.action-'+action).isDisabled());
  assert.equal(await page.locator('.battle-pokemon-choice:enabled').count(),2);
  assert(await page.locator('.battle-turn-indicator').isVisible());assert.match(await page.locator('.battle-turn-indicator').innerText(),/Choisis ton prochain Pokémon/);
  for(const button of await page.locator('.battle-pokemon-choice:enabled').all()){
   await button.scrollIntoViewIfNeeded();const bounds=await button.boundingBox();assert(bounds.height>=44&&bounds.x>=0&&bounds.x+bounds.width<=width+1&&bounds.y>=0&&bounds.y+bounds.height<=height+1);
  }
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:path.join(output,`replacement-${width}.png`)});
 }
 await page.setViewportSize({width:393,height:852});await page.locator('.battle-pokemon-choice:enabled').last().click();
 await page.waitForFunction(()=>window.combatTransitions.some(e=>e.kind==='enter'));assert(!p.equipe.pokemons.some(x=>x.uuid===fallen));assert.equal(battle.active(0).uuid,choice);
 const rejected=await request('drift:reorder',{orderedUuids:p.equipe.pokemons.map(x=>x.uuid).reverse()});assert.equal(rejected.success,false);
 await page.locator('.action-attack:enabled').waitFor();enemy.equipe.pokemons[0].currentHp=0;battle.prune();battle.checkEnd();await page.locator('.battle-transition-faint').waitFor();assert.equal(await page.locator('[data-battle-result-continue]').isVisible(),false);await page.locator('[data-battle-result-continue]').waitFor();assert.match(await page.locator('.result-kicker').textContent(),/Colosseum/);assert.equal(await page.locator('.result-timer').count(),0);assert.equal(await page.locator('[data-battle-result]').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(237, 245, 252)');await page.screenshot({path:path.join(output,'colosseum-result-mobile.png')});await closeResult();
 assert.deepEqual(p.equipe.pokemons.map(x=>x.uuid),battleOrder.filter(id=>id!==fallen));
 // Shared music selector uses the real assets for wild/trainer/arena and stops on result.
 p.run.phase='exploration';p.run.endsAt=Date.now()+60000;
 for(const kind of ['wild','trainer']){const e={npc:true,equipe:{pokemons:[mon(19)]},drifts:[],equipped:[]};const b=cleanup.runtime.battle(p,e,kind);await page.locator('.battle-scene').waitFor();await page.locator('.action-pokemon:enabled').click();await page.waitForFunction(kind=>{const b=window.combatVm.$refs.battleOverlay;return b.musicKind===kind&&b.music.readyState>=2&&!b.music.paused;},kind);b.finish(null,'fled');await page.locator('[data-battle-result-continue]').waitFor();await closeResult();}
 const timeline=await require('./validateBattleTimeline').validateBattleTimeline(page,output);
 const entrance=await require('./validateBattleEntranceUi').validateBattleEntranceUi(page,output);
 await page.reload({waitUntil:'networkidle'});await vm();const saved=require('../server/game/drift/checkpointCodec').decode(checkpoint).runs.get(p.run.id).players.get(userId);assert.deepEqual(saved.equipe.pokemons.map(x=>x.uuid),p.equipe.pokemons.map(x=>x.uuid));assert(!saved.drifts.some(d=>d.uuid==='power'));
 assert.deepEqual(errors,[]);success=true;console.log(JSON.stringify({effortPreview,timeline,entrance,automaticMenuOrder:true,nightJournal:true,teamOrder:true,equippedDeletion:true,mixedFusion:true,realDriftSignals:true,recallAndFaintDistinct:true,replacement:{chosenReserve:true,automaticPanel:true,viewports:4,realKO:true},resultAfterKO:true,musicPlayback:true,checkpoint:true,viewports:4,errors,output}));
}finally{if(!success&&page)await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});await browser?.close();cleanup();await new Promise(r=>io.close(r));if(userId)await dbPool.execute('DELETE FROM users WHERE id=?',[userId]);await dbPool.end();}})().catch(e=>{console.error(e);process.exitCode=1});
