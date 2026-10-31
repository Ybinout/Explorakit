// Private SQL/Socket.IO integration: authoritative fixture victories only,
// never a public test endpoint or a real player's account.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(process.env.DB_TEST_NAME!=='explorakit_test')throw Error('Dedicated test database required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';process.env.BATTLE_DELAY_SCALE='0';
const express=require('express'),{Server}=require('socket.io'),playwright=require('playwright');
const {dbPool:db}=require('../server/config/database'),teams=require('../server/persistence/teamRepository'),factory=require('../server/game/drift/pokemonFactory');
const repo=require('../server/persistence/superTournamentRepository'),content=require('../server/game/superTournament/content'),codec=require('../server/game/drift/checkpointCodec');
const handlers=require('../server/realtime/handlers/superTournamentHandlers'),originalCreate=handlers.createHandlers,controllers=new Map();
handlers.createHandlers=options=>{const h=originalCreate(options);h.controller.random=()=>.99;controllers.set(options.userId,h.controller);return h;};
const engine=process.env.PRESENTATION_BROWSER||'chromium';if(!['chromium','webkit'].includes(engine))throw Error('Unsupported browser');
const dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-tournament-augments-dist',out=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-tournament-augments-browser-'+engine;fs.mkdirSync(out,{recursive:true});fs.rmSync(path.join(out,'report.json'),{force:true});
const app=express(),server=http.createServer(app),io=new Server(server);
app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));
io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
let browser,page,id,success=false,releaseStale;const errors=[],views=[],claims=[];
const controller=()=>controllers.get(id);
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(v?.socket?.connected&&v.players[v.socket.id]&&!v.mapLoading&&v.renderedMap===v.map){window.v=v;return true;}});}
async function command(event,data){return page.evaluate(({event,data})=>new Promise((resolve,reject)=>v.socket.timeout(8000).emit(event,data,(e,r)=>e?reject(e):resolve(r))),{event,data});}
async function walk(key,n){for(let i=0;i<n;i++){await page.evaluate(key=>v.socket.emit('playerAction',key),key);await page.waitForTimeout(140);}await page.waitForTimeout(300);}

