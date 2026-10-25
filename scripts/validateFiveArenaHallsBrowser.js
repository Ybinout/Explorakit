// Real game rendering with a disposable player and an isolated test database.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(!/test/i.test(process.env.DB_TEST_NAME||''))throw Error('Dedicated test database required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';
const express=require('express'),{Server}=require('socket.io'),{chromium}=require('playwright'),{dbPool}=require('../server/config/database');
const output=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-five-halls-browser';fs.mkdirSync(output,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server);app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(process.env.RELEASE_DIST_DIR||'/tmp/riftmon-five-halls-dist'));app.get('*',(_q,r)=>r.sendFile(path.resolve(process.env.RELEASE_DIST_DIR||'/tmp/riftmon-five-halls-dist','index.html')));
const cleanup=require('../server/realtime/driftLobbyHandler').registerDriftLobbies(io,{checkpointRepository:{async save(){}},runtimeOptions:{random:()=>.9,paceMs:0}});
let browser,page,userId,success=false;const errors=[];
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 const response=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'five_halls_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(response.status,201);const fixture=await response.json();userId=fixture.user.id;
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true});await context.addInitScript(v=>localStorage.setItem('explorakit.user',JSON.stringify(v)),{...fixture.user,token:fixture.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().startsWith(base)&&r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
 await page.goto(base+'/colosseum',{waitUntil:'networkidle'});await page.locator('[data-colosseum-start]:enabled').click();await page.locator('[data-starter-choice]').first().click();await page.locator('.starter-backdrop').waitFor({state:'hidden'});
 await page.waitForFunction(()=>{let e=document.querySelector('.game-stage');while(e&&!e.__vue__)e=e.parentElement;if(!e?.__vue__?.socket?.connected)return false;window.v=e.__vue__;return true;});
 await page.evaluate(()=>v.updatePreferences({...v.preferences,masterVolume:0}));const player=cleanup.runtime.playerFor({id:userId});

 const world=require('../data/game/nextMap.json').maps;
 await page.evaluate(()=>{v.showMobileControls=true;v.preferences.textSpeed=10000;v.preferences.animationsEnabled=false;});
 const halls=[['ville1_arene','moonpunch','moon'],['ville_safe1_arene','hoze','champion_hoze'],['gen_arene5','raphael','champion_raphael'],['ville3_arene','ana','champion_ana'],['ville4_arene','wanda','champion_wanda']];
 if(process.env.VALIDATE_ALL_ARENAS==='1')halls.push(['ville5_arene','sevenp','champion_7p']);
 for(const [map,champion,dialogue] of halls){
  const city=world.find(m=>m.mapchange.some(c=>c.goto===map)),door=city.mapchange.find(c=>c.goto===map);
  Object.assign(player,{currentmap:city.mapName,x:door.valX*32+16,y:(door.valY+1)*32+16});cleanup.runtime.enter(fixture.user,{id:player.socketId});
  await page.waitForFunction(m=>v.map===m&&v.renderedMap===m&&!v.mapLoading,city.mapName);
  await page.waitForTimeout(180);await page.locator('.mobile-dpad-up').click();
  await page.waitForFunction(m=>v.map===m&&v.renderedMap===m&&!v.mapLoading,map);
  // The current arena entrance scene hides the directional pad until read.
  for(let n=0;n<10&&await page.locator('.dialogue-layer .text').count();n++){
   await page.locator('.dialogue-layer .text').click();await page.waitForTimeout(70);
  }
  assert.equal(await page.locator('.dialogue-layer .text').count(),0);
  for(let y=15;y>=5;y--){await page.waitForTimeout(180);await page.locator('.mobile-dpad-up').click();await page.waitForFunction(y=>Math.floor(v.players[v.socket.id].y/32)===y,y);}
  const actor=await page.evaluate(name=>v.pnjs.find(p=>p.name===name),champion);assert(actor);assert.equal(actor.y,4);
  for(const [width,height]of [[320,568],[393,852],[844,390],[1365,900]]){
   await page.setViewportSize({width,height});await page.evaluate(w=>v.showMobileControls=w<=920,width);await page.waitForTimeout(180);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   assert(await page.evaluate(()=>{const c=v.$refs.monCanvas;return c.width>0&&v._placeAmbience?.canvas&&!v.movementBlocked;}));
   await page.screenshot({path:path.join(output,`${map}-${width}.png`)});
  }
  await page.setViewportSize({width:393,height:852});await page.evaluate(()=>v.showMobileControls=true);
  await page.evaluate(()=>v.socket.emit('Space'));await page.waitForFunction(d=>v.endSentences===d,dialogue);
  await page.evaluate(()=>v.clearSequence());await page.locator('.action-attack:enabled').waitFor();
  const battle=[...player.run.battles].find(b=>!b.finished);assert(battle);assert.equal(battle.type,'arena');
  battle.finish(null,'fled');await page.locator('[data-battle-result-continue]').click();await page.waitForFunction(()=>!v.movementBlocked&&v._placeAmbience?.canvas);
  for(let y=6;y<=16;y++){await page.waitForTimeout(180);await page.locator('.mobile-dpad-down').click();await page.waitForFunction(y=>Math.floor(v.players[v.socket.id].y/32)===y,y);}
  // Both authored exit cells must work; alternate the right and left door.
  if(champion==='hoze'||champion==='wanda'){await page.waitForTimeout(180);await page.locator('.mobile-dpad-right').click();await page.waitForFunction(()=>Math.floor(v.players[v.socket.id].x/32)===14);}
  await page.waitForTimeout(180);await page.locator('.mobile-dpad-down').click();await page.waitForFunction(m=>v.map===m&&!v.mapLoading,city.mapName);
  assert.deepEqual([Math.floor(player.x/32),Math.floor(player.y/32)],[door.valX,door.valY+1]);
 }
 assert.deepEqual(errors,[]);success=true;console.log(JSON.stringify({halls:halls.length,realCityEntrances:true,realNpcDialogues:true,arenaBattles:true,returnWithoutReconnect:true,bothExitCells:true,viewports:4,errors,output}));
}finally{if(!success&&page)await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});await browser?.close();cleanup();await new Promise(r=>io.close(r));if(userId)await dbPool.execute('DELETE FROM users WHERE id=?',[userId]);await dbPool.end();}})().catch(e=>{console.error(e.stack);process.exitCode=1});
