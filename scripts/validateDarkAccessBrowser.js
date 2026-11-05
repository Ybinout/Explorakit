// Authenticated compiled-client recipe; disposable accounts in the test DB only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID,createHash}=require('node:crypto');
if(process.env.DB_TEST_NAME!=='explorakit_test')throw Error('Dedicated test database required');
process.env.DB_NAME='explorakit_test';process.env.NODE_ENV='test';
const {dbPool:db}=require('../server/config/database'),repo=require('../server/persistence/darkContinentRepository');
const dc=require('../server/game/world/darkContinent'),patch=require('../server/persistence/patchNotesRepository');
const engine=process.env.PRESENTATION_BROWSER||'chromium',dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-dark-access-dist';
const out=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-dark-access-'+engine;
fs.mkdirSync(out,{recursive:true});fs.rmSync(path.join(out,'report.json'),{force:true});
const express=require('express'),app=express(),server=http.createServer(app),io=new(require('socket.io').Server)(server);
app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));
app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));
io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
let browser,page,peer,base,success=false;const accounts=[],views=[],checks=[],errors=[];
async function account(rooms,money=1000000){
 const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'dark_access_'+randomUUID().slice(0,12),password:randomUUID(),starterId:7})});
 assert.equal(r.status,201);const a=await r.json();accounts.push(a);
 await db.execute("UPDATE users SET map='super_tournament_lobby',x=448,y=496,money=? WHERE id=?",[money,a.user.id]);
 await db.execute('INSERT INTO super_tournament_profiles(user_id,best_rooms) VALUES(?,?)',[a.user.id,rooms]);
 await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,'adventure_opening','complete') ON DUPLICATE KEY UPDATE flag_value='complete'",[a.user.id]);
 await patch.acknowledge(a.user.id,require('../data/game/latest_patch.json').version);return a;
}
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(v?.socket?.connected&&v.players[v.socket.id]&&!v.mapLoading&&v.renderedMap===v.map){window.v=v;return true;}});}
async function command(event,data={}){return page.evaluate(({event,data})=>new Promise((resolve,reject)=>v.socket.timeout(10000).emit(event,data,(e,r)=>e?reject(e):resolve(r))),{event,data});}
async function invitation(){
 await page.locator('[data-dark-claim]').waitFor();
 assert.match(await page.locator('.dark-continent-body').innerText(),/deux paliers/);
 assert.match(await page.locator('[data-dark-claim]').innerText(),/1[ \u202f]000[ \u202f]000/);
 assert(!/2[ \u202f]000[ \u202f]000|trois cycles/.test(await page.locator('.dark-continent-panel').innerText()));
 assert(await page.evaluate(()=>v.pnjs.some(n=>n.name==='dark_scout')));
}
async function capture(label){
 for(const[width,height]of[[393,852],[1536,680]])for(const mode of['light','dark']){
  await page.setViewportSize({width,height});await page.evaluate(mode=>v.updatePreferences({...v.preferences,themeMode:mode}),mode);
  await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(150);
  const b=await page.locator('[data-dark-claim]').boundingBox();
  assert(b.width>=44&&b.height>=44&&b.x>=0&&b.x+b.width<=width+1&&b.y>=0&&b.y+b.height<=height+1,JSON.stringify({label,width,b}));
  assert(await page.locator('.dark-continent-panel').evaluate(n=>n.scrollWidth<=n.clientWidth+1));
  await page.screenshot({path:path.join(out,`${label}-${width}-${mode}.png`)});views.push({label,width,height,mode});
 }
}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');base='http://127.0.0.1:'+server.address().port;
 const below=await account(31),exact=await account(32),legacy=await account(48,999999);
 const connect=require('../vue-explorakit/node_modules/socket.io-client').io;
 peer=connect(base,{auth:{token:below.token},transports:['websocket'],forceNew:true});await once(peer,'connect');
 for(let i=0;i<250&&!io.of('/').sockets.get(peer.id)?.listeners('dark:claim').length;i++)await new Promise(r=>setTimeout(r,20));
 assert(io.of('/').sockets.get(peer.id)?.listeners('dark:claim').length,'Account initialization finished');
 const refused=await new Promise((resolve,reject)=>peer.timeout(10000).emit('dark:claim',{price:1000000},(e,r)=>e?reject(e):resolve(r)));
 assert.equal(refused.success,false);assert.equal((await repo.loadState(below.user.id)).owned,false);checks.push('31-rooms-not-eligible');
 browser=await require('playwright')[engine].launch({headless:true,...(engine==='chromium'?{args:['--no-sandbox']}: {})});
 for(const[a,label]of[[exact,'32-rooms'],[legacy,'legacy-48-rooms']]){
  const context=await browser.newContext({viewport:{width:393,height:852},isMobile:true,hasTouch:true,serviceWorkers:'block'});
  await context.addInitScript(a=>localStorage.setItem('explorakit.user',JSON.stringify(a)),{...a.user,token:a.token});
  page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/game');await ready();
  await page.evaluate(()=>v.updatePreferences({...v.preferences,masterVolume:0}));await invitation();await capture(label);
  // Declining, leaving the UI and reconnecting must not consume the invitation.
  await page.locator('.dark-continent-panel header button').click();await page.evaluate(()=>v.socket.emit('Space'));
  await invitation();await page.reload();await ready();await invitation();checks.push(label+'-scout-persists-across-dismissal-and-reconnect');
  if(a===legacy){
   assert(await page.locator('[data-dark-claim]').isDisabled());
   const result=await command('dark:claim',{price:1000000});assert.equal(result.success,false);assert.match(result.message,/1[ \u202f]000[ \u202f]000/);
   assert.equal((await repo.loadState(a.user.id)).money,999999);checks.push('insufficient-money-keeps-card-and-wallet-unchanged');
  }else{
   assert(!(await page.locator('[data-dark-claim]').isDisabled()));
   const stale=await command('dark:claim',{price:2000000});assert.equal(stale.success,false);assert.equal((await repo.loadState(a.user.id)).money,1000000);
   await page.locator('[data-dark-claim]').click();await page.waitForFunction(()=>!v.darkBusy&&!v.darkPanel);
   const state=await repo.loadState(a.user.id);assert(state.owned);assert.equal(state.money,0);
   assert(!await page.evaluate(()=>v.pnjs.some(n=>n.name==='dark_scout')));
   await page.reload();await ready();assert(!await page.evaluate(()=>v.pnjs.some(n=>n.name==='dark_scout')));
   const retry=await repo.grantCard(a.user.id);assert.equal(retry.charged,0);assert.equal(retry.money,0);checks.push('card-bought-once-for-exactly-one-million');
  }
  await context.close();
 }
 assert.deepEqual(errors,[]);success=true;
}catch(e){console.error(e.stack);if(page&&!page.isClosed())await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});process.exitCode=1;}
finally{
 peer?.close();await browser?.close();require('../server/realtime/whitepeakClub').getClub(io).close();
 await new Promise(r=>io.close(r));await require('../server/realtime/accountConnection').waitForAccountConnections(io);
 for(const a of accounts)await db.execute('DELETE FROM users WHERE id=?',[a.user.id]);await db.end();
 const report={success,engine,requiredRooms:32,price:1000000,views,checks,errors,buildIndexSha256:createHash('sha256').update(fs.readFileSync(path.join(dist,'index.html'))).digest('hex')};
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}})();
