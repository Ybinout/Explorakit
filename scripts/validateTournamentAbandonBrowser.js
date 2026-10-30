// Private Socket/SQL server and disposable account; fixtures never expose an endpoint.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(process.env.DB_TEST_NAME!=='explorakit_test')throw Error('Dedicated test database required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';process.env.BATTLE_DELAY_SCALE='0';
const express=require('express'),{Server}=require('socket.io'),playwright=require('playwright');
const {dbPool:db}=require('../server/config/database'),repo=require('../server/persistence/superTournamentRepository'),teams=require('../server/persistence/teamRepository');
const players=require('../server/persistence/playerRepository'),factory=require('../server/game/drift/pokemonFactory'),content=require('../server/game/superTournament/content'),codec=require('../server/game/drift/checkpointCodec');
const handlers=require('../server/realtime/handlers/superTournamentHandlers'),original=handlers.createHandlers,controllers=new Map();
handlers.createHandlers=options=>{const h=original(options);controllers.set(options.userId,h.controller);return h;};
const engine=process.env.PRESENTATION_BROWSER||'chromium',dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-tournament-exit-dist';
const out=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-tournament-exit-'+engine;fs.mkdirSync(out,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server);app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
let browser,page,context,user,id,success=false;const errors=[],views=[],checks=[];
const controller=()=>controllers.get(id);
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(v?.socket?.connected&&!v.mapLoading&&!v.flight&&v.renderedMap===v.map&&v.players[v.socket.id]){window.v=v;return true;}});}
async function command(event,data={}){return page.evaluate(({event,data})=>new Promise((resolve,reject)=>v.socket.timeout(10000).emit(event,data,(e,r)=>e?reject(e):resolve(r))),{event,data});}
async function walk(key,count){for(let i=0;i<count;i++){await page.evaluate(key=>v.socket.emit('playerAction',key),key);await page.waitForTimeout(150);}await ready();}
async function visit(origin){await controller().travel(origin);await ready();await walk('move_z',1);await page.waitForFunction(()=>v.map==='centre'&&!v.mapLoading);await ready();assert.deepEqual((await players.loadUserPosition(id)).centerReturnPoint,origin);}
async function register(){assert((await command('superTournament:travel')).success);await ready();await controller().travel({map:content.MAPS.lobby,x:448,y:304});await ready();const toolbar=await page.locator('.world-toolbar').evaluate(n=>n.getBoundingClientRect().height);await page.evaluate(()=>v.socket.emit('Space'));await page.locator('.tournament-panel').waitFor();const offerId=await page.evaluate(()=>v.tournamentPanel.offerId);assert((await command('superTournament:register',{offerId})).success);await page.evaluate(()=>v.tournamentPanel=null);await page.waitForFunction(()=>v.superTournament.active&&v.map==='super_tournament_sas'&&!v.mapLoading);await ready();assert(await page.locator('.world-toolbar').evaluate((n,before)=>n.getBoundingClientRect().height<=before+1,toolbar),'Exit flag must not enlarge toolbar');}
async function battle(){await controller().execute(()=>controller().next());await controller().travel({map:content.MAPS.room,x:448,y:496});await ready();await controller().execute(()=>controller().atomic(()=>controller().startBattle()));}
async function win(){await controller().execute(()=>controller().atomic(()=>{const c=controller(),b=c.run.battle;for(const p of b.b.equipe.pokemons)p.currentHp=0;b.prune();b.checkEnd();c.reconcile();}));}
async function flag(){const f=page.locator('[data-super-tournament-exit]');await f.waitFor();assert(await f.isEnabled());assert(await f.evaluate(n=>{const r=n.getBoundingClientRect(),e=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return r.width>=44&&r.height>=44&&r.top>=0&&r.right<=innerWidth+1&&(e===n||n.contains(e));}),'Flag hidden or outside viewport');return f;}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'exit_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(r.status,201);user=await r.json();id=user.user.id;
 await teams.editEquipe(id,{pokemons:[9,94,212,248,445,121].map(id=>factory.create(id,100,true))});
 for(const[key,value]of [['adventure_opening','complete'],['mirror_stage','complete'],['super_tournament_invited','true']])await db.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)',[id,key,value]);await repo.grantPass(id);
 await db.execute("UPDATE users SET map='ville1',x=496,y=304 WHERE id=?",[id]);
 browser=await playwright[engine].launch({headless:true,...(engine==='chromium'?{args:['--no-sandbox']}: {})});
 const scenarios=[[393,852,['sas','ready','loading','battle','replacement','result','reward','pending','cleared']], [320,480,['reward']], [844,390,['sas']], [1365,900,['battle','result']]];
 let number=0;
 for(const[width,height,phases]of scenarios){
  context=await browser.newContext({viewport:{width,height},hasTouch:width<1000,isMobile:width<1000});await context.addInitScript(u=>{if(location.protocol.startsWith('http'))localStorage.setItem('explorakit.user',JSON.stringify(u));},{...user.user,token:user.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/game');await ready();await page.evaluate(()=>v.updatePreferences({...v.preferences,masterVolume:0,animationsEnabled:true,themeMode:'light'}));
  assert.equal(await page.locator('[data-super-tournament-exit]').count(),0);
  for(const phase of phases){
   const origin=number%2?{map:'route4',x:720,y:144}:{map:'ville1',x:496,y:304};await visit(origin);await register();
   const adventure=codec.encode(await teams.loadEquipe(id));const expectedScore=++number*100;
   if(phase==='ready'||phase==='cleared'){await controller().execute(()=>controller().next());await controller().travel({map:content.MAPS.room,x:448,y:496});await ready();if(phase==='cleared')await controller().execute(()=>controller().atomic(()=>{controller().run.phase='cleared';controller().run.cleared=1;}));}
   if(['loading','battle','replacement','result','reward','pending'].includes(phase)){
    await battle();
    if(phase!=='loading')await page.waitForFunction(()=>v.$refs.battleOverlay?.canChooseAction);
    if(phase==='battle')await controller().execute(()=>controller().atomic(()=>{controller().run.battle.state.weather={kind:'rain',turns:5};controller().run.battle.sync();}));
    if(phase==='replacement')await controller().execute(()=>controller().atomic(()=>{const b=controller().run.battle;b.a.equipe.pokemons[0].currentHp=0;b.prune();b.awaiting=false;b.request();}));
    if(phase==='pending')await page.evaluate(()=>{v.$refs.battleOverlay.finishPresentation=()=>new Promise(resolve=>{window.releaseOldBattleResult=resolve;});});
    if(['result','reward','pending'].includes(phase)){await win();if(phase==='pending')await page.waitForFunction(()=>!!v.pendingBattleResult);else{await page.locator('[data-battle-result-continue]').waitFor();if(phase==='reward'){await page.locator('[data-battle-result-continue]').click();await page.locator('.tournament-reward-panel').waitFor();}}}
   }
   await controller().execute(()=>controller().atomic(()=>{controller().run.score=expectedScore;}));
   if(phase==='replacement')await page.locator('[data-replacement-choice=true]').waitFor();
   if(number===1){await page.locator('.team-toggle-btn').click();await page.locator('.team-panel').waitFor();}
   const f=await flag();
   if(phase==='battle'){const weather=page.locator('[data-battle-weather-info]');await weather.waitFor();if(width<1000)assert(await f.evaluate((n,weather)=>{const a=n.getBoundingClientRect(),b=document.querySelector(weather).getBoundingClientRect();return a.bottom<=b.top||a.left>=b.right||a.right<=b.left;},'[data-battle-weather-info]'),'Flag overlaps weather');}
   await page.screenshot({path:path.join(out,`${width}-${phase}.png`)});await f.click();await page.locator('[data-tournament-view=abandon]').waitFor();assert.match(await page.locator('.tournament-content').innerText(),/dernier Centre Pokémon/);
   if(number===1){const token=controller().run.id;await page.keyboard.press('Escape');await flag();assert.equal(controller().run.id,token);assert.equal(await page.evaluate(()=>document.activeElement?.hasAttribute('data-super-tournament-exit')),true);await (await flag()).click();}
   if(phase==='battle'&&width===393){const c=controller(),persist=c.persist;c.persist={...persist,save:async(...args)=>{if(args[1]===null)throw Error('Sauvegarde temporairement indisponible.');return persist.save(...args);}};await page.getByRole('button',{name:'Confirmer l’abandon',exact:true}).click();await page.locator('.tournament-panel .error').waitFor();assert(controller().active);assert.equal((await players.loadUserPosition(id)).map,content.MAPS.room);c.persist=persist;}
   await page.getByRole('button',{name:'Confirmer l’abandon',exact:true}).click();await page.waitForFunction(()=>v.map==='centre'&&!v.superTournament.active&&!v.battle&&!v.battleResult&&!v.pendingBattleResult&&!v.tournamentPanel&&!v.mapLoading);await ready();
   if(phase==='pending'){await page.evaluate(()=>window.releaseOldBattleResult());await page.waitForTimeout(100);assert.equal(await page.locator('[data-battle-result-continue]').count(),0);}
   assert.equal((await repo.load(id)).run,null);assert(Number((await repo.leaderboard(id)).personal.score)>=expectedScore);assert.deepEqual(codec.encode(await teams.loadEquipe(id)),adventure);
   assert.deepEqual((await players.loadUserPosition(id)).centerReturnPoint,origin);
   assert.equal(await page.locator('[data-super-tournament-exit]').count(),0);
   if(number===1){await page.reload();await ready();assert.equal(await page.evaluate(()=>v.map),'centre');assert.equal(await page.evaluate(()=>v.superTournament.active),false);}
   await walk('move_d',4);await walk('move_s',2);await page.waitForFunction(map=>v.map===map&&!v.mapLoading,origin.map);await ready();assert.equal(await page.evaluate(()=>v.map),origin.map);
   views.push({width,height,phase,origin:origin.map,score:expectedScore});
  }
  await context.close();await require('../server/realtime/accountConnection').waitForAccountConnections(io);
 }
 checks.push('White flag accessible in SAS, between rooms, battle entrance, combat, forced replacement, result, recovery cards and pending presentation');
 checks.push('Confirmation cancels without changing the run; failed save stays playable; retry abandons; no stale result reappears');
 checks.push('Final score and original Adventure team preserved; return to last visited Center and real exit city verified, including reconnect');
 assert.deepEqual(errors,[]);success=true;fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({success,engine,views,checks,errors,physicalHardware:false,headerNotEnlarged:true},null,2));console.log(JSON.stringify({success,engine,views,checks,errors}));
}finally{
 if(!success&&page&&!page.isClosed()){console.error(await page.evaluate(()=>({map:window.v?.map,phase:window.v?.superTournament?.phase,battle:window.v?.battle,text:document.body.innerText.slice(-1400)})).catch(()=>null));await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}
 await browser?.close();await new Promise(r=>io.close(r));await require('../server/realtime/accountConnection').waitForAccountConnections(io);if(id)await db.execute('DELETE FROM users WHERE id=?',[id]);await db.end();
}})().then(()=>process.exit(0),e=>{console.error(e.stack);process.exit(1);});
