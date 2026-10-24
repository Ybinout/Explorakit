// Real socket travel and persistence against disposable accounts only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const{once}=require('node:events'),{randomUUID}=require('node:crypto');
if(!/test/i.test(process.env.DB_TEST_NAME||''))throw Error('Dedicated test DB required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';
const express=require('express'),{Server}=require('socket.io'),{chromium}=require('playwright'),{dbPool}=require('../server/config/database');
const dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-flight-dist',output=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-flight-browser';fs.mkdirSync(output,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server);app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
let browser,page,userId,success=false;const errors=[];
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(!v?.socket?.connected||v.mapLoading||v.renderedMap!==v.map||!v.players[v.socket.id]||!v.progressionState.flight)return false;window.v=v;return true;});}
async function open(){await page.locator('.menu-toggle-btn').click();await page.locator('[data-menu-action="minimap"]').click();await page.locator('.region-art').waitFor();}
async function select(map){await page.locator('#region-place').selectOption(map);}
async function command(map){return page.evaluate(map=>new Promise(resolve=>v.socket.emit('flyToTown',{map,x:9999,y:9999},resolve)),map);}
async function saved(map){const[[row]]=await dbPool.execute('SELECT map,x,y FROM users WHERE id=?',[userId]);const dest=require('../server/game/world/flightTravel').flightDestination(map);assert.deepEqual(row,{map,x:dest.x,y:dest.y});assert.deepEqual(await page.evaluate(()=>{const p=v.players[v.socket.id];return{map:v.map,x:p.x,y:p.y};}),{map,x:dest.x,y:dest.y});}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'flight_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(r.status,201);const fixture=await r.json();userId=fixture.user.id;
 for(const flag of ['moonpunch_defeated','hoze_defeated','raphael_defeated','ana_defeated','wanda_defeated'])await dbPool.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,'true')",[userId,flag]);
 await dbPool.execute("UPDATE users SET map='ville4',x=144,y=304 WHERE id=?",[userId]);
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true});await context.addInitScript(s=>localStorage.setItem('explorakit.user',JSON.stringify(s)),{...fixture.user,token:fixture.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().startsWith(base)&&r.status()>=400)errors.push(r.status()+' '+r.url());});
 await page.goto(base+'/game',{waitUntil:'networkidle'});await ready();assert(await page.evaluate(()=>v.progressionState.flight.unlocked));
 assert.equal((await command('ville5')).success,false);assert.equal((await command('route1')).success,false);
 await open();await select('ville5');assert(await page.locator('[data-fly]').isDisabled());await page.screenshot({path:path.join(output,'unvisited-393.png')});await select('ville1');await page.locator('[data-fly]').waitFor();
 for(const width of [320,393,1365]){await page.setViewportSize({width,height:852});await page.waitForTimeout(100);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(output,`minimap-${width}.png`)});}
 await page.setViewportSize({width:393,height:852});
 await page.route('**/img/ville1.*.png',async route=>{await new Promise(r=>setTimeout(r,1600));await route.continue();});
 await page.locator('[data-fly]').click();await page.locator('[data-flight-transition].departure').waitFor();await page.waitForTimeout(250);await page.screenshot({path:path.join(output,'departure.png')});
 await page.waitForFunction(()=>v.flight?.phase==='loading'&&v.mapLoading);assert(await page.evaluate(()=>v.movementBlocked));await page.screenshot({path:path.join(output,'loading.png')});
 await page.waitForFunction(()=>v.flight?.phase==='arrival');await page.screenshot({path:path.join(output,'arrival.png')});await page.waitForFunction(()=>!v.flight&&!v.mapLoading);await saved('ville1');
 await page.unroute('**/img/ville1.*.png');await page.reload({waitUntil:'networkidle'});await ready();await saved('ville1');
 // Enter the center through its real door, then fly out from the shared interior.
 await page.evaluate(()=>v.socket.emit('playerAction','move_z'));await page.waitForFunction(()=>v.map==='centre'&&!v.mapLoading);assert(await page.evaluate(()=>v.progressionState.flight.visited.includes('ville1')));
 await open();await select('ville_safe1');await page.locator('[data-fly]').click();await page.waitForFunction(()=>!v.flight&&v.map==='ville_safe1'&&!v.mapLoading);await saved('ville_safe1');await page.screenshot({path:path.join(output,'arena-doorstep.png')});
 await page.waitForTimeout(3100);await page.evaluate(()=>v.updatePreferences({...v.preferences,animationsEnabled:false}));await open();await select('start');await page.locator('[data-fly]').click();await page.waitForFunction(()=>!v.flight&&v.map==='start'&&!v.mapLoading);await saved('start');
 const[[item]]=await dbPool.execute("SELECT quantity FROM user_items WHERE user_id=? AND item_key='fly_module'",[userId]);assert.equal(item.quantity,1);
 assert.deepEqual(errors,[]);success=true;console.log(JSON.stringify({legacyGrant:true,perPlayerVisits:true,unknownTownRejected:true,serverCoordinates:true,slowNetwork:true,departureArrival:true,viewports:3,persistence:true,centerExit:true,arenaFallback:true,homeFallback:true,reducedMotion:true,errors}));
}finally{if(!success&&page)await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});await browser?.close();await new Promise(r=>io.close(r));await new Promise(r=>setTimeout(r,200));if(userId)await dbPool.execute('DELETE FROM users WHERE id=?',[userId]);await dbPool.end();}})().catch(e=>{console.error(e.stack);process.exitCode=1});
