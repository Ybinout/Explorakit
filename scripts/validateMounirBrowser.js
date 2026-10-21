// Dedicated test DB only: exercise the real trainer plan and the shared battle UI.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(!/test/i.test(process.env.DB_TEST_NAME||''))throw Error('Dedicated test DB required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';
const express=require('express'),{Server}=require('socket.io'),{chromium}=require('playwright');
const {dbPool}=require('../server/config/database'),factory=require('../server/game/drift/pokemonFactory');
const {getPnjTeam}=require('../server/game/world/pnjTeamFactory');
const output=process.env.RELEASE_SCREENSHOTS||'/tmp/explorakit-mounir-browser',dist=process.env.RELEASE_DIST_DIR||'/tmp/explorakit-mounir-dist';fs.mkdirSync(output,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server,{path:'/explorakit/socket.io'});app.use(express.json());app.use('/explorakit/api',require('../server/http/routes'));app.use('/explorakit',express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));
const cleanup=require('../server/realtime/driftLobbyHandler').registerDriftLobbies(io,{runtimeOptions:{random:()=>.9,paceMs:0}});
let browser,page,userId,success=false;const errors=[];let holdArt=true;const heldArt=[];
async function ready(){await page.waitForFunction(()=>{let e=document.querySelector('.game-stage');while(e&&!e.__vue__)e=e.parentElement;if(!e?.__vue__?.socket?.connected)return false;window.mounirVm=e.__vue__;return true;});}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}/explorakit`;
 const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'mounir_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(r.status,201);const fixture=await r.json();userId=fixture.user.id;
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true});await context.addInitScript(s=>localStorage.setItem('explorakit.user',JSON.stringify(s)),{...fixture.user,token:fixture.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().startsWith(base)&&r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
 await page.goto(base+'/colosseum',{waitUntil:'networkidle'});await page.locator('[data-colosseum-start]:enabled').click();await page.locator('[data-starter-choice]').first().click();await page.locator('.starter-backdrop').waitFor({state:'hidden'});await ready();
 await page.evaluate(()=>{window.mounirVm.showMobileControls=true;window.mounirVm.updatePreferences({...window.mounirVm.preferences,masterVolume:0});window.mounirTrace=[];new MutationObserver(()=>{for(const el of document.querySelectorAll('[data-battle-send-out]'))window.mounirTrace.push({kind:'ball',side:el.dataset.side});if(document.querySelector('[data-trainer-speech]'))window.mounirTrace.push({kind:'speech'});}).observe(document.body,{attributes:true,subtree:true,childList:true});});
 const p=cleanup.runtime.playerFor({id:userId}),lead=factory.create(9,90,true);lead.abilities=['Tackle'];lead.movePp=[35];p.equipe.pokemons=[lead];p.currentmap='ville1_arene';p.x=432;p.y=208;cleanup.runtime.enter(fixture.user,{id:p.socketId});
 await page.waitForFunction(()=>window.mounirVm.map==='ville1_arene');
 await page.route('**/img/mounir-*.webp',async route=>{if(holdArt)await new Promise(resolve=>heldArt.push(resolve));await route.continue().catch(()=>{});});
 const opponent={npc:true,equipe:getPnjTeam('moonpunch'),drifts:[],equipped:[],chain:0};
 const battle=cleanup.runtime.battle(p,opponent,'arena','moon');battle.deadline=Date.now()+120000;
 await page.locator('[data-battle-entrance][data-phase="holding"]').waitFor();await page.waitForTimeout(650);assert(heldArt.length>=2);assert.equal(await page.locator('.battle-scene').evaluate(el=>getComputedStyle(el).visibility),'hidden');assert(await page.locator('.action-attack').isDisabled());holdArt=false;heldArt.splice(0).forEach(resolve=>resolve());
 await page.locator('[data-battle-send-out]').first().waitFor();await page.screenshot({path:path.join(output,'opening-ball-mobile.png')});await page.locator('.action-attack:enabled').waitFor();assert.equal(battle.state.weather.kind,'rain');
 let turns=0;
 while(battle.active(1).data.id!==351&&turns++<12){await page.locator('.action-attack:enabled').click();await page.locator('.battle-grid-attacks button:enabled').first().click();battle.deadline=Date.now()+120000;if(battle.active(1).data.id!==351)await page.locator('.action-attack:enabled').waitFor();}
 assert.equal(battle.active(1).data.id,351);assert.equal(battle.active(1).__battle.formSpriteId,10014);
 await page.locator('[data-trainer-speech]').waitFor();await page.waitForTimeout(5100);assert.equal(await page.locator('[data-trainer-speech]').count(),1);assert.match(await page.locator('[data-trainer-speech]').innerText(),/Mounir.*Morphéo/s);await page.screenshot({path:path.join(output,'morpheo-real-entry-mobile.png')});
 await page.locator('.action-attack:enabled').waitFor();assert.equal(await page.locator('.battle-sprite-wild img').getAttribute('src'),'/explorakit/img/pokemon/front/10014.png');
 battle.deadline=Date.now()+240000;
 const arenaArt=await require('./validateMounirArenaUi').validateMounirArenaUi(page,output);
 // Replays must not trigger the fixture's real timeout attack.
 const payload=await page.evaluate(()=>{const b=window.mounirVm.$refs.battleOverlay;return {player:b.player,wildPokemon:b.opponent,transitions:[{kind:'enter',side:'opponent',uuid:b.opponent.uuid,name:'Morphéo',trainerSpeech:{name:'Mounir',text:'Tu as tenu jusque-là… Morphéo, à toi ! Sous cette pluie, montre-lui de quoi tu es capable !'}}]};});
 // Replay the real, owner-visible frame at four sizes to inspect a brief animation
 // without relying on screenshot speed or changing server gameplay.
 for(const [width,height]of [[320,480],[393,852],[844,390],[1365,900]]){
  await page.setViewportSize({width,height});await page.waitForTimeout(300);
  await page.evaluate(async width=>{window.mounirVm.showMobileControls=width<=920;await window.mounirVm.$nextTick();},width);
  const before=await page.locator('.action-attack').boundingBox();
  await page.evaluate(payload=>{const b=window.mounirVm.$refs.battleOverlay;b.presentEvent('updateBattleState',payload);b.presentEvent('playMoveAnimation',{actor:'opponent',moveName:'Weather Ball',moveType:'Water',damageClass:'special'});},payload);
  await page.locator('[data-trainer-speech]').waitFor();assert(await page.locator('[data-trainer-speech]').evaluate(el=>{const r=el.getBoundingClientRect();return r.x>=0&&r.right<=innerWidth+1&&r.y>=0&&r.bottom<=innerHeight;}));
  const speechColors=await page.locator('[data-trainer-speech]').evaluate(el=>({ink:getComputedStyle(el).color,paper:getComputedStyle(el).backgroundColor,name:getComputedStyle(el.querySelector('strong')).color}));assert.deepEqual(speechColors,{ink:'rgb(255, 243, 196)',paper:'rgb(23, 57, 78)',name:'rgb(151, 217, 242)'});
  const during=await page.locator('.action-attack').boundingBox();assert(Math.abs(before.y-during.y)<1&&Math.abs(before.x-during.x)<1,JSON.stringify({width,before,during}));assert(await page.locator('.action-attack').isDisabled());
  assert.equal(await page.locator('.battle-move-effect').count(),0);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.waitForTimeout(250);assert(await page.locator('[data-trainer-speech]').evaluate(el=>el.scrollHeight<=el.clientHeight+1),`Trainer line clipped at ${width}`);await page.screenshot({path:path.join(output,`morpheo-speech-${width}.png`)});
  await page.evaluate(()=>window.mounirVm.$refs.battleOverlay._presentation.drain());assert.equal(await page.locator('[data-trainer-speech]').count(),0);assert.equal(await page.locator('[data-battle-send-out]').count(),0);
 }
 await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(payload=>{window.mounirVm.$refs.battleOverlay.presentEvent('updateBattleState',payload);},payload);await page.locator('[data-trainer-speech]').waitFor();assert.equal(await page.locator('[data-battle-send-out]').count(),0);await page.evaluate(()=>window.mounirVm.$refs.battleOverlay._presentation.drain());
 await page.emulateMedia({reducedMotion:'no-preference'});await page.evaluate(payload=>{window.mounirVm.$refs.battleOverlay.presentEvent('updateBattleState',payload);},payload);await page.locator('[data-battle-send-out]').waitFor();await page.evaluate(()=>window.mounirVm.$refs.battleOverlay.resetBattleUi());assert.equal(await page.locator('[data-trainer-speech]').count(),0);assert.equal(await page.locator('[data-battle-send-out]').count(),0);
 assert((await page.evaluate(()=>window.mounirTrace)).some(e=>e.kind==='ball'));const twoTurnUi=await require('./validateTwoTurnUi').validateTwoTurnUi(page,cleanup.runtime,p,output);
 assert.deepEqual(errors,[]);success=true;console.log(JSON.stringify({arenaArt,coldGymAssetsCovered:true,twoTurnUi,trainerSpeechMinSixSeconds:true,realMounirTeam:true,aceLast:true,rainForecast:true,sendOut:true,quoteOnceUnitAndSql:true,viewports:4,fixedActions:true,orderedAnimations:true,reducedMotion:true,cancellation:true,errors,output}));
}finally{holdArt=false;heldArt.splice(0).forEach(resolve=>resolve());if(!success&&page)await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});await browser?.close();cleanup();await new Promise(r=>io.close(r));if(userId)await dbPool.execute('DELETE FROM users WHERE id=?',[userId]);await dbPool.end();}})().catch(e=>{console.error(e.stack);process.exitCode=1});
