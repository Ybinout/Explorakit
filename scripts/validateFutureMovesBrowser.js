// Local fixture process only; no test endpoint is installed in the game.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID,createHash}=require('node:crypto');
if(process.env.DB_TEST_NAME!=='explorakit_test')throw Error('Dedicated test database required');
process.env.DB_NAME='explorakit_test';process.env.NODE_ENV='test';
const express=require('express'),{Server}=require('socket.io'),playwright=require('playwright');
const {dbPool:db}=require('../server/config/database'),factory=require('../server/game/drift/pokemonFactory');
const {DriftBattle}=require('../server/game/drift/driftBattle'),resources=require('../server/game/battle/battleResources');
const engine=process.env.PRESENTATION_BROWSER||'chromium',dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-dark-corrupted-dist';
const out=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-future-'+engine;fs.mkdirSync(out,{recursive:true});fs.rmSync(out+'/results.json',{force:true});
const app=express(),server=http.createServer(app),io=new Server(server);app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));
io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
let browser,page,context,user,battle,success=false;const errors=[],views=[],oldRandom=Math.random;
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(v?.socket?.connected&&!v.mapLoading&&v.renderedMap===v.map&&v.players[v.socket.id]){window.v=v;return true;}});}
async function action(index){await page.waitForFunction(()=>v.$refs.battleOverlay?.canChooseAction);await page.locator('.action-attack:enabled').click();await page.locator('.battle-move-choice').nth(index).click();}
async function shot(label){assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(out,label+'.png')});views.push(label);}
io.on('connection',socket=>socket.on('actionResponse',payload=>{if(!battle||battle.finished||battle.a.socketId!==socket.id)return;assert(battle.action(battle.a,payload));battle.tick();}));
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'future_ui_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(r.status,201);user=await r.json();
 await db.execute("UPDATE users SET map='centre',x=560,y=304 WHERE id=?",[user.user.id]);await db.execute("UPDATE player_story_flags SET flag_value='complete' WHERE user_id=? AND flag_key='adventure_opening'",[user.user.id]);
 browser=await playwright[engine].launch({headless:true,...(engine==='chromium'?{args:['--no-sandbox']}: {})});Math.random=()=>.5;
 for(const[width,height]of [[393,852],[1365,900]])for(const themeMode of ['light','dark'])for(const move of ['False Swipe','Future Sight']){
  context=await browser.newContext({viewport:{width,height},hasTouch:width<1000,isMobile:width<1000,serviceWorkers:'block'});await context.addInitScript(u=>{if(location.protocol.startsWith('http'))localStorage.setItem('explorakit.user',JSON.stringify(u));},{...user.user,token:user.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/game');await ready();await page.evaluate(themeMode=>v.updatePreferences({...v.preferences,themeMode,masterVolume:0,animationsEnabled:true}),themeMode);const socketId=await page.evaluate(()=>v.socket.id);
  const make=(id,moves)=>Object.assign(factory.create(id,50,true),{abilities:moves,movePp:moves.map(resources.getMaxMovePp),passiveAbility:null,heldItem:null,maxHp:160,currentHp:160});
  const hero=make(move==='False Swipe'?212:65,[move,'Splash']),foe=make(143,['Splash']);foe.maxHp=foe.currentHp=80;hero.currentAttack=hero.currentSpecialAttack=9999;
  const a={socketId,userId:user.user.id,currentmap:'centre',equipe:{pokemons:[hero]},drifts:[],equipped:[]},b={npc:true,equipe:{pokemons:[foe]},drifts:[],equipped:[]},events=[];
  battle=new DriftBattle(a,b,{type:'arena',emit:(p,event,data)=>{if(p===a)events.push({event,data:structuredClone(data)});io.to(p.socketId).emit(event,data);},paceMs:0,random:()=>.5,rules:{report:false,rewards:false,permanentDeaths:false}});
  const label=width+'-'+themeMode+'-'+move.replaceAll(' ','-');await action(0);await page.waitForFunction(()=>v.$refs.battleOverlay?.canChooseAction);
  if(move==='False Swipe'){
   assert.equal(foe.currentHp,1);assert.equal(await page.evaluate(()=>v.$refs.battleOverlay.opponent.currentHp),1);await action(0);await page.waitForFunction(()=>v.$refs.battleOverlay?.canChooseAction);assert.equal(foe.currentHp,1);assert(!battle.finished);await shot(label+'-one-hp');battle.finish(null,'closed');
  }else{
   assert.equal(foe.currentHp,80);assert.equal(battle.state.turn,2);assert.equal(await page.evaluate(()=>v.$refs.battleOverlay.opponent.currentHp),80);await shot(label+'-pending');
   await action(1);await page.waitForFunction(()=>v.$refs.battleOverlay?.canChooseAction);assert.equal(battle.state.turn,3);assert.equal(foe.currentHp,80);await action(1);
   await page.waitForFunction(()=>{const o=v.$refs.battleOverlay;return o?.battleMoveFx.visible&&o.battleMoveFx.moveName==='Future Sight'&&!o.battleMoveFx.prepare&&['windup','travel'].includes(o.battleMoveFx.stage);});
   assert.equal(await page.evaluate(()=>v.$refs.battleOverlay.opponent.currentHp),80,'HP must stay unchanged until the delayed impact');await shot(label+'-delayed-impact');
   await page.waitForFunction(()=>!!v.battleResult,{},{timeout:20000});assert.equal(foe.currentHp,0);assert.equal(events.filter(e=>e.event==='battleMoveResult'&&e.data.moveName===move&&e.data.phase==='strike').length,1);assert.equal(hero.movePp[0],9);
  }
  battle=null;await context.close();await require('../server/realtime/accountConnection').waitForAccountConnections(io);
 }
 assert.deepEqual(errors,[]);success=true;const result={success,engine,views,errors,falseSwipeLeavesOne:true,falseSwipeRepeatSafe:true,futureSightTurnThree:true,noEarlyHpLoss:true,delayedImpactAnimated:true,onePpCost:true,compiledClientChanged:false,buildIndexSha256:createHash('sha256').update(fs.readFileSync(dist+'/index.html')).digest('hex'),physicalHardware:false};fs.writeFileSync(out+'/results.json',JSON.stringify(result,null,2));console.log(JSON.stringify({success,engine,views:views.length,errors}));
}finally{
 if(!success&&page&&!page.isClosed())await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});
 Math.random=oldRandom;battle?.finish(null,'closed');await browser?.close();require('../server/realtime/whitepeakClub').getClub(io).close();await new Promise(r=>io.close(r));await require('../server/realtime/accountConnection').waitForAccountConnections(io);if(user)await db.execute('DELETE FROM users WHERE id=?',[user.user.id]);await db.end();
}})().then(()=>process.exit(0),e=>{console.error(e.stack);process.exit(1);});
