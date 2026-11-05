// Existing compiled client, authoritative movement and disposable SQL accounts.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID,createHash}=require('node:crypto');
if(process.env.DB_TEST_NAME!=='explorakit_test')throw Error('Dedicated test database required');
process.env.DB_NAME='explorakit_test';process.env.NODE_ENV='test';
const {dbPool:db}=require('../server/config/database'),teams=require('../server/persistence/teamRepository');
const handlers=require('../server/realtime/handlers/superTournamentHandlers'),originalCreate=handlers.createHandlers,contexts=new Map();
handlers.createHandlers=options=>{contexts.set(options.userId,options);return originalCreate(options);};
const engine=process.env.PRESENTATION_BROWSER||'chromium',dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-first-cycle-cash-dist';
const out=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-lobby-collisions-'+engine;
fs.mkdirSync(out,{recursive:true});fs.rmSync(path.join(out,'report.json'),{force:true});
const express=require('express'),app=express(),server=http.createServer(app),io=new(require('socket.io').Server)(server);
app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));
app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));
io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
const lobby='super_tournament_lobby',errors=[],checks=[],views=[];
let browser,page,id,base,success=false;
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(v?.socket?.connected&&v.players[v.socket.id]&&!v.mapLoading&&v.renderedMap===v.map){window.v=v;return true;}});}
async function command(event,data={}){return page.evaluate(({event,data})=>new Promise((resolve,reject)=>v.socket.timeout(10000).emit(event,data,(e,r)=>e?reject(e):resolve(r))),{event,data});}
async function locate(x,y){
 await contexts.get(id).travel({map:lobby,x:x*32+16,y:y*32+16});await ready();
 await page.waitForFunction(({x,y})=>v.map==='super_tournament_lobby'&&v.players[v.socket.id].x===x*32+16&&v.players[v.socket.id].y===y*32+16,{x,y});
}
async function move(action){await page.evaluate(action=>v.socket.emit('playerAction',action),action);await page.waitForTimeout(180);}
async function blocked(x,y,action,label){
 await locate(x,y);await move(action);
 const p=contexts.get(id).getPlayer();assert.equal(p.currentmap,lobby);assert.equal(p.x,x*32+16,label);assert.equal(p.y,y*32+16,label);
 assert.equal(p.isMoving,false);assert.equal(p.direction,{move_s:'down',move_q:'left',move_d:'right'}[action]);
 assert.deepEqual(await page.evaluate(()=>({x:v.players[v.socket.id].x,y:v.players[v.socket.id].y})),{x:p.x,y:p.y});
 checks.push(label);
}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');base='http://127.0.0.1:'+server.address().port;
 const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'lobby_coll_'+randomUUID().slice(0,12),password:randomUUID(),starterId:7})});
 assert.equal(r.status,201);const account=await r.json();id=account.user.id;
 await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,'adventure_opening','complete') ON DUPLICATE KEY UPDATE flag_value='complete'",[id]);
 await require('../server/persistence/patchNotesRepository').acknowledge(id,require('../data/game/latest_patch.json').version);
 await db.execute("INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,'super_tournament_pass',1)",[id]);
 // A position that was walkable before the patch must recover onto the floor.
 await db.execute("UPDATE users SET map=?,x=176,y=528 WHERE id=?",[lobby,id]);
 const initialTeam=JSON.stringify(await teams.loadEquipe(id));
 browser=await require('playwright')[engine].launch({headless:true,...(engine==='chromium'?{args:['--no-sandbox']}: {})});
 const context=await browser.newContext({viewport:{width:393,height:852},isMobile:true,hasTouch:true,serviceWorkers:'block'});
 await context.addInitScript(a=>localStorage.setItem('explorakit.user',JSON.stringify(a)),{...account.user,token:account.token});
 page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/game');await ready();
 await page.waitForFunction(()=>v.map==='super_tournament_lobby'&&v.players[v.socket.id].x===176&&v.players[v.socket.id].y===496);
 await page.evaluate(()=>v.updatePreferences({...v.preferences,masterVolume:0}));checks.push('old-wall-position-recovers-to-adjacent-floor');
 for(const[width,height]of[[393,852],[1365,900]]){
  await page.setViewportSize({width,height});
  for(const x of[5,10,17,22])await blocked(x,15,'move_s','south-wall-'+x+'-'+width);
  await blocked(12,16,'move_q','left-door-post-'+width);await blocked(15,16,'move_d','right-door-post-'+width);
  await blocked(2,13,'move_s','left-flower-pot-'+width);await blocked(25,13,'move_s','right-flower-pot-'+width);
  await locate(10,15);await page.waitForTimeout(300);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:path.join(out,'south-wall-'+width+'.png')});views.push({width,height});
  await locate(23,15);await page.evaluate(()=>v.socket.emit('Space'));await page.locator('[data-safari-depart]').waitFor();
  await page.locator('.safari-travel header button').click();checks.push('safari-guide-reachable-'+width);
  await locate(22,8);await page.evaluate(()=>v.socket.emit('Space'));await page.locator('[data-tournament-view="ranking"]').waitFor();
  await page.locator('.tournament-panel .close').click();checks.push('ranking-board-reachable-'+width);
  await locate(13,15);for(let i=0;i<3;i++)await move('move_s');
  await page.waitForFunction(()=>v.map==='start'&&!v.mapLoading);checks.push('central-exit-works-'+width);
  await locate(13,8);await page.evaluate(()=>v.socket.emit('Space'));await page.locator('[data-tournament-view="entry"]').waitFor();
  await page.locator('.tournament-panel footer .primary').click();await page.waitForFunction(()=>v.map==='super_tournament_sas'&&!v.mapLoading&&!v.flight);
  assert.equal((await command('superTournament:abandon')).success,true);await ready();checks.push('registration-and-return-still-work-'+width);
 }
 await page.reload();await ready();assert.equal(await page.evaluate(()=>v.map),lobby);
 assert.equal(JSON.stringify(await teams.loadEquipe(id)),initialTeam);assert.deepEqual(errors,[]);success=true;
}catch(e){console.error(e.stack);if(page&&!page.isClosed())await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});process.exitCode=1;}
finally{
 await browser?.close();require('../server/realtime/whitepeakClub').getClub(io).close();await new Promise(r=>io.close(r));
 await require('../server/realtime/accountConnection').waitForAccountConnections(io);if(id)await db.execute('DELETE FROM users WHERE id=?',[id]);await db.end();
 const report={success,engine,views,checks,errors,existingClientReused:true,teamPreserved:success,buildIndexSha256:createHash('sha256').update(fs.readFileSync(path.join(dist,'index.html'))).digest('hex')};
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}})();
