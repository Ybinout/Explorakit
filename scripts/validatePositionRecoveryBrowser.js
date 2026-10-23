// Real authenticated sockets, SQL persistence and rendered options, test DB only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(!/test/i.test(process.env.DB_TEST_NAME||'')) throw Error('Dedicated test database required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';
const express=require('express'),{Server}=require('socket.io'),{chromium}=require('playwright'),{dbPool}=require('../server/config/database');
const dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-unstuck-dist',output='/tmp/riftmon-unstuck-browser';fs.mkdirSync(output,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server);
app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));
io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
let checkpoints=0;const store=require('../server/game/drift/lobbyStore').createLobbyStore();
const cleanup=require('../server/realtime/driftLobbyHandler').registerDriftLobbies(io,{store,checkpointRepository:{async save(){checkpoints++;}},runtimeOptions:{paceMs:0}});
let browser,page,user,base,success=false;const errors=[];
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(!v?.socket?.connected||v.mapLoading||v.renderedMap!==v.map||!v.players[v.socket.id])return false;window.recoveryVm=v;return true;});}
const position=()=>page.evaluate(()=>{const p=window.recoveryVm.players[window.recoveryVm.socket.id];return {map:p.currentmap,x:p.x,y:p.y};});
const command=(name,data={})=>page.evaluate(({name,data})=>new Promise((resolve,reject)=>window.recoveryVm.socket.timeout(6000).emit(name,data,(error,result)=>error?reject(error):resolve(result))),{name,data});
async function options(){await page.locator('.menu-toggle-btn').click();await page.locator('[data-menu-action="options"]').click();await page.locator('[data-debug-options] summary').click();}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}`;
 const response=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'recovery_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(response.status,201);user=await response.json();
 await dbPool.execute('UPDATE users SET map="route5",x=9999,y=-500,repel_steps=100 WHERE id=?',[user.user.id]);
 const before=await require('../server/persistence/teamRepository').loadEquipe(user.user.id);
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true});
 await context.addInitScript(s=>{if(location.protocol==='http:')localStorage.setItem('explorakit.user',JSON.stringify(s));},{...user.user,token:user.token});
 page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/game',{waitUntil:'networkidle'});await ready();const initial=await position();assert.equal(initial.map,'route5');assert(initial.x>=16&&initial.x<896&&initial.y>=16&&initial.y<640);
 await options();assert(await page.locator('[data-recover-position]').isEnabled());
 for(const [width,height]of [[320,568],[393,852],[1365,900]]){
  await page.setViewportSize({width,height});await page.locator('[data-recover-position]').scrollIntoViewIfNeeded();
  const bounds=await page.locator('[data-recover-position]').boundingBox();assert(bounds.width>100&&bounds.height>=44);assert(bounds.x>=0&&bounds.x+bounds.width<=width+1);
  await page.screenshot({path:path.join(output,`options-${width}.png`)});
 }
 await page.locator('[data-recover-position]').click();await page.waitForFunction(()=>!!window.recoveryVm.positionRecoveryNotice&&!window.recoveryVm.positionRecoveryBusy);await ready();
 assert.match(await page.locator('.recovery-feedback').innerText(),/accessible/);const moved=await position();assert.equal(moved.map,initial.map);assert(Math.hypot(moved.x-initial.x,moved.y-initial.y)<=96);
 const [[saved]]=await dbPool.execute('SELECT map,x,y,repel_steps FROM users WHERE id=?',[user.user.id]);assert.deepEqual({map:saved.map,x:saved.x,y:saved.y},moved);assert.equal(saved.repel_steps,100);
 assert.equal((await command('recoverPosition',{map:'ville5',x:1,y:1})).success,false,'cooldown rejects spam');assert.deepEqual(await position(),moved);
 const after=await require('../server/persistence/teamRepository').loadEquipe(user.user.id);assert.deepEqual(after.pokemons.map(p=>[p.uuid,p.currentHp,p.experience,p.movePp]),before.pokemons.map(p=>[p.uuid,p.currentHp,p.experience,p.movePp]));
 await page.reload({waitUntil:'networkidle'});await ready();assert.deepEqual(await position(),moved,'reload preserves corrected coordinates');
 await options();await page.evaluate(()=>window.recoveryVm.socket.disconnect());await page.locator('[data-recover-position]').click();assert.match(await page.locator('.recovery-feedback').innerText(),/Connexion/);
 await page.goto(base+'/colosseum',{waitUntil:'networkidle'});await page.locator('[data-colosseum-start]:enabled').click();await page.locator('[data-starter-choice]').first().click();await page.locator('.starter-backdrop').waitFor({state:'hidden'});await ready();
 const p=cleanup.runtime.playerFor(user.user),timer=p.run.endsAt,bag=JSON.stringify(p.items),money=p.money,team=p.equipe.pokemons.map(p=>p.uuid),oldCheckpoints=checkpoints;
 await options();await page.locator('[data-recover-position]').click();await page.waitForFunction(()=>!!window.recoveryVm.positionRecoveryNotice&&!window.recoveryVm.positionRecoveryBusy);assert.match(await page.locator('.recovery-feedback').innerText(),/accessible/);
 assert.equal(p.run.endsAt,timer);assert.equal(JSON.stringify(p.items),bag);assert.equal(p.money,money);assert.deepEqual(p.equipe.pokemons.map(p=>p.uuid),team);assert(checkpoints>oldCheckpoints);
 p.inbattle=true;assert.equal((await command('recoverPosition')).success,false);p.inbattle=false;
 assert.deepEqual(errors,[]);success=true;console.log(JSON.stringify({invalidLoginRepaired:true,nearbyRecovery:true,sqlSaved:true,reconnectStable:true,teamAndRepelPreserved:true,colosseumCheckpoint:true,forgedPayloadAndCombatRejected:true,viewports:3,errors,output}));
}finally{
 if(!success&&page)await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});
 await browser?.close();cleanup();await new Promise(r=>io.close(r));await new Promise(r=>setTimeout(r,250));if(user)await dbPool.execute('DELETE FROM users WHERE id=?',[user.user.id]);await dbPool.end();
}})().catch(e=>{console.error(e.stack);process.exitCode=1});
