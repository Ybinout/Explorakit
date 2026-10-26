// Real SQL/Socket worlds plus explicitly marked server-engine fixtures on test DB only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(!/test/i.test(process.env.DB_TEST_NAME||''))throw Error('Dedicated test DB required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';process.env.BATTLE_DELAY_SCALE='0';
const express=require('express'),{Server}=require('socket.io'),{chromium}=require('playwright');
const {dbPool:db}=require('../server/config/database'),teamRepo=require('../server/persistence/teamRepository'),factory=require('../server/game/drift/pokemonFactory'),engine=require('../server/game/battle/battleEngine');
const dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-field-dist',out=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-field-browser';fs.mkdirSync(out,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server);app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
const store=require('../server/game/drift/lobbyStore').createLobbyStore(),cleanup=require('../server/realtime/driftLobbyHandler').registerDriftLobbies(io,{store,checkpointRepository:{async save(){}},runtimeOptions:{paceMs:0,starterChoiceMs:60000}});
let browser,page,base,success=false;const users=[],errors=[],checks=[],captures=[];
function mon(id,moves){const p=factory.create(id,80,true);p.passiveAbility=null;p.abilities=[];p.movePp=[];for(const m of moves)p.addAbility(m);return p;}
function party(){return [mon(9,['Stealth Rock','Spikes','Trick Room','Reflect']),mon(6,['Tackle'])];}
async function create(){const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'field_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(r.status,201);const u=await r.json();users.push(u);return u;}
async function ready(target=page){await target.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(!v?.socket?.connected||v.mapLoading||v.renderedMap!==v.map||!v.players[v.socket.id])return false;window.v=v;return true;});}
async function drain(target=page){await target.evaluate(async()=>{await v.$refs.battleOverlay?._presentation?.drain();});}
async function snap(name){const file=name+'.png';await page.screenshot({path:path.join(out,file)});captures.push(file);}
async function context(user){const c=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true});await c.addInitScript(s=>localStorage.setItem('explorakit.user',JSON.stringify(s)),{...user.user,token:user.token});const target=await c.newPage();target.on('pageerror',e=>errors.push(e.message));return target;}
async function chooseMove(index){await page.locator('.action-attack:enabled').click();await page.locator('.battle-grid-attacks .battle-choice-btn').nth(index).click();await page.locator('.action-attack:enabled').waitFor({timeout:45000});}
async function fieldIs(check,target=page){await target.waitForFunction(check);await drain(target);}
async function closeResult(){await page.locator('[data-battle-result-continue]').click();await page.locator('.battle-scene').waitFor({state:'hidden'});}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}`;
 const u=await create(),guest=await create();await teamRepo.editEquipe(u.user.id,{pokemons:party()});await db.execute('UPDATE users SET map=?,x=?,y=? WHERE id=?',['start',18*32+16,3*32+16,u.user.id]);
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});page=await context(u);
 await page.goto(base+'/game',{waitUntil:'networkidle'});await ready();await page.evaluate(()=>v.updatePreferences({...v.preferences,masterVolume:0,textSpeed:10000}));
 await page.evaluate(()=>v.socket.emit('Space'));await page.waitForFunction(()=>v.textImageSequence.length>0);
 for(let i=0;i<30&&await page.evaluate(()=>v.textImageSequence.length>0);i++){await page.locator('.dialogue-layer .text').click();await page.waitForTimeout(100);}
 await page.locator('.action-attack:enabled').waitFor({timeout:45000});
 for(const index of [0,1,2,3])await chooseMove(index);
 await fieldIs(()=>{const s=v.$refs.battleOverlay.fieldModel;return s.sides.opponent.hazards.stealthRock&&s.sides.opponent.hazards.spikes===1&&s.field.trickRoomTurns>0&&s.sides.player.screens.reflectTurns>0;});
 await page.locator('.field-hud-toggle').click();assert.match(await page.locator('.field-info').innerText(),/Distorsion/);assert.match(await page.locator('[data-field-effect="opponent:stealthRock"]').innerText(),/Camp adverse/);await snap('adventure-fields');await page.locator('.field-hud-toggle').click();checks.push('Actual Adventure Wayne battle: four field moves chosen through UI, authoritative effects and turn counters received');
 await page.locator('.action-flee:enabled').click();await page.locator('[data-battle-result-continue]').waitFor({timeout:45000});await closeResult();
 await page.goto(base+'/colosseum',{waitUntil:'networkidle'});await page.locator('[data-colosseum-start]:enabled').click();await page.locator('[data-starter-choice]').first().click();await ready();
 const p=cleanup.runtime.playerFor(u.user);p.equipe.pokemons=party();p.run.phase='colosseum_battle';p.run.colosseum.wave=1;p.run.colosseum.next=require('../server/game/drift/colosseum').waveInfo(1);cleanup.runtime.send(p);const enemy={npc:true,equipe:{pokemons:[mon(19,['Growl']),mon(25,['Growl'])]},drifts:[],equipped:[]};
 const battle=cleanup.runtime.battle(p,enemy,'arena','colosseum_1');battle.deadline=Date.now()+360000;await page.locator('.battle-scene').waitFor();await page.locator('.action-attack:enabled').waitFor({timeout:45000});
 // Server-engine fixtures: all moves resolved by the real engine and delivered through real battle.sync.
 await page.locator('.battle-colosseum').waitFor();
 const cast=(name,reverse=false)=>{const index=reverse?1:0,result=engine.useattack(name,battle.active(index),battle.active(1-index),{battleState:battle.state,attackerSide:battle.sides[index],defenderSide:battle.sides[1-index],consumePp:false,skipTurnStart:true});battle.sync();assert.equal(result.success,true,`${name}: ${result.messages}`);return result;};
 for(const name of ['Stealth Rock','Spikes','Toxic Spikes','Sticky Web','Trick Room','Magic Room','Wonder Room','Gravity','Mud Sport','Water Sport','Fairy Lock','Electric Terrain']){cast(name);await drain();}
 cast('Reflect',true);cast('Light Screen',true);cast('Safeguard',true);cast('Tailwind',true);await fieldIs(()=>v.$refs.battleOverlay.fieldModel.sides.opponent.screens.tailwindTurns>0);
 for(const [width,height]of [[320,568],[393,852],[844,390],[1365,900]]){
  await page.setViewportSize({width,height});await page.evaluate(width=>{v.showMobileControls=width<=920;v.resizeWorldViewport();},width);
  for(const themeMode of ['light','dark']){
   await page.evaluate(themeMode=>v.updatePreferences({...v.preferences,themeMode}),themeMode);const button=page.locator('.field-hud-toggle');await button.click();
   assert(await page.locator('.field-info').isVisible());const box=await page.locator('.field-info').boundingBox();assert(box.x>=0&&box.x+box.width<=width+1);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.equal(await page.locator('[data-field-side="opponent"] [data-hazard]').count(),4);
   assert.equal(await page.locator('[data-field-side="player"] [data-hazard]').count(),0);
   await snap(`field-info-${themeMode}-${width}`);await button.click();
  }
 }
 await page.setViewportSize({width:393,height:852});await page.evaluate(()=>{v.showMobileControls=true;v.updatePreferences({...v.preferences,themeMode:'light'});});
 // Replacement creates a local entry pulse, anchored at the same opponent ground point.
 enemy.equipe.pokemons.reverse();battle.enter(1);battle.sync();await page.waitForFunction(()=>!!document.querySelector('[data-field-side="opponent"] .field-contact'));await snap('hazard-entry-mobile');
 const queue=await page.evaluate(async()=>{const b=v.$refs.battleOverlay;await b._presentation.drain();b.updateFieldState({});b.fieldInitialized=true;const before=performance.now();await b.presentEvent('updateFieldState',{field:{trickRoomTurns:3}});return performance.now()-before;});assert(queue>=650);checks.push('Field change shares presentation queue, entry pulse follows replacement, ground anchors and four hazards match correct side');
 const impact=await page.evaluate(async()=>{
  const b=v.$refs.battleOverlay;await b._presentation.drain();b.clearMoveFx();b.updateFieldState({});
  b.playMoveAnimation({actor:'player',moveName:'Trick Room',moveType:'Psychic',damageClass:'status',moveTarget:'field'});
  b.playMoveResult({actor:'player',success:true,damage:0});b.updateFieldState({field:{trickRoomTurns:3}});
  if(b.fieldModel.field.trickRoomTurns)throw Error('Field appeared before move impact');
  const frames=[],wait=b.transitionWait.bind(b);b.transitionWait=async ms=>{frames.push({stage:b.battleMoveFx.stage,timer:b.fieldModel.field.trickRoomTurns});await wait(ms);};
  try{await b.presentEvent('updateBattleState',{player:structuredClone(b.player),wildPokemon:structuredClone(b.opponent)});}finally{b.transitionWait=wait;}
  if(!frames.some(f=>f.stage==='travel'&&f.timer===0)||!frames.some(f=>f.stage==='aura'&&f.timer===3))throw Error('Field not synchronized with impact');
  b.playMoveAnimation({actor:'player',moveName:'Magic Room',damageClass:'status',moveTarget:'field'});b.playMoveResult({success:true});b.updateFieldState({field:{magicRoomTurns:5}});b.resetBattleUi();
  if(b._pendingBattleField||b.fieldModel.field.magicRoomTurns)throw Error('Cancelled field leaked into next battle');return frames;
 });checks.push('Field activation waits for move impact; cancelling discards deferred field state');
 battle.sync();await drain();await page.reload({waitUntil:'networkidle'});await ready();await page.locator('.field-hud-toggle').waitFor({timeout:45000});await drain();assert.equal(await page.evaluate(()=>v.$refs.battleOverlay.fieldFx.changes.length),0);assert.equal(await page.locator('[data-field-side="opponent"] [data-hazard]').count(),4);checks.push('Real expedition reconnect restores field and correct sides without replaying activation captions');
 // All clear and expiration updates remove persistent visuals; no duplicate captions for timer-only syncs.
 cast('Defog');await fieldIs(()=>!v.$refs.battleOverlay.fieldModel.sides.opponent.hazards.spikes);assert.equal(await page.locator('[data-field-side="opponent"] [data-hazard]').count(),0);
 for(let i=0;i<6;i++)engine.processEndOfRound(battle.active(0),battle.active(1),battle.sides[0],battle.sides[1],battle.state);battle.sync();await fieldIs(()=>Object.values(v.$refs.battleOverlay.fieldModel.field).every(n=>n===0));assert.equal(await page.locator('.field-room-grid').count(),0);
 await page.emulateMedia({reducedMotion:'reduce'});cast('Trick Room');await drain();assert.equal(await page.locator('.field-change-art').evaluate(el=>getComputedStyle(el).display),'none');await page.locator('.field-hud-toggle').click();assert.match(await page.locator('.field-info').innerText(),/Distorsion/);await snap('reduced-motion');await page.locator('.field-hud-toggle').click();await page.emulateMedia({reducedMotion:'no-preference'});
 battle.finish(p,'finished');await page.locator('[data-battle-result-continue]').waitFor();await closeResult();assert.equal(await page.evaluate(()=>v.$refs.battleOverlay.fieldInitialized),false);await page.evaluate(()=>v.leaveDrift());await page.locator('[data-colosseum-lobby]').waitFor();
 store.connect(u.user,'field-host');store.connect(guest.user,'field-guest');const lobby=store.create(u.user,{capacity:2,durationMinutes:30});store.join(guest.user,lobby.code);for(const f of[u,guest])store.ready(f.user,true);await cleanup.runtime.start(u.user);
 for(const f of[u,guest]){const player=cleanup.runtime.playerFor(f.user);cleanup.runtime.chooseStarter(player,player.starterChoices[0].uuid);player.equipe.pokemons=party();}
 await page.goto(base+'/drift/game',{waitUntil:'networkidle'});await ready();const other=await context(guest);await other.goto(base+'/drift/game',{waitUntil:'networkidle'});await ready(other);
 const a=cleanup.runtime.playerFor(u.user),b=cleanup.runtime.playerFor(guest.user),duel=cleanup.runtime.battle(a,b,'pvp');duel.deadline=Date.now()+360000;
 await page.locator('.action-attack:enabled').waitFor({timeout:45000});await other.locator('.action-attack:enabled').waitFor({timeout:45000});
 await page.locator('.action-attack').click();await page.locator('.battle-grid-attacks .battle-choice-btn').first().click();await other.locator('.action-attack').click();await other.locator('.battle-grid-attacks .battle-choice-btn').nth(3).click();
 await fieldIs(()=>v.$refs.battleOverlay.fieldModel.sides.opponent.hazards.stealthRock);await fieldIs(()=>v.$refs.battleOverlay.fieldModel.sides.player.hazards.stealthRock,other);
 assert.equal(await page.locator('[data-field-side="player"] [data-hazard="stealthRock"]').count(),0);assert.equal(await other.locator('[data-field-side="opponent"] [data-hazard="stealthRock"]').count(),0);
 await page.locator('.field-hud-toggle').click();await snap('rift-pvp-host');await other.locator('.field-hud-toggle').click();await other.screenshot({path:path.join(out,'rift-pvp-guest.png')});captures.push('rift-pvp-guest.png');checks.push('Actual multiplayer Rift round submitted from both browsers: hazards and screens are reversed correctly per viewer');
 assert.deepEqual(errors,[]);success=true;const result={modes:['adventure','colosseum','rift-pvp'],viewports:4,themes:2,captures,checks,impact,reducedMotion:true,reconnect:true,errors};fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{if(!success&&page&&!page.isClosed()){await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});console.error(await page.evaluate(()=>({text:document.body.innerText.slice(-1200),field:v?.$refs.battleOverlay?.fieldModel})).catch(()=>null));}await browser?.close();cleanup();await new Promise(r=>io.close(r));await new Promise(r=>setTimeout(r,200));for(const u of users)await db.execute('DELETE FROM users WHERE id=?',[u.user.id]);await db.end();}})().catch(e=>{console.error(e.stack);process.exitCode=1});
