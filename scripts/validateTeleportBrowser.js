// Isolated encounter fixture; authoritative movement, real battles and SQL.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(!/test/i.test(process.env.DB_TEST_NAME||''))throw Error('Dedicated test database required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';process.env.BATTLE_DELAY_SCALE='0';
const express=require('express'),{Server}=require('socket.io'),{chromium}=require('playwright'),{dbPool:db}=require('../server/config/database');
const factory=require('../server/game/drift/pokemonFactory'),teams=require('../server/persistence/teamRepository');
function mon(move,speed){const p=factory.create(63,20,true);p.passiveAbility=null;p.abilities=[];p.movePp=[];p.addAbility(move);p.currentSpeed=speed;return p;}
// Replace only this process's encounter factory, before loading its socket handler.
const factoryPath=require.resolve('../server/game/world/wildPokemonFactory'),originalFactory=require(factoryPath);require.cache[factoryPath].exports=async()=>mon('Teleport',999);
const dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-teleport-dist',out=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-teleport-browser';fs.mkdirSync(out,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server);app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
const store=require('../server/game/drift/lobbyStore').createLobbyStore(),cleanup=require('../server/realtime/driftLobbyHandler').registerDriftLobbies(io,{store,checkpointRepository:{async save(){}},runtimeOptions:{random:()=>.9,paceMs:0}});
let browser,page,success=false;const ids=[],errors=[],modes=[],oldRandom=Math.random;
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(!v?.socket?.connected||!v.players[v.socket.id]||v.mapLoading||v.renderedMap!==v.map)return false;window.v=v;if(window.listened!==v.socket){window.listened=v.socket;v.socket.on('endbattle',data=>window.lastEnd=data);}return true;});}
async function create(base){const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'teleport_ui_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(r.status,201);const f=await r.json();ids.push(f.user.id);return f;}
async function attack(){await page.locator('.action-attack:enabled').waitFor({timeout:20000});await page.locator('.action-attack:enabled').click();await page.locator('.battle-grid-attacks button:enabled').first().click();}
async function outcome(mode){await page.locator('[data-battle-result-continue]').waitFor({timeout:20000});
 const result=await page.evaluate(()=>lastEnd);assert.equal(result.reason,'fled');assert.equal(result.escapeActor,'opponent');assert.equal(result.summary.outcome,'fled');assert.equal(result.summary.money,0);assert.deepEqual(result.summary.loot,[]);assert.deepEqual(result.summary.experience,[]);assert.match(await page.locator('[role="dialog"]').innerText(),/Le Pokémon sauvage a fui/);
 for(const[width,height]of[[320,568],[393,852],[844,390],[1365,900]]){await page.setViewportSize({width,height});await page.waitForTimeout(100);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(out,mode+'-'+width+'.png')});}
 await page.locator('[data-battle-result-continue]').click();await page.waitForFunction(()=>!v.battle&&!v.battleResult&&!v.pendingBattleResult);modes.push(mode);
}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`,a=await create(base),b=await create(base);
 await teams.editEquipe(a.user.id,{pokemons:[mon('Splash',1)]});await db.execute("UPDATE users SET map='route1',x=176,y=48 WHERE id=?",[a.user.id]);
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true});await context.addInitScript(f=>{if(location.protocol.startsWith('http'))localStorage.setItem('explorakit.user',JSON.stringify(f));},{...a.user,token:a.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().startsWith(base)&&r.status()>=400)errors.push(r.status()+' '+r.url());});
 await page.goto(base+'/game',{waitUntil:'networkidle'});await ready();await page.keyboard.press('Shift');Math.random=()=>0;await page.evaluate(()=>v.socket.emit('playerAction','move_d'));await attack();await outcome('adventure');Math.random=()=>1;
 const before=await page.evaluate(()=>v.players[v.socket.id].x);await page.evaluate(()=>v.socket.emit('playerAction','move_d'));await page.waitForFunction(x=>v.players[v.socket.id].x>x,before);Math.random=oldRandom;
 await page.goto(base+'/colosseum',{waitUntil:'networkidle'});await page.locator('[data-colosseum-start]:enabled').click();await page.locator('[data-starter-choice]').first().click();await page.locator('.starter-backdrop').waitFor({state:'hidden'});await ready();
 async function expedition(mode){const p=cleanup.runtime.playerFor(a.user);p.equipe.pokemons=[mon('Splash',1)];Object.assign(p,{currentmap:'route1',x:208,y:48});cleanup.runtime.enter(a.user,{id:p.socketId});await page.waitForFunction(()=>v.map==='route1'&&!v.mapLoading);
  const hp=p.equipe.pokemons[0].currentHp,money=p.money,items=JSON.stringify(p.items),xp=p.equipe.pokemons[0].experience;
  const battle=cleanup.runtime.battle(p,{npc:true,equipe:{pokemons:[mon('Teleport',999)]},drifts:[],equipped:[]},'wild');await attack();await outcome(mode);assert(battle.finished&&p.alive&&!p.inbattle);assert.equal(p.money,money);assert.equal(JSON.stringify(p.items),items);assert.equal(p.equipe.pokemons[0].experience,xp);assert.equal(p.equipe.pokemons[0].currentHp,hp);
 }
 await expedition('colosseum');const p=cleanup.runtime.playerFor(a.user);cleanup.runtime.abandon(p);store.leave(a.user);await page.goto(base+'/colosseum',{waitUntil:'networkidle'});
 store.connect(a.user,'teleport-host');store.connect(b.user,'teleport-guest');const lobby=store.create(a.user,{capacity:2,durationMinutes:30});store.join(b.user,lobby.code);for(const f of[a,b])store.ready(f.user,true);await cleanup.runtime.start(a.user);for(const f of[a,b]){const p=cleanup.runtime.playerFor(f.user);cleanup.runtime.chooseStarter(p,p.starterChoices[0].uuid);}
 await page.goto(base+'/drift/game',{waitUntil:'networkidle'});await ready();await expedition('rift');
 assert.deepEqual(errors,[]);success=true;const result={modes,authoritativeEncounter:true,immediateEscape:true,opponentNamedCorrectly:true,noRewardsOrLoss:true,returnToWorld:true,viewports:4,errors,out};fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{Math.random=oldRandom;require.cache[factoryPath].exports=originalFactory;if(!success&&page&&!page.isClosed()){await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});console.error(await page.evaluate(()=>({map:window.v?.map,battle:window.v?.battle,result:window.lastEnd,text:document.body.innerText.slice(-1000)})).catch(()=>null));}await browser?.close();cleanup();await new Promise(r=>io.close(r));await new Promise(r=>setTimeout(r,200));for(const id of ids)await db.execute('DELETE FROM users WHERE id=?',[id]);await db.end();}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
