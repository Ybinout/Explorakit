const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(!/test/i.test(process.env.DB_TEST_NAME||''))throw Error('Dedicated test database required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';process.env.BATTLE_DELAY_SCALE='0';
const express=require('express'),{Server}=require('socket.io'),{chromium}=require('playwright');
const {dbPool:db}=require('../server/config/database');
const dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-nrv-dist',out=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-nrv-browser';fs.mkdirSync(out,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server);
app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
const ids=[],errors=[];let browser,page,success=false;
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(!v?.socket?.connected||!v.players[v.socket.id]||v.mapLoading||v.renderedMap!==v.map)return false;window.v=v;return true;});}
async function step(action,count=1){for(let i=0;i<count;i++){await page.evaluate(a=>v.socket.emit('playerAction',a),action);await page.waitForTimeout(220);}}
async function dialogueDone(){for(let i=0;i<20&&await page.locator('.dialogue-layer .text').count();i++){await page.locator('.dialogue-layer .text').click();await page.waitForTimeout(90);}}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 async function create(){const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'nrv_ui_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(r.status,201);const u=await r.json();ids.push(u.user.id);return u;}
 const u=await create(),other=await create();await db.execute("UPDATE users SET map='route3',x=752,y=464 WHERE id=?",[u.user.id]);
 const lead=require('../server/game/drift/pokemonFactory').create(150,200,true);lead.k=4;lead.recalculateStats();lead.currentHp=lead.maxHp;lead.abilities=[];lead.movePp=[];for(const move of ['Dark Pulse','Aura Sphere','Ice Beam','Recover'])lead.addAbility(move);await require('../server/persistence/teamRepository').editEquipe(u.user.id,{pokemons:[lead]});
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const ctx=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true});
 await ctx.addInitScript(s=>{if(location.protocol.startsWith('http'))localStorage.setItem('explorakit.user',JSON.stringify(s));},{...u.user,token:u.token});page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().startsWith(base)&&r.status()>=400)errors.push(r.status()+' '+r.url());});await page.goto(base+'/game',{waitUntil:'networkidle'});await ready();
 async function at(map,x,y){const saved=await page.evaluate(()=>new Promise(r=>v.socket.emit('requestGameSave',r)));assert(saved.success);await page.evaluate(()=>v.socket.disconnect());await page.waitForTimeout(200);await db.execute('UPDATE users SET map=?,x=?,y=? WHERE id=?',[map,x*32+16,y*32+16,u.user.id]);await page.reload({waitUntil:'networkidle'});await ready();}
 await page.screenshot({path:path.join(out,'roof-393.png')});await step('move_z');await page.waitForFunction(()=>v.map==='route3_maison_nrv'&&!v.mapLoading&&v.renderedMap===v.map);assert.deepEqual(await page.evaluate(()=>[Math.floor(v.players[v.socket.id].x/32),Math.floor(v.players[v.socket.id].y/32)]),[13,16]);
 assert.deepEqual(await page.evaluate(()=>v.pnjs.map(p=>p.name).sort()),['nrv_cry','nrv_noz','nrv_tom']);
 const draws=await page.evaluate(async()=>{const image=v.ensurePnjSpriteSheet('townspeople.png');await image.decode();const c=document.createElement('canvas');c.width=896;c.height=640;const g=c.getContext('2d'),draw=g.drawImage,calls=[];g.drawImage=function(img,...a){calls.push(a.slice(0,4));return draw.call(this,img,...a);};v.drawPnjs(g);return calls;});assert.deepEqual(draws,[[367,417,17,25],[558,288,17,26],[654,290,17,24]]);
 for(const [width,height]of [[320,568],[393,852],[1365,900]]){await page.setViewportSize({width,height});await page.waitForTimeout(150);await page.evaluate(async w=>{v.showMobileControls=w<=920;await v.$nextTick();v.resizeWorldViewport();},width);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(out,`house-${width}.png`)});}
 await page.setViewportSize({width:393,height:852});await page.waitForTimeout(150);await page.evaluate(()=>v.showMobileControls=true);
 async function fight(name){
  await page.evaluate(()=>v.socket.emit('Space'));await page.waitForFunction(n=>v.endSentences===n&&v.textImageSequence.length,name);await page.locator('.dialogue-layer .text').click();
  await page.waitForFunction(()=>[...document.querySelectorAll('.dialogue-layer img')].some(i=>i.complete&&i.naturalWidth>0));await page.screenshot({path:path.join(out,name+'-dialogue.png')});assert(await page.evaluate(n=>v.textImageSequence[0].image.includes(n.replace('_','-')+'-v1'),name));await dialogueDone();
  await page.waitForFunction(()=>v.battle);await page.waitForSelector('[data-battle-entrance]',{state:'detached',timeout:15000});await page.screenshot({path:path.join(out,name+'-battle.png')});
  await page.evaluate(()=>{if(!window.autoNrv){window.autoNrv=true;v.socket.on('requestAction',()=>v.socket.emit('actionResponse',{action:'attack',number:0}));}v.socket.emit('actionResponse',{action:'attack',number:0});});
  await page.waitForFunction(()=>!v.battle,null,{timeout:90000});await dialogueDone();await page.waitForFunction(()=>v.battleResult);await page.evaluate(()=>v.dismissBattleResult());
  const state=await require('../server/persistence/progressionRepository').loadProgressState(u.user.id);assert.equal(state.flags[name+'_defeated'],'true');console.log('Victory '+name);
 }
 await step('move_q',3);await step('move_z',6);await step('move_z');assert.equal(await page.evaluate(()=>Math.floor(v.players[v.socket.id].y/32)),10,'NOZ blocks his own tile');await fight('nrv_noz');
 await step('move_s',2);await step('move_d',6);await step('move_z',3);await step('move_d');await fight('nrv_tom');
 await step('move_q');await step('move_s',5);await step('move_d');await fight('nrv_cry');
 await step('move_q',4);await step('move_s',3);await page.waitForFunction(()=>v.map==='route3'&&!v.mapLoading);assert.deepEqual(await page.evaluate(()=>[Math.floor(v.players[v.socket.id].x/32),Math.floor(v.players[v.socket.id].y/32)]),[23,14]);
 await step('move_z');await page.waitForFunction(()=>v.map==='route3_maison_nrv'&&!v.mapLoading);await at('route3_maison_nrv',10,10);await page.evaluate(()=>v.socket.emit('Space'));await page.waitForFunction(()=>v.endSentences==='nrv_noz_after');assert(!await page.evaluate(()=>v.battle));await dialogueDone();
 const state=await require('../server/persistence/progressionRepository').loadProgressState(other.user.id);for(const n of ['noz','tom','cry'])assert.equal(state.flags['nrv_'+n+'_defeated'],undefined);assert.deepEqual(errors,[]);success=true;console.log(JSON.stringify({realDoorEntryAndExit:true,threeRealVictories:true,persistentPersonalWins:true,solidNpc:true,nativeSpriteCrops:true,illustratedPortraits:true,viewports:3,errors,out}));
}finally{if(!success&&page&&!page.isClosed()){await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});console.error(await page.evaluate(()=>({map:window.v?.map,position:window.v?.players[window.v?.socket?.id],speech:window.v?.endSentences,notices:document.body.innerText.slice(-600)})).catch(()=>null));}await browser?.close();await new Promise(r=>io.close(r));await new Promise(r=>setTimeout(r,200));for(const id of ids)await db.execute('DELETE FROM users WHERE id=?',[id]);await db.end();}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
