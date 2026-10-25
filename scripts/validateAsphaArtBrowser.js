const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(!/test/i.test(process.env.DB_TEST_NAME||''))throw Error('Dedicated test database required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';process.env.BATTLE_DELAY_SCALE='0';
const express=require('express'),{Server}=require('socket.io'),{chromium}=require('playwright');
const {dbPool:db}=require('../server/config/database');
const dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-aspha-art-dist',out=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-aspha-art-browser';fs.mkdirSync(out,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server);
app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
const ids=[],errors=[];let browser,page,success=false;
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(!v?.socket?.connected||!v.players[v.socket.id]||v.mapLoading||v.renderedMap!==v.map)return false;window.v=v;return true;});}
async function step(action){await page.evaluate(a=>v.socket.emit('playerAction',a),action);await page.waitForTimeout(400);}
async function dialogueDone(){for(let i=0;i<16&&await page.locator('.dialogue-layer .text').count();i++){await page.locator('.dialogue-layer .text').click();await page.waitForTimeout(90);}}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 async function create(){const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'aspha_ui_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(r.status,201);const u=await r.json();ids.push(u.user.id);return u;}
 const u=await create();await db.execute("UPDATE users SET map='route2',x=816,y=208 WHERE id=?",[u.user.id]);
 const lead=require('../server/game/drift/pokemonFactory').create(150,200,true);lead.k=4;lead.recalculateStats();lead.currentHp=lead.maxHp;lead.abilities=[];lead.movePp=[];for(const move of ['Ice Beam','Aura Sphere','Shadow Ball','Recover'])lead.addAbility(move);await require('../server/persistence/teamRepository').editEquipe(u.user.id,{pokemons:[lead]});
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const ctx=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true});
 await ctx.addInitScript(s=>{if(location.protocol.startsWith('http'))localStorage.setItem('explorakit.user',JSON.stringify(s));},{...u.user,token:u.token});page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().startsWith(base)&&r.status()>=400)errors.push(r.status()+' '+r.url());});await page.goto(base+'/game',{waitUntil:'networkidle'});await ready();
 async function at(map,x,y){const saved=await page.evaluate(()=>new Promise(r=>v.socket.emit('requestGameSave',r)));assert(saved.success);await page.evaluate(()=>v.socket.disconnect());await page.waitForTimeout(200);await db.execute('UPDATE users SET map=?,x=?,y=? WHERE id=?',[map,x*32+16,y*32+16,u.user.id]);await page.reload({waitUntil:'networkidle'});await ready();}
 // Real trainer position and personal prerequisite: Wayne already defeated.
 await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value)VALUES(?,'route_guard_defeated','true')",[u.user.id]);await at('route2',24,5);
 for(const [width,height]of [[320,568],[393,852],[1365,900]]){await page.setViewportSize({width,height});await page.evaluate(w=>v.showMobileControls=w<920,width);await page.waitForTimeout(150);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(out,`route-${width}.png`)});}
 await page.setViewportSize({width:393,height:852});await page.evaluate(()=>v.showMobileControls=true);await step('move_z');assert.equal(await page.evaluate(()=>Math.floor(v.players[v.socket.id].y/32)),5);
 await step('move_d');await step('move_d');assert.equal(await page.evaluate(()=>Math.floor(v.players[v.socket.id].x/32)),25,'exit stays locked before victory');await step('move_q');
 await page.evaluate(()=>{window.triggers=[];v.socket.on('battletrigger',p=>triggers.push(p));v.socket.emit('Space');});await page.waitForFunction(()=>v.endSentences==='aspha_route2'&&v.textImageSequence.length);await page.locator('.dialogue-layer .text').click();await page.screenshot({path:path.join(out,'aspha-dialogue.png')});await dialogueDone();
 await page.waitForSelector('[data-arena-intro]');await page.waitForFunction(()=>document.querySelector('.entrance-portrait')?.naturalWidth>0);assert.equal(await page.evaluate(()=>triggers.at(-1).trainerKey),'aspha_route2');await page.screenshot({path:path.join(out,'aspha-intro.png')});
 await page.waitForSelector('[data-battle-entrance]',{state:'detached',timeout:15000});
 await page.evaluate(()=>{v.socket.on('requestAction',()=>v.socket.emit('actionResponse',{action:'attack',number:0}));v.socket.emit('actionResponse',{action:'attack',number:0});});
 await page.waitForFunction(()=>!v.battle,null,{timeout:90000});await dialogueDone();await page.waitForFunction(()=>v.battleResult);await page.evaluate(()=>v.dismissBattleResult());
 const state=await require('../server/persistence/progressionRepository').loadProgressState(u.user.id);assert.equal(state.flags.aspha_route2_defeated,'true');
 // The new two-column actor must not obstruct the eastward path after victory.
 await step('move_d');await step('move_d');await step('move_d');
 await page.waitForFunction(()=>v.map==='ville1');
 // Return through the actual Lake Town exit, then traverse both lanes.
 await at('ville1',1,6);await step('move_q');await page.waitForFunction(()=>v.map==='route2');
 await step('move_q');await step('move_q');assert.equal(await page.evaluate(()=>Math.floor(v.players[v.socket.id].x/32)),25);
 for(const y of [5,6]){
  await at('route2',26,y);await step('move_q');await step('move_q');
  assert.equal(await page.evaluate(()=>Math.floor(v.players[v.socket.id].x/32)),24);
  await step('move_d');await step('move_d');await step('move_d');await page.waitForFunction(()=>v.map==='ville1');
 }

 assert.deepEqual(errors,[]);success=true;console.log(JSON.stringify({sprite:true,dialogue:true,realVictory:true,exitOpen:true,returnOpen:true,bothLanes:true,trainerSplash:true,viewports:3,errors,out}));
}finally{if(!success&&page&&!page.isClosed()){await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});console.error(await page.evaluate(()=>({map:window.v?.map,speech:window.v?.endSentences,notices:document.body.innerText.slice(-1000)})).catch(()=>null));}await browser?.close();await new Promise(r=>io.close(r));await new Promise(r=>setTimeout(r,200));for(const id of ids)await db.execute('DELETE FROM users WHERE id=?',[id]);await db.end();}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
