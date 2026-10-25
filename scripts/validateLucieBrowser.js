// Adventure encounter with real Lucie roster/items/AI; disposable level-200 test lead.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const{once}=require('node:events'),{randomUUID}=require('node:crypto');
if(!/test/i.test(process.env.DB_TEST_NAME||''))throw Error('Dedicated test DB required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';process.env.BATTLE_DELAY_SCALE='0';
const express=require('express'),{Server}=require('socket.io'),{chromium}=require('playwright'),{dbPool}=require('../server/config/database');
const dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-lucie-dist',output=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-lucie-browser';fs.mkdirSync(output,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server);app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
let browser,page,userId,success=false;const errors=[];
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(!v?.socket?.connected||v.mapLoading||v.renderedMap!==v.map||!v.players[v.socket.id])return false;window.v=v;return true;});}
async function pictures(label){for(const[width,height]of [[320,568],[393,852],[1365,900]]){await page.setViewportSize({width,height});await page.evaluate(w=>v.showMobileControls=w<=920,width);await page.waitForTimeout(150);if(label==='battle'){const layout=await page.evaluate(()=>{const img=document.querySelector('[data-battle-environment="lucie-house"] img');return{src:img.currentSrc,platforms:document.querySelectorAll('.gym-disc').length};});assert(layout.src.includes(width<=920?'lucie-house-mobile':'lucie-house-wide'));assert.equal(layout.platforms,1);}assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(output,`${label}-${width}.png`)});}await page.setViewportSize({width:393,height:852});await page.evaluate(()=>v.showMobileControls=true);}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'lucie_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(r.status,201);const fixture=await r.json();userId=fixture.user.id;
 const lead=require('../server/game/drift/pokemonFactory').create(150,200,true);lead.k=4;lead.recalculateStats();lead.currentHp=lead.maxHp;lead.abilities=[];lead.movePp=[];for(const move of ['Dark Pulse','Aura Sphere','Ice Beam','Recover'])lead.addAbility(move);
 await require('../server/persistence/teamRepository').editEquipe(userId,{pokemons:[lead]});
 const catalog=require('../data/game/progression.json');for(const flag of [...catalog.storySteps.slice(0,-1).map(s=>s.flag),'lucie_reunited'])await dbPool.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value)VALUES(?,?,?)ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)',[userId,flag,'true']);
 await dbPool.execute("UPDATE users SET map='route2_maison',x=432,y=? WHERE id=?",[process.env.VALIDATE_ROOM_BARRIERS==='1'?528:208,userId]);
 if(process.env.VALIDATE_ROOM_BARRIERS==='1')await dbPool.execute("UPDATE users SET map='route2',x=592,y=272 WHERE id=?",[userId]);
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true});await context.addInitScript(s=>localStorage.setItem('explorakit.user',JSON.stringify(s)),{...fixture.user,token:fixture.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().startsWith(base)&&r.status()>=400)errors.push(r.status()+' '+r.url());});
 await page.goto(base+'/game',{waitUntil:'networkidle'});await ready();
 if(process.env.VALIDATE_ROOM_BARRIERS==='1'){
  await page.route('**/img/route2_maison.*.png',async route=>{await new Promise(r=>setTimeout(r,700));await route.continue();});
  await page.waitForTimeout(200);await page.evaluate(()=>v.socket.emit('playerAction','move_z'));
  await page.waitForFunction(()=>v.pendingRoomEntry&&v.mapLoading);
  assert.equal(await page.locator('.dialogue-shell').count(),0,'warning waits for the room to decode');
  await page.waitForFunction(()=>v.map==='route2_maison'&&v.renderedMap===v.map&&!v.mapLoading);
 }
 await page.waitForFunction(()=>v.pnjSpriteSheets['lucie-pixel-v2.png']?.complete&&v.pnjSpriteSheets['lucie-pixel-v2.png'].naturalWidth===24);
 assert(await page.evaluate(()=>v.mapImage.src.includes('route2_maison')));
 await pictures('house');
 if(process.env.VALIDATE_ROOM_BARRIERS==='1'){
  await page.waitForFunction(()=>v.endSentences==='lucie_room_entry'&&v.textImageSequence.length>0);
  assert(await page.evaluate(()=>v.textImageSequence[0].text.includes('n’entre pas')&&v.renderedMap===v.map&&!v.mapLoading));
  await pictures('entry-warning');
  for(let n=0;n<12&&await page.locator('.dialogue-shell').count();n++){await page.locator('.dialogue-layer .text').click();await page.waitForTimeout(100);}
  await page.waitForFunction(()=>!v.movementBlocked);
  await page.evaluate(()=>v.updatePreferences({...v.preferences,animationsEnabled:true,masterVolume:35}));
  let row=16;
  for(const [index,stop]of [16,12,9].entries()){
   while(row>stop){await page.waitForTimeout(380);await page.evaluate(()=>v.socket.emit('playerAction','move_z'));row--;await page.waitForFunction(y=>v.players[v.socket.id].y===y*32+16,row);}
   if(index===1){await page.setViewportSize({width:1365,height:900});await page.evaluate(()=>v.showMobileControls=false);}
   else{await page.setViewportSize({width:393,height:852});await page.evaluate(()=>v.showMobileControls=true);}
   if(index===2)await page.evaluate(()=>v.updatePreferences({...v.preferences,animationsEnabled:false}));
   const started=Date.now();if(index===1)await page.keyboard.press('Space');else await page.locator('.mobile-action-a').click();await page.locator('.room-obstacle-action').waitFor();
   assert(await page.evaluate(()=>v.movementBlocked));
   assert.match(await page.locator('.room-obstacle-label').innerText(),/toutes tes forces/);
   await page.waitForFunction(()=>{const a=v._worldMusic?.tracks.get('lucie-room');return a&&!a.paused&&a.currentTime>.1;});
   const before=await page.evaluate(()=>v._worldMusic.tracks.get('lucie-room').currentTime);await page.waitForTimeout(350);
   assert(await page.evaluate(t=>v._worldMusic.tracks.get('lucie-room').currentTime>t,before));
   await page.screenshot({path:path.join(output,`clearing-${index+1}.png`)});
   await page.locator('.room-obstacle-hits i.hit').first().waitFor();
   await page.screenshot({path:path.join(output,`strike-${index+1}.png`)});
   assert.equal(await page.locator('.room-obstacle-hits i').count(),5);
   await page.waitForFunction(()=>document.querySelectorAll('.room-obstacle-hits i.hit').length===3);
   assert(await page.evaluate(()=>!v.progressionState.flags[v.roomObstacleAction.id+'_cleared']),'third hit does not clear the obstacle');
   await page.waitForFunction(()=>document.querySelectorAll('.room-obstacle-hits i.hit').length===5);
   await page.screenshot({path:path.join(output,`fifth-strike-${index+1}.png`)});
   await page.locator('.room-obstacle-action.is-complete').waitFor();
   assert.match(await page.locator('.room-obstacle-confirm').innerText(),/Passage dégagé/);
   await page.screenshot({path:path.join(output,`cleared-${index+1}.png`)});
   await page.locator('.room-obstacle-action').waitFor({state:'hidden'});assert(Date.now()-started>=4050);
   await page.waitForFunction(key=>v.progressionState.flags[key]==='true',`lucie_barricade_${index+1}_cleared`);
   await page.waitForTimeout(1150);
  }
  while(row>6){await page.waitForTimeout(380);await page.evaluate(()=>v.socket.emit('playerAction','move_z'));row--;await page.waitForFunction(y=>v.players[v.socket.id].y===y*32+16,row);}
  await page.reload({waitUntil:'networkidle'});await ready();assert(await page.evaluate(()=>[1,2,3].every(i=>v.progressionState.flags[`lucie_barricade_${i}_cleared`]==='true')));
  assert.equal(await page.locator('.dialogue-shell').count(),0,'entry warning does not repeat after clearing');
 }
 if(process.env.ROOM_BARRIERS_ONLY==='1'){assert.deepEqual(errors,[]);success=true;console.log(JSON.stringify({barriers:3,strikesEach:5,thirdHitStillBlocked:true,persisted:true,desktopAndMobile:true,reducedMotion:true,errors}));return;}
 await page.evaluate(()=>{v.updatePreferences({...v.preferences,animationsEnabled:true,textSpeed:10000,masterVolume:35});v.socket.emit('Space');});await page.waitForFunction(()=>v.endSentences==='lucie_route2'&&v.textImageSequence.length>0);
 await page.waitForTimeout(700);
 const typing=await page.evaluate(()=>{const d=document.querySelector('.dialogue-shell').__vue__;return{visible:d.displayedText.length,total:d.currentText.length,portrait:d.currentImageSrc,rect:document.querySelector('.text-with-image').getBoundingClientRect().height};});
 assert(typing.visible>0&&typing.visible<typing.total);assert(typing.portrait.includes('lucie-v1'));
 await page.locator('.dialogue-layer .text').click();
 assert(await page.evaluate(()=>{const d=document.querySelector('.dialogue-shell').__vue__;return d.displayedText===d.currentText&&d.currentIndex===0;}));
 assert(Math.abs(await page.locator('.text-with-image').evaluate(e=>e.getBoundingClientRect().height)-typing.rect)<1);
 await page.waitForFunction(()=>{const a=v._worldMusic?.tracks.get('lucie-room');return a&&!a.paused&&a.currentTime>.1;});
 const musicBefore=await page.evaluate(()=>v._worldMusic.tracks.get('lucie-room').currentTime);
 await page.waitForTimeout(400);assert(await page.evaluate(t=>v._worldMusic.tracks.get('lucie-room').currentTime>t,musicBefore));
 assert(await page.evaluate(()=>v.textImageSequence.some(s=>s.text.includes('Aube Obscure'))));await pictures('intro');
 const entranceStart=Date.now();await page.evaluate(()=>v.clearSequence());await page.waitForFunction(()=>v.battle);
 await page.locator('.is-story .portrait-ready').waitFor();
 assert.equal(await page.locator('.champion-heading h2').textContent(),'Lucie');
 await page.waitForFunction(()=>v._worldMusic.tracks.get('lucie-room').paused&&v.$refs.battleOverlay.musicKind==='lucie'&&!v.$refs.battleOverlay.music.paused);
 await pictures('splash');await page.locator('.action-attack:enabled').waitFor();assert(Date.now()-entranceStart>=4300);
 await page.waitForFunction(()=>{const image=document.querySelector('[data-battle-environment="lucie-house"] img');return image?.complete&&image.naturalWidth>0;});
 await pictures('battle');await page.evaluate(()=>v.updatePreferences({...v.preferences,animationsEnabled:false}));
 for(let i=0;i<30;i++){
  await page.waitForFunction(()=>v.battleResult||document.querySelector('.action-attack:not(:disabled)'));
  if(await page.evaluate(()=>!!v.battleResult))break;
  await page.locator('.action-attack:enabled').click();await page.locator('.battle-grid-attacks button:enabled').first().click();await page.waitForTimeout(120);
 }
 await page.waitForFunction(()=>!!v.battleResult);assert.equal(await page.evaluate(()=>v.battleResult.outcome),'victory');await page.locator('[data-battle-result] button').click();
 await page.waitForFunction(()=>v.endSentences==='lucie_route2_after'&&v.textImageSequence.length>0);assert.equal(await page.evaluate(()=>v.progressionState.flags.lucie_freed),'true');await pictures('reunion');
 await page.evaluate(()=>v.clearSequence());await page.waitForFunction(()=>!v.movementBlocked);
 await page.reload({waitUntil:'networkidle'});await ready();await page.evaluate(()=>v.socket.emit('Space'));await page.waitForFunction(()=>v.endSentences==='lucie_route2_after');assert.equal(await page.evaluate(()=>Boolean(v.battle)),false);
 assert.deepEqual(errors,[]);success=true;console.log(JSON.stringify({actualLucieTeam:true,legacySave:true,victory:true,followUp:true,noRematchAfterReload:true,viewports:3,slowDialogue:true,skippableTyping:true,stableDialogueHeight:true,lucieSplash:true,extendedEntrance:true,newRoom:true,newSprite:true,musicDuringDialogueAndEntrance:true,clearedRoomBarriers:process.env.VALIDATE_ROOM_BARRIERS==='1',errors}));
}finally{if(!success&&page)await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});await browser?.close();await new Promise(r=>io.close(r));await new Promise(r=>setTimeout(r,200));if(userId)await dbPool.execute('DELETE FROM users WHERE id=?',[userId]);await dbPool.end();}})().catch(e=>{console.error(e.stack);process.exitCode=1});
