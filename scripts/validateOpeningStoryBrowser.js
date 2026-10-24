const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(!/test/i.test(process.env.DB_TEST_NAME||''))throw Error('Dedicated test database required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';
const express=require('express'),{Server}=require('socket.io'),{chromium}=require('playwright');
const {dbPool}=require('../server/config/database'),catalog=require('../data/game/progression.json');
const dist=process.env.RELEASE_DIST_DIR||'/tmp/explorakit-lucie-story-dist',output=process.env.RELEASE_SCREENSHOTS||'/tmp/explorakit-lucie-story-browser';fs.mkdirSync(output,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server,{path:'/explorakit/socket.io'});
app.use(express.json());app.use('/explorakit/api',require('../server/http/routes'));app.use('/explorakit',express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));
io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
let browser,page,userId,base,success=false;const errors=[];
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(!v?.socket?.connected||!v.players[v.socket.id]||v.mapLoading||v.renderedMap!==v.map||!v.progressionState?.objective)return false;window.storyVm=v;return true;});}
async function disconnect(){await page.evaluate(()=>new Promise(resolve=>window.storyVm.socket.emit('requestGameSave',()=>{window.storyVm.socket.disconnect();resolve();})));await page.goto('about:blank');}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}/explorakit`;
 const response=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'opening_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(response.status,201);const fixture=await response.json();userId=fixture.user.id;
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true,deviceScaleFactor:2});await context.addInitScript(s=>{if(location.protocol==='http:'||location.protocol==='https:')localStorage.setItem('explorakit.user',JSON.stringify(s));},{...fixture.user,token:fixture.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().startsWith(base)&&r.status()>=400)errors.push(r.status()+' '+r.url());});
 const stages=[['dia1','start',18,3],['aspha_route2','route2',25,6],['moon','ville1_arene',13,5],['champion_hoze','ville_safe1_arene',13,5],['champion_raphael','gen_arene5',13,5],['champion_ana','ville3_arene',13,5],['champion_wanda','ville4_arene',13,5],['champion_7p','ville5_arene',13,5]];
 await dbPool.execute('UPDATE users SET map=?,x=?,y=? WHERE id=?',['route2',592,272,userId]);await page.goto(base+'/game',{waitUntil:'networkidle'});await ready();
 const locked=page.evaluate(()=>new Promise(resolve=>{window.storyVm.socket.once('progressionNotice',resolve);window.storyVm.socket.emit('playerAction','move_z');}));assert.match((await locked).message,/verrouillée/);assert.equal(await page.evaluate(()=>window.storyVm.map),'route2');await disconnect();
 for(const [index,[name,map,x,y]]of stages.entries()){
  if(index)await disconnect();await dbPool.execute('UPDATE users SET map=?,x=?,y=? WHERE id=?',[map,x*32+16,y*32+16,userId]);
  await page.goto(base+'/game',{waitUntil:'networkidle'});await ready();assert.equal(await page.evaluate(()=>window.storyVm.map),map);assert.equal(await page.evaluate(()=>window.storyVm.progressionState.quests.find(q=>q.key==='main_sister_search').progress),index);
  await page.evaluate(()=>{window.storyVm.preferences.textSpeed=10000;window.storyVm.socket.emit('Space');});
  await page.waitForFunction(()=>document.querySelector('.dialogue-layer .text')?.textContent.length>10);assert.equal(await page.evaluate(()=>window.storyVm.endSentences),name);
  await page.waitForFunction(()=>{const c=document.querySelector('.portrait-atlas'),i=document.querySelector('.imagetoto');return c?c.dataset.portraitReady==='true':i?.complete&&i.naturalWidth>=128;});
  const image=await page.evaluate(()=>window.storyVm.textImageSequence[0].image);assert(!image.includes('pixel-v2'));
  for(const [width,height]of [[320,480],[393,852],[844,390],[1365,900]]){
   await page.setViewportSize({width,height});await page.evaluate(width=>{window.storyVm.showMobileControls=width<=920;},width);
   for(const selector of ['.dialogue-layer .text-with-image','.dialogue-layer .texts'])assert(await page.locator(selector).evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=-1&&r.top>=-1&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;}),`${name} ${width}: dialogue outside viewport`);
   await page.screenshot({path:path.join(output,`${name}-${width}.png`)});
  }
  await disconnect();
  assert.equal((await require('../server/persistence/progressionRepository').completeNpcBattle(userId,name)).granted,true);
  // Leave the next iteration a connected page so the same save/disconnect contract can be exercised.
  if(index<stages.length-1){await page.goto(base+'/game',{waitUntil:'networkidle'});await ready();}
 }
 await dbPool.execute('UPDATE users SET map=?,x=?,y=? WHERE id=?',['route2',592,272,userId]);await page.goto(base+'/game',{waitUntil:'networkidle'});await ready();assert.equal(await page.evaluate(()=>window.storyVm.progressionState.objective.map),'route2_maison');
 await page.evaluate(()=>window.storyVm.socket.emit('playerAction','move_z'));await page.waitForFunction(()=>window.storyVm.map==='route2_maison'&&!window.storyVm.mapLoading);
 for(let i=0;i<7;i++){await page.waitForTimeout(220);await page.evaluate(()=>window.storyVm.socket.emit('playerAction','move_z'));}
 await page.waitForTimeout(220);await page.evaluate(()=>window.storyVm.socket.emit('Space'));await page.waitForFunction(()=>window.storyVm.endSentences==='lucie_route2');await page.waitForFunction(()=>document.querySelector('.portrait-atlas')?.dataset.portraitReady==='true');await page.screenshot({path:path.join(output,'lucie-retrouvee.png')});
 await page.evaluate(()=>window.storyVm.socket.emit('onEndDialogue','lucie_route2'));await page.waitForFunction(()=>window.storyVm.progressionState?.quests.find(q=>q.key==='main_sister_search')?.status==='completed');
 const final=await page.evaluate(()=>window.storyVm.progressionState);assert.equal(final.objective,null);assert.equal(final.quests.find(q=>q.key==='main_sister_search').progress,9);assert(!final.quests.some(q=>['clara_chapter2','refuges','valpierre_passage'].includes(q.key)));
 await disconnect();await page.goto(base+'/game',{waitUntil:'networkidle'});await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(!v?.socket?.connected||v.mapLoading)return false;window.storyVm=v;return v.progressionState?.quests.find(q=>q.key==='main_sister_search')?.status==='completed';});
 for(let i=0;i<8;i++){await page.waitForTimeout(220);await page.evaluate(()=>window.storyVm.socket.emit('playerAction','move_s'));}await page.waitForFunction(()=>window.storyVm.map==='route2'&&!window.storyVm.mapLoading);assert.equal((await require('../server/persistence/itemRepository').loadUserItems(userId)).find(i=>i.key==='route2_house_key').quantity,1);
 await page.locator('.menu-toggle-btn').click();await page.locator('[data-menu-action="progress"]').click();await page.getByText('Tu as retrouvé Lucie',{exact:false}).waitFor();await page.screenshot({path:path.join(output,'opening-completed.png')});
 assert.deepEqual(errors,[]);success=true;console.log(JSON.stringify({actualDialogues:stages.map(s=>s[0]),viewports:4,illustrations:true,goalsInOrder:true,sevenpThenLucie:true,actualHouseEntrance:true,lockedBeforeVictory:true,actualHouseExit:true,keyPreserved:true,reunionPersists:true,errors,output}));
}finally{if(!success&&page)await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});await browser?.close();await new Promise(r=>io.close(r));if(userId)await dbPool.execute('DELETE FROM users WHERE id=?',[userId]);await dbPool.end();}})().catch(e=>{console.error(e.stack);process.exitCode=1});
