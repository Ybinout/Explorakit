// Complete quest on disposable SQL accounts and an isolated HTTP/Socket server.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(!/test/i.test(process.env.DB_TEST_NAME||''))throw Error('Dedicated test DB required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';process.env.BATTLE_DELAY_SCALE='0';
const express=require('express'),{Server}=require('socket.io'),{chromium}=require('playwright');
const {dbPool:db}=require('../server/config/database'),terrain=require('../server/game/world/mapRepository'),gates=require('../server/game/world/storyGates');
const policy=require('../server/game/world/arenaTests'),oldOwner=policy.isOwner;
const dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-professor-finale-dist',out=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-professor-finale-browser';fs.mkdirSync(out,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server);app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));
io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
let browser,page,peer,base,passed=false;const ids=[],errors=[],artifacts=[];
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(!v?.socket?.connected||v.mapLoading||v.renderedMap!==v.map||!v.players[v.socket.id])return false;window.v=v;return true;});}
async function create(){const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'prof_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(r.status,201);const f=await r.json();ids.push(f.user.id);return f;}
async function snap(label,all=true){for(const[width,height]of(all?[[320,568],[393,852],[844,390],[1365,900]]:[[393,852]])){await page.setViewportSize({width,height});await page.evaluate(async w=>{v.showMobileControls=w<=920;await v.$nextTick();v.resizeWorldViewport();},width);await page.waitForTimeout(100);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));const file=label+'-'+width+'.png';await page.screenshot({path:path.join(out,file)});artifacts.push(file);}await page.setViewportSize({width:393,height:852});await page.evaluate(()=>{v.showMobileControls=true;});}
async function at(id,map,x,y){await page.evaluate(()=>new Promise(r=>v.socket.emit('requestGameSave',r)));await page.evaluate(()=>v.socket.disconnect());await page.waitForTimeout(180);await db.execute('UPDATE users SET map=?,x=?,y=?,repel_steps=1000 WHERE id=?',[map,x*32+16,y*32+16,id]);await page.reload({waitUntil:'networkidle'});await ready();}
async function step(action,x,y){await page.waitForTimeout(170);await page.evaluate(action=>v.socket.emit('playerAction',action),action);await page.waitForFunction(({x,y})=>v.players[v.socket.id].x===x*32+16&&v.players[v.socket.id].y===y*32+16,{x,y});}
async function walk(x,y){
 const p=await page.evaluate(()=>({map:v.map,x:Math.floor(v.players[v.socket.id].x/32),y:Math.floor(v.players[v.socket.id].y/32),flags:v.progressionState.flags,pnjs:v.pnjs})),c=terrain.loadCollisionData(p.map),q=[[p.x,p.y,[]]],seen=new Set();let route;
 for(const[a,b,steps]of q){if(seen.has(a+':'+b))continue;seen.add(a+':'+b);if(a===x&&b===y){route=steps;break;}for(const[dx,dy,action,direction]of [[0,-1,'move_z','up'],[0,1,'move_s','down'],[-1,0,'move_q','left'],[1,0,'move_d','right']]){const nx=a+dx,ny=b+dy;if(c[ny]?.[nx]!==0||p.pnjs.some(n=>n.block!==false&&nx>=n.x&&nx<n.x+(n.blockingWidth||1)&&(ny===n.y||ny===n.y-1))||gates.candidatesForStep(p.map,direction,nx,ny).some(g=>gates.isLocked(g,{flags:p.flags})))continue;q.push([nx,ny,[...steps,[action,nx,ny]]]);}}
 assert(route,'No playable path to '+[p.map,x,y]);for(const s of route)await step(...s);
}
async function talk(name){await page.evaluate(()=>v.socket.emit('Space'));await page.waitForFunction(name=>v.endSentences===name&&v.textImageSequence.length>0,name);}
async function finishText(){await page.evaluate(()=>v.clearSequence());await page.waitForTimeout(120);}
function event(socket,name){return new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Missing '+name)),7000);socket.once(name,p=>{clearTimeout(t);resolve(p);});});}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}`;
 const a=await create(),b=await create();
 const prior=require('../data/game/progression.json').storySteps.slice(0,9).map(s=>s.flag);for(const flag of prior)await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,'true') ON DUPLICATE KEY UPDATE flag_value='true'",[a.user.id,flag]);await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,'lucie_departure','seen')",[a.user.id]);
 const lead=require('../server/game/drift/pokemonFactory').create(150,200,true);lead.k=4;lead.iv=Object.fromEntries(['hp','attack','defense','specialAttack','specialDefense','speed'].map(k=>[k,31]));lead.recalculateStats();lead.currentHp=lead.maxHp;lead.heldItem='leftovers';lead.abilities=[];lead.movePp=[];['Dark Pulse','Aura Sphere','Ice Beam','Flamethrower'].forEach(m=>lead.addAbility(m));await require('../server/persistence/teamRepository').editEquipe(a.user.id,{pokemons:[lead]});
 await db.execute("UPDATE users SET map='route2_maison',x=432,y=528,repel_steps=1000 WHERE id=?",[a.user.id]);await db.execute("UPDATE users SET map='route2',x=592,y=272 WHERE id=?",[b.user.id]);
 const {io:client}=require('../vue-explorakit/node_modules/socket.io-client');peer=client(base,{autoConnect:false,auth:{token:b.token},transports:['websocket'],reconnection:false});let peerActors=[];peer.on('pnjsList',s=>{peerActors=s.pnjs;});const initial=event(peer,'pnjsList');peer.connect();await initial;assert(!peerActors.some(n=>n.name==='wanda_professor'));
 const rejected=event(peer,'interactionRejected');peer.emit('onEndDialogue','professor_lab_rock');assert.equal((await rejected).reason,'invalid_or_expired_dialogue');
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true});await context.addInitScript(s=>localStorage.setItem('explorakit.user',JSON.stringify(s)),{...a.user,token:a.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().startsWith(base)&&r.status()>=400)errors.push(r.status()+' '+r.url());});
 await page.goto(base+'/game',{waitUntil:'networkidle'});await ready();assert(!await page.evaluate(()=>v.pnjs.some(n=>n.name==='lucie_route2')));
 await page.evaluate(()=>v.socket.emit('playerAction','move_s'));await page.waitForFunction(()=>v.map==='route2'&&!v.mapLoading&&v.renderedMap===v.map);assert.equal(await page.evaluate(()=>v.progressionState.flags.lucie_house_exited),'true');assert(await page.evaluate(()=>v.pnjs.some(n=>n.name==='wanda_professor')));assert(!peerActors.some(n=>n.name==='wanda_professor'));
 await page.waitForFunction(()=>v.endSentences==='wanda_professor'&&v.textImageSequence.length>0);assert(await page.evaluate(()=>v.textImageSequence.some(s=>s.text.includes('trou noir'))));await snap('wanda');await finishText();await page.waitForFunction(()=>v.progressionState.flags.professor_lead==='true');
 await at(a.user.id,'start',24,16);await talk('professor_lab_door');await snap('locked-door',false);await finishText();await page.waitForFunction(()=>v.progressionState.flags.lab_door_inspected==='true');
 await walk(26,17);await talk('professor_lab_rock');await finishText();await page.waitForFunction(()=>v.progressionState.flags.professor_lab_key==='true');const [[key]]=await db.execute("SELECT quantity FROM user_items WHERE user_id=? AND item_key='professor_lab_key'",[a.user.id]);assert.equal(key.quantity,1);
 await at(a.user.id,'route2',14,8);assert(!await page.evaluate(()=>v.pnjs.some(n=>n.name==='wanda_professor')));await at(a.user.id,'start',24,16);
 await page.evaluate(()=>v.socket.emit('Space'));await page.waitForFunction(()=>v.map==='professor_lab'&&!v.mapLoading&&v.renderedMap===v.map);assert(await page.evaluate(()=>v.pnjs.some(n=>n.name==='professor_story')&&v.pnjs.some(n=>n.name==='lucie_lab')));await snap('lab');
 await walk(13,9);await page.evaluate(()=>v.socket.emit('Space'));await page.waitForFunction(()=>v.interactionNotice.includes('Professeur doit'));assert(!await page.evaluate(()=>v.roomObstacleAction));await walk(13,12);
 const before=await page.evaluate(()=>({x:v.players[v.socket.id].x,y:v.players[v.socket.id].y}));await page.evaluate(()=>v.socket.emit('playerAction','move_z'));await page.waitForTimeout(250);assert.deepEqual(await page.evaluate(()=>({x:v.players[v.socket.id].x,y:v.players[v.socket.id].y})),before);
 await talk('professor_story');await finishText();await page.locator('.portrait-ready').waitFor();assert.equal(await page.locator('.champion-heading h2').innerText(),'Le Professeur');assert(await page.locator('.entrance-portrait').evaluate(i=>i.src.includes('/prof.')));await snap('professor-splash');
 await page.locator('.action-attack:enabled').waitFor();assert.equal(await page.locator('[data-battle-environment="professor-lab"]').count(),1);assert.match(await page.evaluate(()=>v.$refs.battleOverlay.music?.src||''),/lucie-combat/);assert.equal(await page.locator('[data-battle-platform="wild"]').count(),1);assert.equal(await page.locator('[data-battle-platform="player"]').count(),0);await snap('professor-battle');
 await page.evaluate(()=>v.updatePreferences({...v.preferences,animationsEnabled:false}));
 for(let i=0;i<45;i++){
  await page.waitForFunction(()=>v.battleResult||v.deferredBattleResult||document.querySelector('.action-attack:not(:disabled)'));if(await page.evaluate(()=>v.battleResult||v.deferredBattleResult))break;
  const index=await page.evaluate(()=>{const id=v.$refs.battleOverlay.wildPokemon?.data?.id;return [450,445].includes(id)?2:[437,212].includes(id)?3:0;});await page.locator('.action-attack:enabled').click();const choices=page.locator('.battle-grid-attacks button');if(await choices.nth(index).isEnabled())await choices.nth(index).click();else await page.locator('.battle-grid-attacks button:enabled').first().click();await page.waitForTimeout(100);
 }
 await page.waitForFunction(()=>v.battleResult||v.deferredBattleResult);assert.equal(await page.evaluate(()=>(v.battleResult||v.deferredBattleResult).outcome),'victory');if(await page.evaluate(()=>v.battleResult))await page.locator('[data-battle-result-continue]').click();await page.waitForFunction(()=>v.endSentences==='professor_story_after'&&v.textImageSequence.length>0);
 await page.evaluate(()=>v.updatePreferences({...v.preferences,animationsEnabled:true}));await finishText();await page.waitForFunction(()=>v.lucieDeparture?.actor==='professor_story');assert(!await page.evaluate(()=>v.battleResult));await page.waitForTimeout(1400);await snap('professor-void',false);await page.waitForFunction(()=>!v.lucieDeparture&&!v.pnjs.some(n=>n.name==='professor_story'));if(await page.evaluate(()=>v.battleResult))await page.locator('[data-battle-result-continue]').click();
 await walk(13,9);await page.evaluate(()=>v.socket.emit('Space'));await page.waitForFunction(()=>v.roomObstacleAction?.id==='lab_crystals');assert.equal(await page.locator('.room-obstacle-hits i').count(),10);for(let n=2;n<=10;n++){await page.evaluate(()=>v.espace());await page.waitForFunction(n=>v.displayedRoomObstacleAction?.hits===n,n);}await page.waitForFunction(()=>v.progressionState.flags.lab_crystals_cleared==='true');await page.locator('.room-obstacle-action').waitFor({state:'hidden'});
 await walk(13,6);await talk('lucie_lab_rescue');await snap('lucie-rescued',false);await finishText();await page.waitForFunction(()=>v.progressionState.flags.lucie_rescued==='true'&&!v.pnjs.some(n=>n.name==='lucie_lab'));assert.equal(await page.evaluate(()=>v.progressionState.quests.find(q=>q.key==='main_sister_search').status),'completed');
 await walk(13,16);await page.waitForTimeout(170);await page.evaluate(()=>v.socket.emit('playerAction','move_s'));await page.waitForFunction(()=>v.map==='start'&&!v.mapLoading&&v.renderedMap===v.map);assert(await page.evaluate(()=>v.pnjs.some(n=>n.name==='lucie_home')));await walk(5,9);await talk('lucie_home');await snap('family');await finishText();await walk(6,9);await talk('dia0_final');await finishText();
 await page.reload({waitUntil:'networkidle'});await ready();assert.equal(await page.evaluate(()=>v.progressionState.flags.story_complete),'true');assert(await page.evaluate(()=>v.pnjs.some(n=>n.name==='lucie_home')));
 const healed=(await require('../server/persistence/teamRepository').loadEquipe(a.user.id)).pokemons;assert(healed.every(p=>p.currentHp===p.maxHp&&p.status==='normal'));
 const normal=await require('../server/persistence/progressionRepository').loadProgressState(a.user.id);policy.isOwner=u=>u?.id===a.user.id&&u?.username===a.user.username;
 const reset=await page.evaluate(()=>new Promise(r=>v.socket.emit('admin:rearmArenas',{},r)));assert(reset.success);
 let replay=await require('../server/persistence/progressionRepository').loadProgressState(a.user.id);
 assert.equal(replay.flags.admin_professor_lab_key,'false');assert.equal(replay.flags.professor_lab_key,'true');
 assert.equal(require('../server/game/world/roomObstacles').snapshot(replay).filter(o=>o.map==='route2_maison'&&o.locked).length,3);
 // The original 10-hit blockers are covered above/in their own recipe. Place
 // this replay fixture beyond them to focus on the two actual replay battles.
 for(const o of require('../server/game/world/roomObstacles').obstacles.filter(o=>o.map==='route2_maison'))await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value)VALUES(?,?,'true') ON DUPLICATE KEY UPDATE flag_value='true'",[a.user.id,require('../server/game/world/testReplayState').obstacleFlag(o)]);
 async function replayBattle(name){
  await talk(name);await finishText();await page.locator('.action-attack:enabled').waitFor();
  await page.evaluate(()=>v.updatePreferences({...v.preferences,animationsEnabled:false}));
  for(let i=0;i<45;i++){
   await page.waitForFunction(()=>v.battleResult||v.deferredBattleResult||document.querySelector('.action-attack:not(:disabled)'));if(await page.evaluate(()=>v.battleResult||v.deferredBattleResult))break;
   const index=await page.evaluate(()=>{const id=v.$refs.battleOverlay.wildPokemon?.data?.id;return [450,445,398].includes(id)?2:[437,212].includes(id)?3:id===395?1:0;});
   await page.locator('.action-attack:enabled').click();const choices=page.locator('.battle-grid-attacks button');if(await choices.nth(index).isEnabled())await choices.nth(index).click();else await page.locator('.battle-grid-attacks button:enabled').first().click();await page.waitForTimeout(100);
  }
  await page.waitForFunction(()=>v.battleResult||v.deferredBattleResult);assert.equal(await page.evaluate(()=>(v.battleResult||v.deferredBattleResult).outcome),'victory');
  if(await page.evaluate(()=>v.battleResult))await page.locator('[data-battle-result-continue]').click();
  await page.waitForFunction(name=>v.endSentences===name+'_after'&&v.textImageSequence.length>0,name);
  await page.evaluate(()=>v.updatePreferences({...v.preferences,animationsEnabled:true}));await finishText();
  await page.waitForFunction(name=>v.lucieDeparture?.actor===name,name);await page.waitForFunction(name=>!v.lucieDeparture&&!v.pnjs.some(n=>n.name===name),name);
  if(await page.evaluate(()=>v.battleResult))await page.locator('[data-battle-result-continue]').click();
 }
 await at(a.user.id,'route2_maison',13,6);await replayBattle('lucie_route2');
 await walk(13,16);await page.waitForTimeout(170);await page.evaluate(()=>v.socket.emit('playerAction','move_s'));
 await page.waitForFunction(()=>v.map==='route2'&&!v.mapLoading&&v.renderedMap===v.map);
 assert.equal(await page.evaluate(()=>v.progressionState.flags.admin_lucie_house_exited),'true');assert(await page.evaluate(()=>v.pnjs.some(n=>n.name==='wanda_professor')));assert(!peerActors.some(n=>n.name==='wanda_professor'));
 await page.waitForFunction(()=>v.endSentences==='wanda_professor'&&v.textImageSequence.length>0);await snap('replay-wanda',false);await finishText();await page.waitForFunction(()=>v.progressionState.flags.admin_professor_lead==='true');
 await at(a.user.id,'start',24,16);await talk('professor_lab_door');await finishText();await page.waitForFunction(()=>v.progressionState.flags.admin_lab_door_inspected==='true');
 await walk(26,17);await talk('professor_lab_rock');await finishText();await page.waitForFunction(()=>v.progressionState.flags.admin_professor_lab_key==='true');
 const [[sameKey]]=await db.execute("SELECT quantity FROM user_items WHERE user_id=? AND item_key='professor_lab_key'",[a.user.id]);assert.equal(sameKey.quantity,1);
 await at(a.user.id,'route2',14,8);assert(!await page.evaluate(()=>v.pnjs.some(n=>n.name==='wanda_professor')));
 await at(a.user.id,'start',24,16);await page.evaluate(()=>v.socket.emit('Space'));await page.waitForFunction(()=>v.map==='professor_lab'&&!v.mapLoading&&v.renderedMap===v.map);
 assert(await page.evaluate(()=>v.pnjs.some(n=>n.name==='professor_story')&&v.pnjs.some(n=>n.name==='lucie_lab')));
 await walk(13,12);await replayBattle('professor_story');await walk(13,9);await page.evaluate(()=>v.socket.emit('Space'));
 await page.waitForFunction(()=>v.roomObstacleAction?.id==='lab_crystals');for(let n=2;n<=10;n++){await page.evaluate(()=>v.espace());await page.waitForFunction(n=>v.displayedRoomObstacleAction?.hits===n,n);}await page.waitForFunction(()=>v.progressionState.flags['admin_room_obstacle:lab_crystals']==='true');await page.locator('.room-obstacle-action').waitFor({state:'hidden'});
 await walk(13,6);await talk('lucie_lab_rescue');await snap('replay-lucie-rescue',false);await finishText();
 await page.waitForFunction(()=>v.progressionState.flags.admin_lab_rescued==='true'&&!v.pnjs.some(n=>n.name==='lucie_lab'));
 await walk(13,16);await page.waitForTimeout(170);await page.evaluate(()=>v.socket.emit('playerAction','move_s'));await page.waitForFunction(()=>v.map==='start'&&!v.mapLoading&&v.renderedMap===v.map);
 assert(await page.evaluate(()=>v.pnjs.some(n=>n.name==='lucie_home')));await walk(5,9);await talk('lucie_home');await snap('replay-family',false);await finishText();
 const after=await require('../server/persistence/progressionRepository').loadProgressState(a.user.id);assert.equal(after.money,normal.money);assert.equal(after.flags.lucie_rescued,'true');assert.equal(after.quests.find(q=>q.key==='main_sister_search').status,'completed');
 for(const key of ['lucie_freed','lucie_departure','lucie_house_exited','professor_lead','lab_door_inspected','professor_lab_key','professor_defeated','professor_departure','lab_crystals_cleared','lucie_rescued','story_complete'])assert.equal(after.flags[key],normal.flags[key]);
 assert.equal((await require('../server/persistence/progressionRepository').loadProgressState(b.user.id)).flags.story_complete,undefined);
 assert.deepEqual(errors,[]);passed=true;const result={actualExit:true,personalWanda:true,doorRockKey:true,uniqueKey:true,newLab:true,realProfessorBattle:true,professorVoid:true,tenStrikeBarrier:true,lucieHome:true,motherStillHeals:true,persistentEnding:true,adminReplay:true,realReplayLucieBattle:true,realReplayProfessorBattle:true,replayWandaReturns:true,replayKeyNotDuplicated:true,replayRescueAndHome:true,permanentProgressUnchanged:true,otherPlayerUnaffected:true,viewports:4,artifacts,errors};fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{if(!passed&&page)await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});await browser?.close();peer?.disconnect();await new Promise(r=>io.close(r));await new Promise(r=>setTimeout(r,180));policy.isOwner=oldOwner;for(const id of ids)await db.execute('DELETE FROM users WHERE id=?',[id]);await db.end();}})().catch(e=>{console.error(e.stack);process.exitCode=1});
