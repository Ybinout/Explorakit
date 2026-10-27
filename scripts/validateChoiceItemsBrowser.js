// Real battle sockets with the unchanged compiled client and a disposable SQL database.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(!/test/i.test(process.env.DB_TEST_NAME||''))throw Error('Dedicated test database required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';process.env.BATTLE_DELAY_SCALE='0';
const express=require('express'),{Server}=require('socket.io'),{chromium}=require('playwright'),{dbPool:db}=require('../server/config/database');
const factory=require('../server/game/drift/pokemonFactory'),teams=require('../server/persistence/teamRepository');
function mon(moves=['Tackle','Crunch'],item=null){const p=factory.create(143,30,true);p.passiveAbility=null;p.heldItem=item;p.abilities=[];p.movePp=[];for(const move of moves)p.addAbility(move);p.currentSpeed=100;p.maxHp=p.currentHp=10000;return p;}
// Replace only this process's encounter factory, before loading its socket handler.
const factoryPath=require.resolve('../server/game/world/wildPokemonFactory'),originalFactory=require(factoryPath);require.cache[factoryPath].exports=async()=>mon(['Splash']);
const dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-teleport-dist',out=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-choice-browser';fs.mkdirSync(out,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server);app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
const store=require('../server/game/drift/lobbyStore').createLobbyStore(),cleanup=require('../server/realtime/driftLobbyHandler').registerDriftLobbies(io,{store,checkpointRepository:{async save(){}},runtimeOptions:{random:()=>.9,paceMs:0}});
let browser,page,success=false;const ids=[],errors=[],modes=[],oldRandom=Math.random;
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(!v?.socket?.connected||!v.players[v.socket.id]||v.mapLoading||v.renderedMap!==v.map)return false;window.v=v;if(window.listened!==v.socket){window.listened=v.socket;v.socket.on('endbattle',data=>window.lastEnd=data);}return true;});}
async function create(base){const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'choice_ui_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(r.status,201);const f=await r.json();ids.push(f.user.id);return f;}

async function panel(){await page.locator('.action-attack:enabled').waitFor({timeout:20000});await page.locator('.action-attack:enabled').click();}
async function checkButtons(expected){assert.deepEqual(await page.locator('.battle-grid-attacks button').evaluateAll(bs=>bs.map(b=>!b.disabled)),expected);}
async function choose(index){await panel();await page.locator('.battle-grid-attacks button').nth(index).click();}
async function verify(mode){
 await panel();await checkButtons([true,true,false,false]);await page.locator('.battle-grid-attacks button').first().click();
 await page.waitForFunction(()=>v.$refs.battleOverlay?.canChooseAction&&v.$refs.battleOverlay.usableMoveIndexes?.length===1);
 await panel();await checkButtons([true,false,false,false]);
 // A stale/manual packet is rejected without a new enemy attack or PP cost.
 const pp=await page.evaluate(()=>[...v.$refs.battleOverlay.currentPokemon.movePp]);
 await page.evaluate(()=>{window.choiceRetry=0;v.socket.once('requestAction',()=>window.choiceRetry++);v.socket.emit('actionResponse',{action:'attack',number:1,...(v.isDrift?{turnId:v.driftTurnId}:{})});});
 await page.waitForFunction(()=>window.choiceRetry===1);await panel();await checkButtons([true,false,false,false]);assert.deepEqual(await page.evaluate(()=>v.$refs.battleOverlay.currentPokemon.movePp),pp);
 for(const[width,height]of[[320,568],[393,852],[844,390],[1365,900]]){
  await page.setViewportSize({width,height});await page.waitForTimeout(100);await checkButtons([true,false,false,false]);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(out,mode+'-'+width+'.png')});
 }
 // Changing Pokémon remains possible, and returning releases the old Choice lock.
 const original=await page.evaluate(()=>v.$refs.battleOverlay.currentPokemon.uuid);
 await page.locator('.action-pokemon').click();await page.locator('.battle-grid-pokemon button:enabled').first().click();
 await page.waitForFunction(id=>v.$refs.battleOverlay.canChooseAction&&v.$refs.battleOverlay.currentPokemon.uuid!==id,original);
 await page.locator('.action-pokemon').click();await page.locator(`.battle-grid-pokemon button[data-party-uuid="${original}"]`).click();
 await page.waitForFunction(id=>v.$refs.battleOverlay.canChooseAction&&v.$refs.battleOverlay.currentPokemon.uuid===id,original);
 await panel();await checkButtons([true,true,false,false]);await page.locator('.battle-grid-attacks button').nth(1).click();
 await page.waitForFunction(()=>v.$refs.battleOverlay.canChooseAction&&v.$refs.battleOverlay.usableMoveIndexes?.[0]===1);
 await panel();await checkButtons([false,true,false,false]);
 await page.locator('.action-flee').click();await page.locator('[data-battle-result-continue]').waitFor({timeout:20000});await page.locator('[data-battle-result-continue]').click();
 await page.waitForFunction(()=>!v.battle&&!v.battleResult&&!v.pendingBattleResult);modes.push(mode);
}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`,a=await create(base),b=await create(base);
 await teams.editEquipe(a.user.id,{pokemons:[mon(undefined,'choice_band'),mon(['Splash'])]});await db.execute("UPDATE users SET map='route1',x=176,y=48 WHERE id=?",[a.user.id]);
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true});await context.addInitScript(f=>{if(location.protocol.startsWith('http'))localStorage.setItem('explorakit.user',JSON.stringify(f));},{...a.user,token:a.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().startsWith(base)&&r.status()>=400)errors.push(r.status()+' '+r.url());});
 await page.goto(base+'/game',{waitUntil:'networkidle'});await ready();await page.keyboard.press('Shift');Math.random=()=>0;await page.evaluate(()=>v.socket.emit('playerAction','move_d'));await verify('adventure');Math.random=oldRandom;
 await page.goto(base+'/colosseum',{waitUntil:'networkidle'});await page.locator('[data-colosseum-start]:enabled').click();await page.locator('[data-starter-choice]').first().click();await page.locator('.starter-backdrop').waitFor({state:'hidden'});await ready();
 async function expedition(mode,item){const p=cleanup.runtime.playerFor(a.user);p.equipe.pokemons=[mon(undefined,item),mon(['Splash'])];Object.assign(p,{currentmap:'route1',x:208,y:48});cleanup.runtime.enter(a.user,{id:p.socketId});await page.waitForFunction(()=>v.map==='route1'&&!v.mapLoading);
  const battle=cleanup.runtime.battle(p,{npc:true,equipe:{pokemons:[mon(['Splash'])]},drifts:[],equipped:[]},'wild');await verify(mode);assert(battle.finished&&p.alive&&!p.inbattle);assert.equal(p.equipe.pokemons[0].heldItem,item);
 }
 await expedition('colosseum','choice_specs');const p=cleanup.runtime.playerFor(a.user);cleanup.runtime.abandon(p);store.leave(a.user);await page.goto(base+'/colosseum',{waitUntil:'networkidle'});
 store.connect(a.user,'choice-host');store.connect(b.user,'choice-guest');const lobby=store.create(a.user,{capacity:2,durationMinutes:30});store.join(b.user,lobby.code);for(const f of[a,b])store.ready(f.user,true);await cleanup.runtime.start(a.user);for(const f of[a,b]){const p=cleanup.runtime.playerFor(f.user);cleanup.runtime.chooseStarter(p,p.starterChoices[0].uuid);}
 await page.goto(base+'/drift/game',{waitUntil:'networkidle'});await ready();await expedition('rift','choice_scarf');
 assert.deepEqual(errors,[]);success=true;const result={modes,items:['choice_band','choice_specs','choice_scarf'],realBattleSockets:true,unchangedClient:true,disabledChoices:true,rejectedInputNoTurnCost:true,switchResetsLock:true,viewports:4,errors,out};fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{Math.random=oldRandom;require.cache[factoryPath].exports=originalFactory;if(!success&&page&&!page.isClosed()){await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});console.error(await page.evaluate(()=>({map:window.v?.map,battle:window.v?.battle,text:document.body.innerText.slice(-1200)})).catch(()=>null));}await browser?.close();cleanup();await new Promise(r=>io.close(r));await new Promise(r=>setTimeout(r,200));for(const id of ids)await db.execute('DELETE FROM users WHERE id=?',[id]);await db.end();}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
