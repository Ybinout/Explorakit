// Private SQL/Socket.IO integration: authoritative fixture victories only,
// never a public test endpoint or a real player's account.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID,createHash}=require('node:crypto');
if(process.env.DB_TEST_NAME!=='explorakit_test')throw Error('Dedicated test database required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';process.env.BATTLE_DELAY_SCALE='0';
const express=require('express'),{Server}=require('socket.io'),playwright=require('playwright');
const {dbPool:db}=require('../server/config/database'),teams=require('../server/persistence/teamRepository'),factory=require('../server/game/drift/pokemonFactory');
const repo=require('../server/persistence/superTournamentRepository'),content=require('../server/game/superTournament/content'),codec=require('../server/game/drift/checkpointCodec');
const handlers=require('../server/realtime/handlers/superTournamentHandlers'),originalCreate=handlers.createHandlers,controllers=new Map();
handlers.createHandlers=options=>{const h=originalCreate(options);h.controller.random=()=>.99;controllers.set(options.userId,h.controller);return h;};
const engine=process.env.PRESENTATION_BROWSER||'chromium';if(!['chromium','webkit'].includes(engine))throw Error('Unsupported browser');
const dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-tournament-cash-dist',out=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-tournament-cash-browser-'+engine;fs.mkdirSync(out,{recursive:true});fs.rmSync(path.join(out,'report.json'),{force:true});
const app=express(),server=http.createServer(app),io=new Server(server);
app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));
io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
let browser,page,id,success=false,releaseStale;const errors=[],views=[],payments=[];
const controller=()=>controllers.get(id);
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(v?.socket?.connected&&v.players[v.socket.id]&&!v.mapLoading&&v.renderedMap===v.map){window.v=v;return true;}});}
async function command(event,data){return page.evaluate(({event,data})=>new Promise((resolve,reject)=>v.socket.timeout(6400).emit(event,data,(e,r)=>e?reject(e):resolve(r))),{event,data});}
async function walk(key,n){for(let i=0;i<n;i++){await page.evaluate(key=>v.socket.emit('playerAction',key),key);await page.waitForTimeout(140);}await page.waitForTimeout(300);}
async function skip(){const offerId=controller().run.reward.id;await page.locator('[data-reward-skip]').click();await page.locator('.tournament-reward-panel').waitFor({state:'hidden'});assert.equal((await command('superTournament:reward',{offerId,skip:true})).success,false);}
async function win(amount,balance){
 await controller().execute(()=>controller().atomic(()=>{const c=controller(),b=c.run.battle;for(const p of b.b.equipe.pokemons)p.currentHp=0;b.prune();b.checkEnd();c.reconcile();}));
 await page.waitForFunction(balance=>v.progressionState.money===balance,balance);
 if(releaseStale){releaseStale();releaseStale=null;await page.evaluate(()=>window.staleProgress);assert.equal(await page.evaluate(()=>v.progressionState.money),balance);}
 await page.locator('[data-battle-result-continue]').waitFor();assert.equal(await page.locator('.tournament-reward-panel').count(),0);
 assert.equal(await page.evaluate(()=>v.battleResult.money),amount);
 await page.locator('[data-battle-result-continue]').click();await page.locator('[data-tournament-cash]').waitFor();
 const text=(await page.locator('[data-tournament-cash]').innerText()).replace(/\s/g,'');assert(text.includes('+'+String(amount)+'₽'));assert(text.includes(String(balance)+'₽'));
 const [[wallet]]=await db.execute('SELECT money FROM users WHERE id=?',[id]);assert.equal(Number(wallet.money),balance);
 assert.equal(controller().run.player.money,0);payments.push({room:controller().run.cleared,amount,balance});
}
async function layout(selector,kind){
 for(const [width,height]of [[320,480],[393,852],[844,390],[1536,680]])for(const mode of ['light','dark']){
  await page.setViewportSize({width,height});await page.evaluate(mode=>v.updatePreferences({...v.preferences,themeMode:mode}),mode);
  await page.waitForTimeout(200); // WebKit updates dynamic viewport units on the next frame.
  await page.locator(selector).evaluate(n=>{n.scrollTop=0;});
  const box=await page.locator(selector).evaluate(n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,overflow:n.scrollWidth>n.clientWidth+1};});
  assert(box.left>=-1&&box.right<=width+1&&box.top>=-1&&box.bottom<=height+1&&!box.overflow,JSON.stringify({kind,width,height,mode,box}));
  const footer=page.locator(kind==='entry'?'.tournament-panel footer':'.tournament-reward-panel footer');
  assert(await footer.evaluate(n=>{const r=n.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight+1;}));
  assert(await footer.locator('button').first().evaluate(n=>n.getBoundingClientRect().height>=44));
  await page.screenshot({path:path.join(out,`${kind}-${width}-${mode}.png`)});views.push({kind,width,height,mode});
 }
 await page.setViewportSize({width:393,height:852});
}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 const response=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'tcash_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(response.status,201);const u=await response.json();id=u.user.id;
 await teams.editEquipe(id,{pokemons:[9,94,212,248,445,121].map(species=>factory.create(species,100,true))});
 for(const [key,value]of [['adventure_opening','complete'],['mirror_stage','complete'],['super_tournament_invited','true']])await db.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)',[id,key,value]);
 await db.execute('INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,?,1)',[id,content.PASS]);await db.execute("UPDATE users SET map='super_tournament_lobby',x=448,y=304,money=0 WHERE id=?",[id]);
 browser=await playwright[engine].launch({headless:true,...(engine==='chromium'?{args:['--no-sandbox']}: {})});
 // Block the worker in this recipe so WebKit routes the deliberately delayed
 // progress request through Playwright. PWA behavior is outside this check.
 const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true,serviceWorkers:'block'});await context.addInitScript(u=>localStorage.setItem('explorakit.user',JSON.stringify(u)),{...u.user,token:u.token});
 page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/game');await ready();
 await page.evaluate(()=>{v.updatePreferences({...v.preferences,animationsEnabled:false,masterVolume:0});v.socket.emit('Space');});await page.locator('.tournament-panel').waitFor();
 assert.match((await page.locator('.tournament-prizes').innerText()).replace(/\s/g,''),/254320₽/);assert.match(await page.locator('.rules').innerText(),/Aucune XP/);assert.match((await page.locator('.tournament-prizes').innerText()).replace(/\s/g,''),/508640₽audeuxième,puis762960₽autroisième/);
 await layout('.tournament-panel','entry');await page.locator('.tournament-panel footer .primary').click();await page.waitForFunction(()=>v.map==='super_tournament_sas'&&!v.flight);
 const original=codec.encode(await teams.loadEquipe(id));await walk('move_z',11);await ready();await walk('move_z',6);await page.evaluate(()=>v.socket.emit('Space'));await page.waitForFunction(()=>v.battle&&v.$refs.battleOverlay.canChooseAction);
 // An older progress response must not erase the newer committed balance.
 let held;const heldResponse=new Promise(r=>{held=r;});await page.route('**/api/users/'+id+'/progress',async route=>{
  const response=await route.fetch();const body=await response.body();held();await new Promise(r=>{releaseStale=r;});await route.fulfill({response,body});
 },{times:1});
 await page.evaluate(()=>{window.staleProgress=v.loadProgressionState();});
 let heldTimer;try{await Promise.race([heldResponse,new Promise((_,reject)=>{heldTimer=setTimeout(()=>reject(Error('Progress interception timed out')),15000);})]);}finally{clearTimeout(heldTimer);}
 await win(5086,5086);assert.equal(controller().run.cash.earned,5086);
 const firstOffer=controller().run.reward.id;await page.reload();await ready();await page.locator('[data-tournament-cash]').waitFor();assert.equal(controller().run.reward.id,firstOffer);assert.equal(controller().run.cash.earned,5086);await page.waitForFunction(()=>v.progressionState.money===5086);
 await layout('.tournament-reward-panel','reward');await skip();
 for(const [room,amount,balance]of [[15,71210,76296],[16,10172,86468]]){
  await controller().execute(()=>controller().atomic(()=>{const c=controller();c.run.room=room;c.run.cleared=room;c.run.phase='ready';c.startBattle();}));
  await page.waitForFunction(()=>v.battle&&v.$refs.battleOverlay.canChooseAction);await win(amount,balance);
  if(room===15){assert.match((await page.locator('[data-tournament-cash]').innerText()).replace(/\s/g,''),/Bonusdecycleinclus:50864₽/);await page.screenshot({path:path.join(out,'cycle-bonus.png')});}
  await skip();
 }
 assert.equal((await command('superTournament:abandon')).success,true);await ready();assert.equal((await repo.load(id)).run,null);
 const [[wallet]]=await db.execute('SELECT money FROM users WHERE id=?',[id]);assert.equal(Number(wallet.money),86468);assert.deepEqual(codec.encode(await teams.loadEquipe(id)),original);
 await page.reload();await ready();await page.waitForFunction(()=>v.progressionState.money===86468);assert.equal(errors.length,0);success=true;
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({success,engine,buildIndexSha256:createHash('sha256').update(fs.readFileSync(path.join(dist,'index.html'))).digest('hex'),views,payments,staleProgressResponse:true,reconnectNoDoubleCredit:true,adventureTeamAndXpPreserved:true,abandonKeepsMoney:true,errors},null,2));
}catch(e){console.error(e.stack);try{console.error(await page?.evaluate(()=>({map:window.v?.map,phase:window.v?.superTournament?.phase,text:document.body.innerText.slice(-1500)})));await page?.screenshot({path:path.join(out,'failure.png')});}catch{}process.exitCode=1;}
finally{releaseStale?.();await browser?.close();await new Promise(r=>io.close(r));await require('../server/realtime/accountConnection').waitForAccountConnections(io);if(id)await db.execute('DELETE FROM users WHERE id=?',[id]);await db.end();console.log(JSON.stringify({success,errors,testUserDeleted:true}));}})();