function rngFor(key){const values=key==='prize_mega_candy'?[0]:key==='prize_super_candy'?[.01]:[.1,key==='prize_money_10k'?.1:key==='prize_money_25k'?.7:.95];return()=>values.length?values.shift():.4;}
async function seed(key,room){
 await controller().execute(()=>controller().atomic(()=>{const r=controller().run;r.room=room-1;r.cleared=room;r.phase='reward';r.reward=require('../server/game/superTournament/rewards').createOffer(r.player.equipe.pokemons,room,rngFor(key));assert(r.reward.cards.includes(key));}));
 await page.locator(`[data-reward-card="${key}"]`).waitFor();
}
async function layout(key){
 for(const [width,height]of [[320,480],[393,852],[844,390],[1536,680]])for(const mode of ['light','dark']){
  await page.setViewportSize({width,height});await page.evaluate(mode=>v.updatePreferences({...v.preferences,themeMode:mode}),mode);await page.waitForTimeout(200);
  await page.locator('.reward-content').evaluate(n=>{n.scrollTop=0;});
  const box=await page.locator('.tournament-reward-panel').evaluate(n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,overflow:n.scrollWidth>n.clientWidth+1};});
  assert(box.left>=-1&&box.right<=width+1&&box.top>=-1&&box.bottom<=height+1&&!box.overflow,JSON.stringify({key,width,height,mode,box}));
  assert(await page.locator('[data-reward-confirm]').isEnabled());assert(await page.locator('[data-reward-confirm]').evaluate(n=>{const r=n.getBoundingClientRect();return r.height>=44&&r.top>=0&&r.bottom<=innerHeight+1;}));
  assert.equal(await page.locator('.reward-team').count(),0);
  await page.waitForFunction(()=>{const n=document.querySelector('.tournament-reward-panel');return n&&getComputedStyle(n.querySelector('.reward-account p')).color===getComputedStyle(n).color;},null,{timeout:3000});
  await page.screenshot({path:path.join(out,`${key}-${width}-${mode}.png`)});views.push({key,width,height,mode});
 }
 await page.setViewportSize({width:393,height:852});
}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 const response=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'aug_ui_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(response.status,201);const u=await response.json();id=u.user.id;
 await teams.editEquipe(id,{pokemons:[9,94,212,248,445,121].map(species=>factory.create(species,100,true))});
 for(const [key,value]of [['adventure_opening','complete'],['mirror_stage','complete'],['super_tournament_invited','true']])await db.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)',[id,key,value]);
 await db.execute('INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,?,1)',[id,content.PASS]);await db.execute("UPDATE users SET map='super_tournament_lobby',x=448,y=304,money=0 WHERE id=?",[id]);
 browser=await playwright[engine].launch({headless:true,...(engine==='chromium'?{args:['--no-sandbox']}: {})});const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true,serviceWorkers:'block'});
 await context.addInitScript(u=>localStorage.setItem('explorakit.user',JSON.stringify(u)),{...u.user,token:u.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/game');await ready();await page.evaluate(()=>{v.updatePreferences({...v.preferences,animationsEnabled:false,masterVolume:0});v.socket.emit('Space');});await page.locator('.tournament-panel').waitFor();assert.match(await page.locator('.rules').innerText(),/Méga Bonbons ultra rares/);
 await page.locator('.tournament-panel footer .primary').click();await page.waitForFunction(()=>v.map==='super_tournament_sas'&&!v.flight);const original=codec.encode(await teams.loadEquipe(id));
 await walk('move_z',11);await ready();await walk('move_z',6);await page.evaluate(()=>v.socket.emit('Space'));await page.waitForFunction(()=>v.battle&&v.$refs.battleOverlay.canChooseAction);
 await controller().execute(()=>controller().atomic(()=>{const c=controller(),b=c.run.battle;c.run.player.equipe.pokemons[0].currentHp-=30;c.run.player.equipe.pokemons[0].movePp[0]=0;c.run.player.equipe.pokemons[1].currentHp=0;for(const p of b.b.equipe.pokemons)p.currentHp=0;b.prune();b.checkEnd();c.reconcile();}));
 await page.locator('[data-battle-result-continue]').waitFor();await page.locator('[data-battle-result-continue]').click();await page.locator('.tournament-reward-panel').waitFor();await page.waitForFunction(()=>v.progressionState.money===10000);
 let balance=10000;const itemStocks={};
 for(const [key,room,money,item]of [['prize_money_10k',1,10000,null],['prize_money_25k',1,25000,null],['prize_money_50k',17,100000,null],['prize_super_candy',17,0,'rare_candy'],['prize_mega_candy',17,0,'mega_candy']]){
  await seed(key,room);const offerId=controller().run.reward.id,party=codec.encode(controller().run.player.equipe);
  if(item){await page.reload();await ready();await page.locator(`[data-reward-card="${key}"]`).waitFor();assert.equal(controller().run.reward.id,offerId);}
  assert.equal((await command('superTournament:reward',{offerId:'foreign',cardKey:key,quantity:99})).success,false);
  await page.locator(`[data-reward-card="${key}"]`).click();await page.locator('[data-reward-account]').waitFor();assert.equal(await page.locator('.reward-team').count(),0);assert.match(await page.locator('[data-reward-confirm]').innerText(),/Récupérer/);
  if(key==='prize_money_10k'||item)await layout(key);
  if(key==='prize_super_candy'){
   let held;const waiting=new Promise(r=>{held=r;});await page.route('**/api/users/'+id+'/items',async route=>{const response=await route.fetch(),body=await response.body();held();await new Promise(r=>{releaseStale=r;});await route.fulfill({response,body});},{times:1});
   await page.evaluate(()=>{window.staleBag=v.loadBagItems();});let timer;try{await Promise.race([waiting,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Bag interception timed out')),15000);})]);}finally{clearTimeout(timer);}
  }
  await page.locator('[data-reward-confirm]').click();await page.locator('.tournament-reward-panel').waitFor({state:'hidden'});balance+=money;
  await page.waitForFunction(balance=>v.progressionState.money===balance,balance);
  if(item){await page.waitForFunction(item=>v.bagItems.some(i=>i.key===item&&i.quantity===1),item);itemStocks[item]=1;const uuid=controller().run.player.equipe.pokemons[0].uuid;assert.equal((await command('useTrainingItem',{itemKey:item,pokemonUuid:uuid})).success,false);}
  if(releaseStale){releaseStale();releaseStale=null;await page.evaluate(()=>window.staleBag);assert.equal(await page.evaluate(item=>v.bagItems.find(i=>i.key===item)?.quantity,item),1,'A stale bag response erased the newly granted candy');}
  assert.deepEqual(codec.encode(controller().run.player.equipe),party);assert.equal((await command('superTournament:reward',{offerId,cardKey:key})).success,false);
  const [[wallet]]=await db.execute('SELECT money FROM users WHERE id=?',[id]);assert.equal(Number(wallet.money),balance);claims.push({key,room,money,item,balance});
 }
 assert.equal(balance,145000);assert.equal(controller().run.cash.earned,145000);assert.equal((await command('superTournament:abandon')).success,true);await ready();assert.deepEqual(codec.encode(await teams.loadEquipe(id)),original);
 await page.reload();await ready();await page.waitForFunction(()=>v.progressionState.money===145000);await page.evaluate(()=>v.loadBagItems());for(const item of ['rare_candy','mega_candy'])assert.equal(await page.evaluate(item=>v.bagItems.find(i=>i.key===item)?.quantity,item),1);
 assert.equal(errors.length,0);success=true;fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({success,engine,views,claims,itemStocks,staleInventoryResponseIgnored:true,reconnectStable:true,replayRejected:true,bagUseBlockedDuringRun:true,noHealingOrXp:true,adventureTeamPreserved:true,keptAfterAbandon:true,errors},null,2));
}catch(e){console.error(e.stack);try{console.error(await page?.evaluate(()=>({map:window.v?.map,phase:window.v?.superTournament?.phase,text:document.body.innerText.slice(-1800)})));await page?.screenshot({path:path.join(out,'failure.png')});}catch{}process.exitCode=1;}
finally{releaseStale?.();await browser?.close();await new Promise(r=>io.close(r));await require('../server/realtime/accountConnection').waitForAccountConnections(io);if(id)await db.execute('DELETE FROM users WHERE id=?',[id]);await db.end();console.log(JSON.stringify({success,errors,testUserDeleted:true}));}})();
