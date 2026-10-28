// Real opening duel on an isolated SQL account, then bounded presentation fixtures.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(!/test/i.test(process.env.DB_TEST_NAME||''))throw Error('Dedicated test database required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';process.env.BATTLE_DELAY_SCALE='0';
const express=require('express'),{Server}=require('socket.io'),{chromium}=require('playwright');
const {dbPool:db}=require('../server/config/database');
const dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-trainer-loader-dist',out=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-trainer-loader-browser';fs.mkdirSync(out,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server);app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));
io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
let browser,page,userId,passed=false;const errors=[];
async function ready(){await page.waitForFunction(()=>{const vm=document.querySelector('.game-root')?.__vue__;if(!vm?.socket?.connected||vm.mapLoading||vm.renderedMap!==vm.map||!vm.players[vm.socket.id])return false;window.combatVm=vm;return true;});}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 const response=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'loader_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(response.status,201);const fixture=await response.json();userId=fixture.user.id;
 await db.execute("UPDATE users SET map='start',x=?,y=? WHERE id=?",[18*32+16,3*32+16,userId]);
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true});await context.addInitScript(s=>localStorage.setItem('explorakit.user',JSON.stringify(s)),{...fixture.user,token:fixture.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().startsWith(base)&&r.status()>=400)errors.push(r.status()+' '+r.url());});
 await page.goto(base+'/game',{waitUntil:'networkidle'});await ready();await page.evaluate(()=>combatVm.socket.emit('playerAction','move_z'));await page.waitForTimeout(250);await page.evaluate(()=>combatVm.socket.emit('Space'));
 await page.waitForFunction(()=>combatVm.endSentences==='dia1'&&combatVm.textImageSequence.length);
 await page.locator('.text-with-image .imagetoto').evaluate(i=>i.decode());
 assert(await page.locator('.text-with-image .imagetoto').evaluate(i=>i.src.includes('wayne-eyepatch-v2.')&&i.naturalWidth===1122&&getComputedStyle(i).objectFit==='contain'));
 for(const[width,height]of [[320,568],[393,852],[844,390],[1365,900]]){
  await page.setViewportSize({width,height});await page.evaluate(async w=>{combatVm.showMobileControls=w<=920;await combatVm.$nextTick();combatVm.resizeWorldViewport();},width);await page.waitForTimeout(100);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(out,`wayne-dialogue-${width}.png`)});
 }
 await page.setViewportSize({width:393,height:852});await page.evaluate(()=>{combatVm.showMobileControls=true;combatVm.clearSequence();});
 await page.locator('.portrait-ready').waitFor();assert.equal(await page.locator('[data-arena-intro] h2').innerText(),'Wayne');assert(await page.locator('.entrance-portrait').evaluate(i=>i.src.includes('wayne-eyepatch-v2.')&&i.complete&&i.naturalWidth===1122&&i.naturalHeight===1402));
 await page.waitForTimeout(800);
 for(const[width,height]of [[320,568],[393,852],[844,390],[1365,900]]){
  await page.setViewportSize({width,height});await page.evaluate(w=>{combatVm.showMobileControls=w<=920;},width);assert(await page.locator('.entrance-portrait').evaluate(i=>getComputedStyle(i).objectFit==='contain'));assert(await page.locator('.action-attack').isDisabled());assert(await page.locator('.battle-action-shell').evaluate(el=>el.inert));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(out,`wayne-${width}.png`)});
 }
 await page.locator('[data-battle-entrance]').waitFor({state:'hidden'});await page.locator('.action-attack:enabled').waitFor();
 const timing=await page.evaluate(()=>{const b=combatVm.$refs.battleOverlay;return{elapsed:performance.now()-b._entranceStartedAt,visible:performance.now()-b._entrancePortraitAt};});assert(timing.elapsed>=4600);assert(timing.visible>=3200);
 await page.locator('.action-flee:enabled').click();await page.locator('[data-battle-result-continue]').click();await page.locator('.battle-scene').waitFor({state:'hidden'});
 const arenas=process.env.WAYNE_PORTRAIT_ONLY==='1'?null:await require('./validateArenaEntranceUi').validateArenaEntranceUi(page,out);assert.deepEqual(errors,[]);passed=true;const result={actualWayneDuel:true,waynePortrait:'wayne-eyepatch-v2.png',wayneTiming:timing,wayneViewports:4,dialogueViewports:4,wholeIllustration:true,arenas,errors,output:out};fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{if(!passed&&page)await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});await browser?.close();await new Promise(r=>io.close(r));if(userId)await db.execute('DELETE FROM users WHERE id=?',[userId]);await db.end();}})().catch(e=>{console.error(e.stack);process.exitCode=1});
