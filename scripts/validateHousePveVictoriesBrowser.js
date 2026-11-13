// Real authenticated clients and committed battle results; disposable test accounts only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{once}=require('node:events'),{randomUUID,createHash}=require('node:crypto');
assert.equal(process.env.DB_TEST_NAME,'explorakit_test');process.env.DB_NAME='explorakit_test';process.env.NODE_ENV='test';
const engine=process.env.PRESENTATION_BROWSER||'chromium',dist=process.env.RELEASE_DIST_DIR,out='/tmp/riftmon-pve-victories-20261113-'+engine;fs.mkdirSync(out,{recursive:true});
const db=require('../server/config/database').dbPool,users=require('../server/persistence/userRepository'),house=require('../server/persistence/whitepeakHouseRepository'),store=require('../server/persistence/whitepeakRepository');
const clubModule=require('../server/realtime/whitepeakClub');let club;clubModule.getClub=io=>club||(club=clubModule.createClub(io,{tickMs:0}));
const app=require('express')(),server=http.createServer(app),io=new(require('socket.io').Server)(server);app.use(require('express').json());app.use('/api',require('../server/http/routes'));app.use(require('express').static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
let browser,success=false;const accounts=[],pages=[],checks=[],views=[],errors=[];
async function ready(p){await p.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(v?.socket?.connected&&v.players[v.socket.id]&&!v.mapLoading){window.v=v;return true;}});}
async function menu(p){await p.evaluate(()=>{v.clubPanel={tab:'duel'};});await p.locator('#house-mode-pve').click();await p.locator('[data-house-trainer="dia1"]').waitFor();}
async function historicalWin(owner){const config=require('../server/game/whitepeak/rules').settings({mode:'pve',trainerKey:'dia1',money:0,level:50}),ids=[owner],sides=[[owner]],state=await house.inspect(ids,sides,config),id=randomUUID(),selections=[state.snapshots[0].team.map(p=>({ownerId:owner,uuid:p.uuid}))];await house.start({id,ids,sides,config,selections,digest:state.digest});await store.finishDuel(id,owner,'finished');}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 browser=await require('playwright')[engine].launch({headless:true});
 for(let i=0;i<2;i++){
  const user=await users.createUserWithStarter('PvEWon_'+randomUUID().slice(0,8),randomUUID());accounts.push(user);
  if(i===0)await historicalWin(user.id);
  await require('../server/persistence/playerRepository').saveUserPosition(user.id,{map:'ville5_maison1',x:432,y:176});
  for(const[key,value]of[['adventure_opening','complete'],['early_game_tutorial',JSON.stringify({version:1,phase:'complete',metWayne:true})]])await db.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)',[user.id,key,value]);
  await require('../server/persistence/patchNotesRepository').acknowledge(user.id,require('../data/game/latest_patch.json').version);
  const context=await browser.newContext({viewport:{width:1440,height:900},serviceWorkers:'block'});
  await context.addInitScript(a=>{if(location.protocol.startsWith('http')){localStorage.setItem('explorakit.user',JSON.stringify(a));localStorage.setItem('explorakitGamePreferences',JSON.stringify({masterVolume:0,animationsEnabled:false,textSpeed:10000}));}},{...user,token:require('../server/config/auth').signAccessToken(user)});
  const p=await context.newPage();pages.push(p);p.on('pageerror',e=>errors.push(e.message));await p.goto(base+'/game');await ready(p);await menu(p);
 }
 const[a,b]=pages,won='[data-house-trainer="dia1"] [data-house-trainer-won]';
 await a.locator(won).waitFor();assert.equal(await b.locator('[data-house-trainer-won]').count(),0);checks.push('historical victory is visible only to its authenticated owner');
 for(const[width,height]of[[1440,900],[393,852],[320,568]])for(const theme of['light','dark']){
  await a.setViewportSize({width,height});await a.evaluate(theme=>v.updatePreferences({...v.preferences,themeMode:theme}),theme);await a.locator(won).scrollIntoViewIfNeeded();
  const geometry=await a.locator(won).evaluate(n=>{const r=n.getBoundingClientRect(),p=n.closest('[data-house-trainer]').getBoundingClientRect();return{width:r.width,height:r.height,inside:r.left>=p.left&&r.right<=p.right&&r.top>=p.top&&r.bottom<=p.bottom,color:getComputedStyle(n).color};});assert(geometry.inside&&geometry.width<=20&&geometry.height<=20,JSON.stringify(geometry));
  const name=`pve-${width}-${theme}`;await a.screenshot({path:out+'/'+name+'.png'});views.push(name);
 }
 checks.push('small labelled green check fits desktop and mobile cards in both themes');
 await a.setViewportSize({width:1440,height:900});await a.locator('[data-house-trainer="champion_hoze"]').click();assert.equal(await a.locator(won).count(),1);assert.equal(await a.locator('[data-house-trainer="champion_hoze"] [data-house-trainer-won]').count(),0);checks.push('selection marker does not masquerade as a victory');
 await a.locator('[data-create-duel]').click();await a.waitForFunction(()=>v.battle&&v.clubControl);
 await a.waitForFunction(()=>!v.$refs.battleOverlay.entranceActive&&!v.$refs.battleOverlay.presentationBusy);
 const r=club.roomFor(accounts[0].id);await club.execute(()=>{for(const p of r.copies[1].equipe.pokemons)p.currentHp=0;r.engine.prune();r.engine.checkEnd();});await club.tick();assert.equal(r.phase,'finished');
 await a.waitForFunction(()=>v.clubTrainers.some(t=>t.key==='champion_hoze'&&t.completed));assert.deepEqual(new Set(await store.pveVictories(accounts[0].id)),new Set(['dia1','champion_hoze']));checks.push('native engine victory commits before its catalogue updates, without reopening or reconnecting');
 await a.locator('[data-battle-result-continue]').click();await a.waitForFunction(()=>!v.battle&&!v.battleResult);await a.reload();await ready(a);await menu(a);await a.locator('[data-house-trainer="champion_hoze"] [data-house-trainer-won]').waitFor();assert.equal(await a.locator('[data-house-trainer-won]').count(),2);assert.equal(await b.locator('[data-house-trainer-won]').count(),0);checks.push('won trainers persist after a full reload without leaking to another player');
 assert.deepEqual(errors,[]);success=true;
 }catch(e){console.error(e.stack);if(pages[0]&&!pages[0].isClosed())await pages[0].screenshot({path:out+'/failure.png'});process.exitCode=1;}
 finally{
  await browser?.close();require('../server/realtime/housing').getHousingManager(io).stop();await require('../server/realtime/casinoSlots').getSlotsManager(io).stop();await require('../server/realtime/raidManager').getRaidManager(io).stop();await require('../server/realtime/draftManager').getDraftManager(io).stop();club?.close();await new Promise(r=>io.close(r));await require('../server/realtime/accountConnection').waitForAccountConnections(io);for(const u of accounts)await db.execute('DELETE FROM users WHERE id=?',[u.id]);await db.end();const report={success,engine,checks,views,errors,productionWrites:false,buildIndexSha256:createHash('sha256').update(fs.readFileSync(dist+'/index.html')).digest('hex')};fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }
})();
