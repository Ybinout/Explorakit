// Real gym completion and canvas recovery, on an isolated test database only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(!/test/i.test(process.env.DB_TEST_NAME||''))throw Error('Dedicated test DB required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';process.env.BATTLE_DELAY_SCALE='0';
const express=require('express'),{Server}=require('socket.io'),{chromium}=require('playwright'),{dbPool}=require('../server/config/database');
const dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-arena-return-dist',output=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-arena-return-browser';fs.mkdirSync(output,{recursive:true});
// Keep the actual six-member teams/AI and victory pipeline; low opponent HP
// makes this a lifecycle test rather than a long balance simulation.
const teams=require('../server/game/world/pnjTeamFactory'),originalTeam=teams.getPnjTeam;
teams.getPnjTeam=name=>{const t=originalTeam(name);if(['wanda','sevenp'].includes(name))for(const p of t.pokemons){p.currentHp=1;p.heldItem=null;}return t;};
const app=express(),server=http.createServer(app),io=new Server(server);app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
let browser,page,userId,success=false;const errors=[];
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(!v?.socket?.connected||v.mapLoading||v.renderedMap!==v.map||!v.players[v.socket.id])return false;window.returnVm=v;return true;});}
async function scene(){return page.evaluate(()=>{const v=window.returnVm,c=v.$refs.monCanvas,ctx=c.getContext('2d'),a=ctx.getImageData(0,0,c.width,c.height).data;let opaque=0;for(let i=3;i<a.length;i+=4)if(a[i])opaque++;const t=ctx.getTransform();return{opaque:opaque/(a.length/4),identity:t.isIdentity,blocked:!!v.movementBlocked,x:v.players[v.socket.id].x,y:v.players[v.socket.id].y,frame:v.lastAnimationTimestamp};});}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'arena_return_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(r.status,201);const fixture=await r.json();userId=fixture.user.id;
 const lead=require('../server/game/drift/pokemonFactory').create(150,100,true);lead.k=4;lead.recalculateStats();lead.currentHp=lead.maxHp;lead.abilities=[];for(const move of ['Dark Pulse','Aura Sphere','Ice Beam','Recover'])lead.addAbility(move);
 await require('../server/persistence/teamRepository').editEquipe(userId,{pokemons:[lead]});
 const catalog=require('../data/game/progression.json');for(const step of catalog.storySteps.slice(0,6))await dbPool.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value)VALUES(?,?,?)ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)',[userId,step.flag,'true']);
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true});await context.addInitScript(s=>{if(location.protocol==='http:')localStorage.setItem('explorakit.user',JSON.stringify(s));},{...fixture.user,token:fixture.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await dbPool.execute('UPDATE users SET map=?,x=432,y=176 WHERE id=?',['ville4_arene',userId]);await page.goto(base+'/game',{waitUntil:'networkidle'});await ready();
 // A browser reports complete=true even for a broken image. This used to throw
 // inside drawImage, leave the canvas transformed and permanently stop RAF.
 const broken=await page.evaluate(async()=>{const v=window.returnVm,img=new Image();img.src='data:image/png;base64,AA==';await img.decode().catch(()=>{});const original=v.pnjSpriteSheets;v.pnjSpriteSheets=Object.fromEntries(v.pnjs.map(p=>[p.sprite,img]));let failure=null;try{v.drawPlayers();}catch(e){failure=e.name;}const identity=v.$refs.monCanvas.getContext('2d').getTransform().isIdentity;v.pnjSpriteSheets=original;return{failure,identity};});
 if(process.argv.includes('--probe-old')){console.log(JSON.stringify({oldBuildBrokenImage:broken}));success=true;return;}
 assert.deepEqual(broken,{failure:null,identity:true});
 const before=await scene();await page.evaluate(()=>{const v=window.returnVm,draw=v.drawPnjs;v.drawPnjs=function(...args){v.drawPnjs=draw;throw Error('intentional one-frame renderer fault');};});await page.waitForTimeout(150);const after=await scene();assert(after.frame>before.frame);assert(after.identity);assert(after.opaque>.95);
 // Loss/restoration and return from a background tab must keep the same scene.
 await page.evaluate(()=>window.returnVm.$refs.monCanvas.dispatchEvent(new Event('contextlost',{cancelable:true})));assert(await page.evaluate(()=>window.returnVm.worldContextLost));await page.evaluate(()=>window.returnVm.$refs.monCanvas.dispatchEvent(new Event('contextrestored')));await page.waitForTimeout(100);assert((await scene()).opaque>.95);
 for(const [name,map,flag]of [['champion_wanda','ville4_arene','wanda_defeated'],['champion_7p','ville5_arene','sevenp_defeated']]){
  if(name==='champion_7p'){await page.evaluate(()=>new Promise(r=>window.returnVm.socket.emit('requestGameSave',()=>{window.returnVm.socket.disconnect();r();})));await page.goto('about:blank');await page.waitForTimeout(200);await dbPool.execute('UPDATE users SET map=?,x=432,y=272 WHERE id=?',['ville5',userId]);await page.goto(base+'/game',{waitUntil:'networkidle'});await ready();}
  if(name==='champion_7p'){
   // Enter through the real city door, then walk the new centre aisle to 7p.
   await page.locator('.mobile-dpad-up').click();
   await page.waitForFunction(()=>window.returnVm.map==='ville5_arene'&&!window.returnVm.mapLoading);
   for(let y=15;y>=5;y--){await page.waitForTimeout(160);await page.locator('.mobile-dpad-up').click();await page.waitForFunction(y=>Math.floor(window.returnVm.players[window.returnVm.socket.id].y/32)===y,y);}
   await page.screenshot({path:path.join(output,'sevenp-approach.png')});
  }
  const socketId=await page.evaluate(()=>window.returnVm.socket.id);
  await page.evaluate(()=>{const v=window.returnVm;v.preferences.animationsEnabled=false;v.preferences.textSpeed=10000;v.socket.emit('Space');});await page.waitForFunction(n=>window.returnVm.endSentences===n,name);await page.evaluate(()=>window.returnVm.clearSequence());await page.waitForFunction(()=>window.returnVm.battle);
  for(let i=0;i<20;i++){
   await page.waitForFunction(()=>window.returnVm.battleResult||document.querySelector('.action-attack:not(:disabled)'));
   if(await page.evaluate(()=>!!window.returnVm.battleResult))break;
   await page.locator('.action-attack:enabled').click();await page.locator('.battle-grid-attacks button:enabled').first().click();await page.waitForTimeout(350);
  }
  await page.waitForFunction(()=>!!window.returnVm.battleResult);assert.equal(await page.evaluate(()=>window.returnVm.battleResult.outcome),'victory');
  await page.locator('[data-battle-result] button').click();await page.waitForFunction(()=>window.returnVm.textImageSequence.length>0);await page.evaluate(()=>window.returnVm.clearSequence());await page.waitForFunction(()=>!window.returnVm.movementBlocked);
  // A delayed visual packet must not relock the world after the result.
  io.to(socketId).emit('introAnimation',{player:{},wildPokemon:{}});await page.waitForTimeout(100);assert.equal((await scene()).blocked,false);
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('pageshow'));});await page.waitForTimeout(150);
  assert.equal(await page.evaluate(()=>window.returnVm.socket.id),socketId,'no reconnect required');
  const start=await scene();assert(start.opaque>.95&&start.identity);await page.locator('.mobile-dpad-down').click();await page.waitForFunction(y=>window.returnVm.players[window.returnVm.socket.id].y>y,start.y);
  assert.equal(await page.evaluate(f=>window.returnVm.progressionState.flags[f],flag),'true');
  for(const [w,h]of [[320,568],[393,852],[844,390],[1365,900]]){await page.setViewportSize({width:w,height:h});await page.evaluate(w=>window.returnVm.showMobileControls=w<=920,w);await page.waitForTimeout(100);assert((await scene()).opaque>.95);await page.screenshot({path:path.join(output,`${name}-${w}.png`)});}
  await page.setViewportSize({width:393,height:852});await page.evaluate(()=>window.returnVm.showMobileControls=true);
  if(name==='champion_7p'){
   for(let y=7;y<=16;y++){await page.waitForTimeout(160);await page.locator('.mobile-dpad-down').click();await page.waitForFunction(y=>Math.floor(window.returnVm.players[window.returnVm.socket.id].y/32)===y,y);}
   await page.waitForTimeout(160);await page.locator('.mobile-dpad-down').click();await page.waitForFunction(()=>window.returnVm.map==='ville5'&&!window.returnVm.mapLoading);
   assert.equal(Math.floor((await scene()).y/32),8,'back outside the real arena door');
  }
 }
 // A rejected animation promise still produces the authoritative result.
 await page.evaluate(async()=>{const v=window.returnVm,o=v.$refs.battleOverlay,finish=o.finishPresentation;o.finishPresentation=()=>Promise.reject(Error('intentional effect failure'));await v.presentBattleEnd({playerWon:true,battleType:'arena'});o.finishPresentation=finish;});
 await page.locator('[data-battle-result] button').click();await page.waitForFunction(()=>!window.returnVm.movementBlocked);assert((await scene()).opaque>.95);
 assert.deepEqual(errors,[]);success=true;console.log(JSON.stringify({realGymVictories:['wanda','sevenp'],followUpDialogue:true,sevenpRealEntranceAndExit:true,moveWithoutReconnect:true,brokenSpriteSafe:true,transientRenderRecovery:true,contextRestored:true,backgroundResume:true,lateIntroIgnored:true,rejectedEffectStillShowsResult:true,viewports:4,errors,output}));
}finally{if(!success&&page)await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});await browser?.close();await new Promise(r=>io.close(r));await new Promise(r=>setTimeout(r,200));if(userId)await dbPool.execute('DELETE FROM users WHERE id=?',[userId]);await dbPool.end();}})().catch(e=>{console.error(e.stack);process.exitCode=1});
