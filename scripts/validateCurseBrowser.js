// Real battle packets and compiled client; disposable SQL account only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(process.env.DB_TEST_NAME!=='explorakit_test')throw Error('Dedicated test database required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';
const express=require('express'),{Server}=require('socket.io'),playwright=require('playwright');
const {dbPool:db}=require('../server/config/database'),factory=require('../server/game/drift/pokemonFactory');
const {DriftBattle}=require('../server/game/drift/driftBattle');
const engine=process.env.PRESENTATION_BROWSER||'chromium',dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-curse-dist';
const out=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-curse-'+engine;fs.mkdirSync(out,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server);
app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));
io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
let browser,page,context,user,battle,success=false;const errors=[],views=[],checks=[];
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(v?.socket?.connected&&!v.mapLoading&&v.renderedMap===v.map&&v.players[v.socket.id]){window.v=v;return true;}});}

(async()=>{try{
 assert(fs.existsSync(path.join(dist,'index.html')));server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'curse_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(r.status,201);user=await r.json();
 await db.execute("UPDATE users SET map='centre',x=560,y=304 WHERE id=?",[user.user.id]);await db.execute("UPDATE player_story_flags SET flag_value='complete' WHERE user_id=? AND flag_key='adventure_opening'",[user.user.id]);
 browser=await playwright[engine].launch({headless:true,...(engine==='chromium'?{args:['--no-sandbox']}: {})});
 for(const[width,height,type,id]of [[320,480,'wild',94],[393,852,'arena',143],[1365,900,'pvp',94]]){
  context=await browser.newContext({viewport:{width,height},hasTouch:width<1000,isMobile:width<1000});await context.addInitScript(u=>{if(location.protocol.startsWith('http'))localStorage.setItem('explorakit.user',JSON.stringify(u));},{...user.user,token:user.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/game');await ready();await page.evaluate(()=>v.updatePreferences({...v.preferences,masterVolume:0}));const socketId=await page.evaluate(()=>v.socket.id);
  const make=id=>Object.assign(factory.create(id,25,true),{abilities:['Curse','Splash'],movePp:[10,40],passiveAbility:null,heldItem:null,maxHp:200,currentHp:200});
  const a={socketId,userId:user.user.id,currentmap:'centre',equipe:{pokemons:[make(id)]},drifts:[],equipped:[]};
  const b={socketId:'private-fixture',userId:0,npc:type!=='pvp',equipe:{pokemons:[make(143)]},drifts:[],equipped:[]};
  const emitted=[];
  battle=new DriftBattle(a,b,{type,emit:(p,event,data)=>{if(p===a)emitted.push({event,data});io.to(p.socketId).emit(event,data);},rules:{report:false,rewards:false,permanentDeaths:false},paceMs:0});
  await page.waitForFunction(()=>v.$refs.battleOverlay?.currentPokemon?.currentHp===200);
  battle.resolveAttacks([{index:0,pokemonUuid:a.equipe.pokemons[0].uuid,name:'Curse'}]);
  assert.equal(emitted.find(e=>e.event==='battleMoveAnimation'&&e.data.moveName==='Curse')?.data.moveTarget,id===94?'single':'self');
  if(id===94){
   assert.equal(a.equipe.pokemons[0].currentHp,100);assert.equal(b.equipe.pokemons[0].currentHp,150);
   await page.waitForFunction(()=>{const o=v.$refs.battleOverlay;return o?.currentPokemon?.currentHp===100&&o.opponent?.currentHp===150&&document.querySelector('.battle-status-wild')?.textContent.includes('Malédiction');});
   assert(!await page.locator('.battle-status-player').textContent().then(t=>t.includes('Malédiction')));
   battle.resolveAttacks([{index:0,pokemonUuid:a.equipe.pokemons[0].uuid,name:'Curse'}]);
   assert.equal(a.equipe.pokemons[0].currentHp,100);assert.equal(b.equipe.pokemons[0].currentHp,100);
   await page.waitForFunction(()=>v.$refs.battleOverlay?.opponent?.currentHp===100);
  }else{
   assert.equal(a.equipe.pokemons[0].currentHp,200);assert.equal(b.equipe.pokemons[0].currentHp,200);
   await page.waitForFunction(()=>{const o=v.$refs.battleOverlay;return o?.currentPokemon?.__battle?.statStages?.attack===1&&document.querySelector('.battle-status-player')?.textContent.includes('VIT -1');});
   assert(!await page.locator('.battle-status-wild').textContent().then(t=>t.includes('Malédiction')));
  }
  for(const side of ['player','wild'])assert(await page.locator('.battle-status-'+side).evaluate(n=>n.scrollWidth<=n.clientWidth+1),'Card overflow');
  await page.screenshot({path:path.join(out,`${width}-${type}.png`)});views.push({width,height,type,ghost:id===94});
  battle.finish(null,'fled');battle=null;await context.close();await require('../server/realtime/accountConnection').waitForAccountConnections(io);
 }
 checks.push('Actual shared orchestrator: Ghost half-HP sacrifice, opponent-only Curse badge and quarter-HP residual');
 checks.push('Second use against a cursed opponent costs PP without another HP sacrifice; residual remains single');
 checks.push('Non-Ghost self boosts display on the correct fighter without HP loss or curse');
 assert.deepEqual(errors,[]);success=true;fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({success,engine,views,checks,errors,physicalHardware:false},null,2));console.log(JSON.stringify({success,engine,views,checks,errors}));
}finally{
 if(!success&&page&&!page.isClosed()){console.error(await page.evaluate(()=>({map:window.v?.map,text:document.body.innerText.slice(-1200)})).catch(()=>null));await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}
 battle?.finish(null,'fled');
 try{await browser?.close();await new Promise(r=>io.close(r));await require('../server/realtime/accountConnection').waitForAccountConnections(io);}
 finally{if(user)await db.execute('DELETE FROM users WHERE id=?',[user.user.id]);await db.end();}
}})().then(()=>process.exit(0),e=>{console.error(e.stack);process.exit(1);});
