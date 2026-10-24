// Authoritative Adventure barriers and their shared canvas animation. Test DB only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const{once}=require('node:events'),{randomUUID}=require('node:crypto');
if(!/test/i.test(process.env.DB_TEST_NAME||''))throw Error('Dedicated test database required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';
const express=require('express'),{Server}=require('socket.io'),{chromium}=require('playwright'),{dbPool}=require('../server/config/database');
const dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-story-gates-dist',output=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-story-gates-browser';fs.mkdirSync(output,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server);app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
const store=require('../server/game/drift/lobbyStore').createLobbyStore(),cleanup=require('../server/realtime/driftLobbyHandler').registerDriftLobbies(io,{store,checkpointRepository:{async save(){}},runtimeOptions:{paceMs:0,random:()=>.99}});
let browser,page,base,success=false;const users=[],errors=[];
async function create(){const password=randomUUID(),username='root_'+randomUUID(),r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password,starterId:7})});assert.equal(r.status,201);const f=await r.json();f.password=password;users.push(f);return f;}
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(!v?.socket?.connected||v.mapLoading||v.renderedMap!==v.map||!v.players[v.socket.id])return false;window.cityVm=v;return true;});}
async function leave(){if(await page.locator('.game-root').count())await page.evaluate(()=>new Promise(r=>window.cityVm.socket.emit('requestGameSave',()=>{window.cityVm.socket.disconnect();r();})));await page.goto('about:blank');await page.waitForTimeout(250);}
async function locate(a,map,x,y){await leave();await dbPool.execute('UPDATE users SET map=?,x=?,y=?,repel_steps=1000 WHERE id=?',[map,x*32+16,y*32+16,a.user.id]);await page.goto(base+'/game',{waitUntil:'networkidle'});await ready();assert.equal(await page.evaluate(()=>window.cityVm.map),map);}
async function push(action,eventName,id){return page.evaluate(({action,eventName,id})=>new Promise((resolve,reject)=>{const s=window.cityVm.socket;const timer=setTimeout(()=>{s.off(eventName,handler);reject(Error('Missing '+eventName));},7000);function handler(p){if(eventName==='storyGateBlocked'&&p.id!==id)return;if(eventName==='playerMoved'&&p.id!==s.id)return;clearTimeout(timer);s.off(eventName,handler);resolve(p);}s.on(eventName,handler);s.emit('playerAction',action);}),{action,eventName,id});}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}`;const a=await create();
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true});await context.addInitScript(s=>{if(location.protocol==='http:')localStorage.setItem('explorakit.user',JSON.stringify(s));},{...a.user,token:a.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().startsWith(base)&&r.status()>=400)errors.push(r.status()+' '+r.url());});
 await locate(a,'ville_safe1',25,8);await page.evaluate(()=>window.cityVm.socket.emit('Space'));
 await page.waitForFunction(()=>window.cityVm.endSentences==='mathilde_pikapika_locked'&&document.querySelector('.dialogue-layer .text')?.textContent.length>20);
 assert.match(await page.evaluate(()=>window.cityVm.textImageSequence[0].text),/badge de Raph/);
 await page.screenshot({path:path.join(output,'mathilde-refusal-393.png')});
 assert.equal((await require('../server/persistence/progressionRepository').completeNpcBattle(a.user.id,'mathilde_pikapika')).reason,'requirements_not_met');
 await page.evaluate(()=>window.cityVm.clearSequence());
 for(const g of [{id:'wayne_route1',map:'start',x:19,y:3,action:'move_z',npc:'dia1',name:'Wayne'},{id:'aspha_lake',map:'route2',x:25,y:6,action:'move_d',npc:'aspha_route2',name:'Aspha'},{id:'gwenn_ocreville',map:'gen_route8',x:22,y:17,action:'move_s',npc:'gwenn_route8',name:'Gwenn'},{id:'mathilde_route5',map:'ville_safe1',x:25,y:8,action:'move_d',npc:'mathilde_pikapika',name:'Mathilde Pikapika'}]){
  await locate(a,g.map,g.x,g.y);await page.waitForFunction(id=>window.cityVm._storyGateRenderer?.gates.get(id)?.locked,g.id);
  if(g.id==='gwenn_ocreville'){
   await page.evaluate(()=>window.cityVm.socket.emit('Space'));
   await page.waitForFunction(()=>window.cityVm.endSentences==='gwenn_route8_locked'&&document.querySelector('.dialogue-layer .text')?.textContent.length>20);
   assert.match(await page.evaluate(()=>window.cityVm.textImageSequence[0].text),/battu Hoze/);
   await page.screenshot({path:path.join(output,'gwenn-refusal-393.png')});
   await page.evaluate(()=>window.cityVm.clearSequence());
  }
  for(const [width,height]of [[320,568],[393,852],[1365,900]]){
   await page.setViewportSize({width,height});await page.evaluate(w=>window.cityVm.showMobileControls=w<=920,width);await page.waitForTimeout(1250);
   await push(g.action,'storyGateBlocked',g.id);await page.waitForTimeout(90);
   assert((await page.evaluate(()=>window.cityVm.interactionNotice)).includes(g.name));
   assert.deepEqual(await page.evaluate(()=>{const v=window.cityVm,p=v.players[v.socket.id];return [p.x,p.y];}),[g.x*32+16,g.y*32+16]);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   await page.screenshot({path:path.join(output,g.id+'-blocked-'+width+'.png')});
  }
  await page.setViewportSize({width:393,height:852});await page.evaluate(()=>window.cityVm.showMobileControls=true);
  if(g.id==='gwenn_ocreville'){
   const repo=require('../server/persistence/progressionRepository');
   assert.equal((await repo.completeNpcBattle(a.user.id,g.npc)).reason,'requirements_not_met');
   for(const name of ['moon','champion_hoze'])assert((await repo.completeNpcBattle(a.user.id,name)).granted);
   await page.waitForTimeout(1250);await push(g.action,'storyGateBlocked',g.id);
   await page.evaluate(()=>window.cityVm.socket.emit('Space'));
   await page.waitForFunction(()=>window.cityVm.endSentences==='gwenn_route8'&&document.querySelector('.dialogue-layer .text')?.textContent.length>20);
   await page.screenshot({path:path.join(output,'gwenn-ready-393.png')});
   // The actual one-off fight and replay rejection are covered by story-socket-integration.
   await locate(a,g.map,g.x,g.y);
  }
  if(g.id==='mathilde_route5'){
   const repo=require('../server/persistence/progressionRepository');
   assert.equal((await repo.completeNpcBattle(a.user.id,g.npc)).reason,'requirements_not_met');
   assert((await repo.completeNpcBattle(a.user.id,'champion_raphael')).granted);
   await page.evaluate(()=>window.cityVm.socket.emit('Space'));
   await page.waitForFunction(()=>window.cityVm.endSentences==='mathilde_pikapika'&&document.querySelector('.dialogue-layer .text')?.textContent.length>20);
   await page.screenshot({path:path.join(output,'mathilde-ready-393.png')});
   await locate(a,g.map,g.x,g.y);
  }
  assert((await require('../server/persistence/progressionRepository').completeNpcBattle(a.user.id,g.npc)).granted);
  await page.waitForTimeout(400);await push(g.action,'playerMoved');
  assert(await page.evaluate(id=>window.cityVm._storyGateRenderer.gates.get(id).opening,g.id));
  await page.screenshot({path:path.join(output,g.id+'-opening.png')});
  await page.waitForFunction(id=>!window.cityVm._storyGateRenderer.gates.get(id).opening,g.id);
  await page.screenshot({path:path.join(output,g.id+'-open.png')});
  await locate(a,g.map,g.x,g.y);await page.waitForFunction(id=>window.cityVm._storyGateRenderer?.gates.has(id),g.id);
  assert(await page.evaluate(id=>{const g=window.cityVm._storyGateRenderer.gates.get(id);return !g.locked&&!g.opening;},g.id));
  await push(g.action,'playerMoved');
 }
 // The shared client must not introduce Adventure barriers in an expedition.
 await page.goto(base+'/colosseum',{waitUntil:'networkidle'});await page.locator('[data-colosseum-start]:enabled').click();await page.locator('[data-starter-choice]').first().click();await page.locator('.starter-backdrop').waitFor({state:'hidden'});
 const p=cleanup.runtime.playerFor(a.user);Object.assign(p,{currentmap:'start',x:624,y:112,repelSteps:100});await page.reload({waitUntil:'networkidle'});await ready();assert(await page.evaluate(()=>window.cityVm.isDrift&&!window.cityVm._storyGateRenderer));await push('move_z','playerMoved');assert.equal(p.y,80);
 Object.assign(p,{currentmap:'gen_route8',x:22*32+16,y:17*32+16,repelSteps:100});await page.reload({waitUntil:'networkidle'});await ready();await push('move_s','playerMoved');assert.equal(p.y,18*32+16);
 Object.assign(p,{currentmap:'ville_safe1',x:25*32+16,y:8*32+16,repelSteps:100});await page.reload({waitUntil:'networkidle'});await ready();await push('move_d','playerMoved');assert.equal(p.x,26*32+16);
 assert.deepEqual(errors,[]);success=true;console.log(JSON.stringify({gates:4,mathildeBadgeRequired:true,mathildeChallengeAfterHoze:true,gwennRefusalBeforeHoze:true,gwennChallengeAfterHoze:true,realBlockedMovement:true,openingAnimation:true,reconnectUnlocked:true,expeditionUnaffected:true,viewports:3,errors,output}));
}finally{if(!success&&page)await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});await browser?.close();cleanup();await new Promise(r=>io.close(r));await new Promise(r=>setTimeout(r,250));for(const f of users)await dbPool.execute('DELETE FROM users WHERE id=?',[f.user.id]);await dbPool.end();}})().catch(e=>{console.error(e.stack);process.exitCode=1});
