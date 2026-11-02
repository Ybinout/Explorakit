// Real selection packets and current compiled client; private server / disposable SQL account.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(process.env.DB_TEST_NAME!=='explorakit_test')throw Error('Dedicated test database required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';
const express=require('express'),{Server}=require('socket.io'),playwright=require('playwright');
const {dbPool:db}=require('../server/config/database'),factory=require('../server/game/drift/pokemonFactory');
const {DriftBattle}=require('../server/game/drift/driftBattle'),resources=require('../server/game/battle/battleResources');
const engine=process.env.PRESENTATION_BROWSER||'chromium',dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-six-items-dist';
const out=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-pivot-choice-'+engine;fs.mkdirSync(out,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server);
app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));
io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
let browser,page,context,user,battle,success=false;const errors=[],views=[];
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(v?.socket?.connected&&!v.mapLoading&&v.renderedMap===v.map&&v.players[v.socket.id]){window.v=v;return true;}});}
io.on('connection',socket=>socket.on('actionResponse',payload=>{
 if(!battle||battle.finished||battle.a.socketId!==socket.id)return;
 assert(battle.action(battle.a,payload),'Client action rejected: '+JSON.stringify(payload));battle.tick();
}));
(async()=>{try{
 assert(fs.existsSync(path.join(dist,'index.html')));server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'pivot_ui_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(r.status,201);user=await r.json();
 await db.execute("UPDATE users SET map='centre',x=560,y=304 WHERE id=?",[user.user.id]);await db.execute("UPDATE player_story_flags SET flag_value='complete' WHERE user_id=? AND flag_key='adventure_opening'",[user.user.id]);
 browser=await playwright[engine].launch({headless:true,...(engine==='chromium'?{args:['--no-sandbox']}: {})});
 for(const[width,height]of [[393,852],[1365,900]])for(const move of ['U-turn','Volt Switch','Parting Shot','Baton Pass']){
  context=await browser.newContext({viewport:{width,height},hasTouch:width<1000,isMobile:width<1000});await context.addInitScript(u=>{if(location.protocol.startsWith('http'))localStorage.setItem('explorakit.user',JSON.stringify(u));},{...user.user,token:user.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/game');await ready();await page.evaluate(()=>v.updatePreferences({...v.preferences,masterVolume:0,animationsEnabled:true}));const socketId=await page.evaluate(()=>v.socket.id);
  const make=(id,ability)=>Object.assign(factory.create(id,25,true),{abilities:[ability],movePp:[resources.getMaxMovePp(ability)],passiveAbility:null,heldItem:null,maxHp:160,currentHp:160});
  const own=make(25,move),bench=make(7,'Splash'),chosen=make(4,'Splash'),dead=make(19,'Splash'),foe=make(143,'Tackle');own.currentSpeed=999;foe.currentSpeed=1;dead.currentHp=0;
  const a={socketId,userId:user.user.id,currentmap:'centre',equipe:{pokemons:[own,bench,chosen,dead]},drifts:[],equipped:[]},b={socketId:'private-fixture',npc:true,equipe:{pokemons:[foe]},drifts:[],equipped:[]};
  const emitted=[];battle=new DriftBattle(a,b,{type:'arena',emit:(p,event,data)=>{if(p===a)emitted.push({event,data:structuredClone(data)});io.to(p.socketId).emit(event,data);},rules:{report:false,rewards:false,permanentDeaths:false},paceMs:0});
  if(move==='Baton Pass')require('../server/game/battle/battleEngine').ensureBattleData(own).statStages.attack=2;
  await page.waitForFunction(()=>v.$refs.battleOverlay?.canChooseAction);await page.locator('.action-attack:enabled').click();await page.locator('.battle-move-choice').first().click();
  await page.locator('[data-replacement-choice="true"]').waitFor();assert(battle.replacementPhase);assert.equal(battle.active(0),own);assert.equal(foe.movePp[0],35,'Opponent must wait for the chosen reserve');
  for(const index of [0,3])assert(await page.locator(`[data-battle-index="${index}"]`).isDisabled());for(const index of [1,2])assert(await page.locator(`[data-battle-index="${index}"]`).isEnabled());
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(out,`${width}-${move.replace(/ /g,'-')}-choice.png`)});
  await page.locator('[data-battle-index="2"]').click();await page.waitForFunction(uuid=>{const o=v.$refs.battleOverlay;return o?.canChooseAction&&!o.replacementChoice&&o.currentPokemon?.uuid===uuid;},chosen.uuid);
  assert.equal(battle.active(0),chosen);assert.equal(own.currentHp,160);assert.equal(bench.currentHp,160);assert(chosen.currentHp<160);assert.equal(foe.movePp[0],34);assert.equal(chosen.movePp[0],40);assert.equal(battle.state.turn,2);assert.equal(own.movePp[0],resources.getMaxMovePp(move)-1);if(move==='Baton Pass')assert.equal(chosen.__battle.statStages.attack,2);
  const prompt=emitted.findIndex(e=>e.event==='requestAction'&&e.data.replacement),reply=emitted.findIndex(e=>e.event==='battleMoveAnimation'&&e.data.actor==='opponent');assert(reply>prompt);
  views.push({width,height,move,selectedIndex:2,outgoingRetained:true,deadDisabled:true,opponentWaited:true,turnResumedOnce:true,batonStagesTransferred:move==='Baton Pass'});
  battle.finish(null,'fled');battle=null;await context.close();await require('../server/realtime/accountConnection').waitForAccountConnections(io);
 }
 assert.deepEqual(errors,[]);success=true;const result={success,engine,views,errors,physicalHardware:false,compiledClientChanged:false};fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{
 if(!success&&page&&!page.isClosed()){console.error(await page.evaluate(()=>({map:window.v?.map,text:document.body.innerText.slice(-1200)})).catch(()=>null));await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}
 battle?.finish(null,'fled');try{await browser?.close();await new Promise(r=>io.close(r));await require('../server/realtime/accountConnection').waitForAccountConnections(io);}finally{if(user)await db.execute('DELETE FROM users WHERE id=?',[user.user.id]);await db.end();}
}})().then(()=>process.exit(0),e=>{console.error(e.stack);process.exit(1);});
