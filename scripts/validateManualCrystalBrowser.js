// Real inputs and isolated accounts only. Never point this recipe at the live DB.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const{once}=require('node:events'),{randomUUID}=require('node:crypto');
if(process.env.DB_TEST_NAME!=='explorakit_test')throw Error('explorakit_test required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';
const express=require('express'),{Server}=require('socket.io'),{chromium}=require('playwright');
const{dbPool:db}=require('../server/config/database'),{waitForAccountConnections}=require('../server/realtime/accountConnection');
const dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-manual-crystals-dist',out='/tmp/riftmon-manual-crystals-browser';fs.mkdirSync(out,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server);app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));
io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
let browser,page,userId,base;const errors=[],screenshots=[];
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(!v?.socket?.connected||v.mapLoading||v.renderedMap!==v.map||!v.players[v.socket.id])return false;window.v=v;return true;});}
async function at(map,y){await page.evaluate(()=>v.socket.disconnect());await waitForAccountConnections(io);await db.execute('UPDATE users SET map=?,x=432,y=? WHERE id=?',[map,y*32+16,userId]);await page.reload({waitUntil:'networkidle'});await ready();}
async function hitCount(n){await page.waitForFunction(n=>v.displayedRoomObstacleAction?.hits===n,n);}
async function press(){await page.locator('.mobile-action-a').click();}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}`;
 const response=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'crystal_ui_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(response.status,201);const fixture=await response.json();userId=fixture.user.id;
 await db.execute("UPDATE users SET map='route2_maison',x=432,y=528 WHERE id=?",[userId]);
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true});await context.addInitScript(s=>localStorage.setItem('explorakit.user',JSON.stringify(s)),{...fixture.user,token:fixture.token});
 page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().startsWith(base)&&r.status()>=400)errors.push(r.status()+' '+r.url());});
 await page.goto(base+'/game',{waitUntil:'networkidle'});await ready();await page.waitForFunction(()=>v.endSentences==='lucie_room_entry'&&v.textImageSequence.length);await page.evaluate(()=>v.clearSequence());await page.waitForFunction(()=>!v.textImageSequence.length&&!v.pendingRoomEntry);await page.waitForTimeout(120);
 await hitCount(0);await press();await hitCount(1);assert(await page.locator('.mobile-action-a').isEnabled());
 // Holding a finger does not auto-repeat and pointerdown+click count only once.
 const a=await page.locator('.mobile-action-a').boundingBox();await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await hitCount(2);await page.waitForTimeout(8500);await hitCount(2);await page.mouse.up();await page.waitForTimeout(150);await hitCount(2);
 for(const[width,height]of[[320,568],[393,852],[844,390],[1365,900]]){
  await page.setViewportSize({width,height});await page.evaluate(async w=>{v.showMobileControls=w<=920;await v.$nextTick();v.resizeWorldViewport();},width);await page.waitForTimeout(100);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.match(await page.locator('.room-obstacle-progress').innerText(),/2 \/ 10/);
  const panel=await page.locator('.room-obstacle-action').boundingBox();assert(panel.x>=0&&panel.x+panel.width<=width+1);const file=path.join(out,`two-real-hits-${width}.png`);await page.screenshot({path:file});screenshots.push(file);
 }
 await page.setViewportSize({width:393,height:852});await page.evaluate(()=>v.showMobileControls=true);
 for(let n=3;n<=9;n++){await press();await hitCount(n);}assert(!await page.evaluate(()=>v.progressionState.flags.lucie_barricade_1_cleared));await press();await page.locator('.room-obstacle-action.is-complete').waitFor();await page.waitForFunction(()=>v.progressionState.flags.lucie_barricade_1_cleared==='true');await page.locator('.room-obstacle-action').waitFor({state:'hidden'});
 // Keyboard repeat events cannot turn a held Space into ten inputs.
 await at('route2_maison',12);await page.setViewportSize({width:1365,height:900});await page.evaluate(()=>v.showMobileControls=false);await page.keyboard.down('Space');await hitCount(1);for(let i=0;i<20;i++)await page.keyboard.down('Space');await page.waitForTimeout(500);await hitCount(1);await page.keyboard.up('Space');
 for(let n=2;n<=9;n++){await page.keyboard.press('Space');await hitCount(n);}await page.reload({waitUntil:'networkidle'});await ready();await hitCount(9);await page.keyboard.press('Space');await page.waitForFunction(()=>v.progressionState.flags.lucie_barricade_2_cleared==='true');await page.locator('.room-obstacle-action').waitFor({state:'hidden'});
 // Gamepad confirmation during the hit animation and reduced-motion rendering.
 await at('route2_maison',9);await page.evaluate(()=>v.updatePreferences({...v.preferences,animationsEnabled:false}));
 for(let n=1;n<=10;n++){await page.evaluate(()=>v.handleGamepad({detail:{action:'confirm'},preventDefault(){}}));if(n<10)await hitCount(n);}
 await page.waitForFunction(()=>v.progressionState.flags.lucie_barricade_3_cleared==='true');await page.locator('.room-obstacle-action').waitFor({state:'hidden'});
 await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value)VALUES(?,'professor_defeated','true'),(?,'professor_departure','seen')",[userId,userId]);await at('professor_lab',9);await page.setViewportSize({width:393,height:852});await page.evaluate(()=>v.showMobileControls=true);
 for(let n=1;n<=9;n++){await press();await hitCount(n);}assert(!await page.evaluate(()=>v.progressionState.flags.lab_crystals_cleared));await press();await page.waitForFunction(()=>v.progressionState.flags.lab_crystals_cleared==='true');await page.locator('.room-obstacle-action').waitFor({state:'hidden'});
 assert.deepEqual(errors,[]);console.log(JSON.stringify({tenDiscreteHits:true,noTimedHits:true,noHeldInputs:true,mobileKeyboardGamepad:true,partialReconnect:true,allFourBarriers:true,viewports:4,screenshots,errors}));
 }finally{if(page)await page.evaluate(()=>v?.socket.disconnect()).catch(()=>{});await waitForAccountConnections(io);if(browser)await browser.close();await new Promise(r=>io.close(r));if(userId)await db.execute('DELETE FROM users WHERE id=?',[userId]);await db.end();}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
