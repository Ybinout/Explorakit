// Real battle packets and compiled client; disposable SQL account only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(process.env.DB_TEST_NAME!=='explorakit_test')throw Error('Dedicated test database required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';
const express=require('express'),{Server}=require('socket.io'),playwright=require('playwright');
const {dbPool:db}=require('../server/config/database'),factory=require('../server/game/drift/pokemonFactory');
const {DriftBattle}=require('../server/game/drift/driftBattle');
const engine=process.env.PRESENTATION_BROWSER||'chromium',dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-reward-colors-dist';
const out=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-residual-'+engine;fs.mkdirSync(out,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server);
app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));
io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
let browser,page,context,user,battle,success=false;const errors=[],views=[],checks=[];
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(v?.socket?.connected&&!v.mapLoading&&v.renderedMap===v.map&&v.players[v.socket.id]){window.v=v;return true;}});}


// Only this private review server bridges the normal client action packets to
// the fixture battle. No fixture endpoint or account edit exists in production.
io.on('connection',socket=>socket.on('actionResponse',payload=>{
 if(!battle||battle.finished||battle.a.socketId!==socket.id)return;
 assert(battle.action(battle.a,payload),'Client action rejected: '+JSON.stringify(payload));
 battle.tick();
}));
(async()=>{try{
 assert(fs.existsSync(path.join(dist,'index.html')));server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'residual_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(r.status,201);user=await r.json();
 await db.execute("UPDATE users SET map='centre',x=560,y=304 WHERE id=?",[user.user.id]);await db.execute("UPDATE player_story_flags SET flag_value='complete' WHERE user_id=? AND flag_key='adventure_opening'",[user.user.id]);
 browser=await playwright[engine].launch({headless:true,...(engine==='chromium'?{args:['--no-sandbox']}: {})});
 for(const[width,height,type]of [[320,480,'wild'],[393,852,'arena'],[1365,900,'trainer']])for(const effect of ['curse','poison']){
  context=await browser.newContext({viewport:{width,height},hasTouch:width<1000,isMobile:width<1000});await context.addInitScript(u=>{if(location.protocol.startsWith('http'))localStorage.setItem('explorakit.user',JSON.stringify(u));},{...user.user,token:user.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/game');await ready();await page.evaluate(()=>v.updatePreferences({...v.preferences,masterVolume:0,animationsEnabled:false}));const socketId=await page.evaluate(()=>v.socket.id);
  const resources=require('../server/game/battle/battleResources');
  const make=(id,moves)=>Object.assign(factory.create(id,25,true),{abilities:moves,movePp:moves.map(resources.getMaxMovePp),passiveAbility:null,heldItem:null,maxHp:160,currentHp:160});
  const own=make(94,[effect==='curse'?'Curse':'Splash']),bench=make(25,['Splash']),foe=make(143,[effect==='curse'?'Splash':'Dragon Rage']);
  own.currentHp=1;own.currentSpeed=effect==='curse'?999:1;foe.currentSpeed=effect==='curse'?1:999;if(effect==='poison')foe.status='poison';
  const a={socketId,userId:user.user.id,currentmap:'centre',equipe:{pokemons:[own,bench]},drifts:[],equipped:[]};
  const b={socketId:'private-fixture',userId:0,npc:true,equipe:{pokemons:[foe]},drifts:[],equipped:[]};
  const emitted=[];
  battle=new DriftBattle(a,b,{type,emit:(p,event,data)=>{if(p===a)emitted.push({event,data:JSON.parse(JSON.stringify(data))});io.to(p.socketId).emit(event,data);},rules:{report:false,rewards:false,permanentDeaths:type!=='trainer'},paceMs:0});
  await page.waitForFunction(()=>v.$refs.battleOverlay?.canChooseAction);
  await page.locator('.action-attack').click();await page.locator('.battle-move-choice').first().click();
  const expected=effect==='curse'?120:140;
  await page.waitForFunction(expected=>{const o=v.$refs.battleOverlay;return o?.canChooseAction&&o.replacementChoice&&o.opponent?.currentHp===expected;},expected);
  assert.equal(own.currentHp,0);assert.equal(foe.currentHp,expected);assert.equal(battle.state.turn,2);
  const tick=emitted.findIndex(e=>e.event==='battleText'&&/souffre (de la malediction|du poison)/.test(e.data.message));
  const prompt=emitted.findIndex(e=>e.event==='requestAction'&&e.data.replacement);
  assert(tick>=0&&prompt>tick,'Residual message must precede replacement prompt');
  assert(!emitted.some(e=>e.event==='endbattle'));
  await page.screenshot({path:path.join(out,`${width}-${effect}-choice.png`)});
  await page.locator(`[data-party-uuid="${bench.uuid}"]`).click();
  await page.waitForFunction(uuid=>{const o=v.$refs.battleOverlay;return o?.canChooseAction&&!o.replacementChoice&&o.currentPokemon?.uuid===uuid;},bench.uuid);
  assert.equal(foe.currentHp,expected);assert.equal(battle.state.turn,2);
  await page.locator('.action-attack').click();await page.locator('.battle-move-choice').first().click();
  await page.waitForFunction(expected=>v.$refs.battleOverlay?.canChooseAction&&v.$refs.battleOverlay?.opponent?.currentHp===expected,expected-(effect==='curse'?40:20));
  assert.equal(battle.state.turn,3);
  assert.equal(foe.currentHp,expected-(effect==='curse'?40:20));
  for(const side of ['player','wild'])assert(await page.locator('.battle-status-'+side).evaluate(n=>n.scrollWidth<=n.clientWidth+1),'Card overflow');
  views.push({width,height,type,effect,residualBeforeReplacement:true,noExtraTickOnChoice:true,persistsNextTurn:true});
  battle.finish(null,'fled');battle=null;await context.close();await require('../server/realtime/accountConnection').waitForAccountConnections(io);
 }
 checks.push('Real client action: 1 HP Curse / opponent kill; residual HP and text resolve before the replacement UI');
 checks.push('Choosing the reserve consumes no turn or extra residual; Curse/poison tick once on the following non-damaging action');
 checks.push('Current compiled client reused in wild/arena/trainer presentation, mobile/desktop, without overflow or browser errors');
 assert.deepEqual(errors,[]);success=true;fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({success,engine,views,checks,errors,physicalHardware:false,compiledClientChanged:false},null,2));console.log(JSON.stringify({success,engine,views,checks,errors}));
}finally{
 if(!success&&page&&!page.isClosed()){console.error(await page.evaluate(()=>({map:window.v?.map,text:document.body.innerText.slice(-1200)})).catch(()=>null));await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}
 battle?.finish(null,'fled');
 try{await browser?.close();await new Promise(r=>io.close(r));await require('../server/realtime/accountConnection').waitForAccountConnections(io);}
 finally{if(user)await db.execute('DELETE FROM users WHERE id=?',[user.user.id]);await db.end();}
}})().then(()=>process.exit(0),e=>{console.error(e.stack);process.exit(1);});
