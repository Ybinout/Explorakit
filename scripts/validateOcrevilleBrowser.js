// Real movement and isolated fixtures: never exposes fixture commands in production.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(!/test/i.test(process.env.DB_TEST_NAME||''))throw Error('Dedicated test database required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';
const express=require('express'),{Server}=require('socket.io'),{chromium}=require('playwright');
const {dbPool}=require('../server/config/database');
const dist=process.env.RELEASE_DIST_DIR||'/tmp/explorakit-routes910-dist',output=process.env.RELEASE_SCREENSHOTS||'/tmp/explorakit-routes910-browser';fs.mkdirSync(output,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server,{path:'/explorakit/socket.io'});
app.use(express.json());app.use('/explorakit/api',require('../server/http/routes'));app.use('/explorakit',express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));
io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
const cleanup=require('../server/realtime/driftLobbyHandler').registerDriftLobbies(io,{checkpointRepository:{async save(){}},runtimeOptions:{random:()=>.9}});
let browser,page,userId,base,success=false;const errors=[],originalRandom=Math.random;
async function ready(){await page.waitForFunction(()=>{const vm=document.querySelector('.game-root')?.__vue__;if(!vm?.socket?.connected||!vm.players[vm.socket.id]||vm.mapLoading||vm.renderedMap!==vm.map)return false;window.cityVm=vm;return true;});}
async function locate(map,x,y){
 if(await page.locator('.game-root').count())await page.evaluate(()=>new Promise((resolve,reject)=>{const vm=window.cityVm;vm.socket.timeout(5000).emit('requestGameSave',(err,r)=>{if(err||!r?.success)return reject(Error('save'));vm.socket.disconnect();resolve();});}));
 await page.goto('about:blank');await dbPool.execute('UPDATE users SET map=?,x=?,y=? WHERE id=?',[map,x*32+16,y*32+16,userId]);await page.goto(base+'/game',{waitUntil:'networkidle'});await ready();
}
async function step(action,map){await page.waitForTimeout(160);await page.evaluate(action=>window.cityVm.socket.emit('playerAction',action),action);await page.waitForFunction(map=>window.cityVm.map===map&&!window.cityVm.mapLoading,map);}
async function capture(label){for(const [width,height]of [[320,480],[393,852],[844,390],[1365,900]]){await page.setViewportSize({width,height});await page.evaluate(width=>{window.cityVm.showMobileControls=width<=920;},width);assert(await page.evaluate(()=>{const v=window.cityVm;return v.mapImage.complete&&v.foregroundImage.complete&&v.mapImage.naturalWidth===448&&document.documentElement.scrollWidth<=innerWidth+1;}));assert.equal(await page.evaluate(()=>window.cityVm.battle),false);await page.screenshot({path:path.join(output,`${label}-${width}.png`)});}}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}/explorakit`;
 const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'ocreville_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(r.status,201);const fixture=await r.json();userId=fixture.user.id;await dbPool.execute("UPDATE users SET money=5000 WHERE id=?",[userId]);Math.random=()=>0;
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true});await context.addInitScript(s=>{if(location.protocol==='http:'||location.protocol==='https:')localStorage.setItem('explorakit.user',JSON.stringify(s));},{...fixture.user,token:fixture.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().startsWith(base)&&r.status()>=400)errors.push(r.status()+' '+r.url());});
 await locate('route4',18,18);await step('move_s','gen_route8');await capture('route8');await step('move_z','route4');
 await locate('gen_route8',23,18);await step('move_s','gen_ville5');await capture('ocreville');await step('move_z','gen_route8');
 await locate('gen_ville5',23,18);const {validateRouteExtensions}=require('./validateRouteExtensionsUi');const adventureRoutes=await validateRouteExtensions(page,{step,capture});
 const doors=[[4,4,'gen_maison_ville5_1'],[12,4,'gen_maison_ville5_2'],[16,17,'gen_maison_ville5_3'],[5,12,'gen_arene5'],[23,13,'gen_shop_ville5_1'],[17,7,'centre']];
 for(const [x,y,map]of doors){await locate('gen_ville5',x,y+1);await step('move_z',map);if(map.includes('shop')){await page.locator('.location-shop-btn').click();await page.locator('.shop-item').first().waitFor();await page.locator('.shop-close').click();}await step('move_s','gen_ville5');assert.deepEqual(await page.evaluate(()=>{const v=window.cityVm,p=v.players[v.socket.id];return [Math.floor(p.x/32),Math.floor(p.y/32)];}),[x,y+1]);}
 await locate('gen_arene5',13,6);await page.evaluate(()=>{window.cityVm.preferences.textSpeed=10000;window.cityVm.socket.emit('Space');});await page.waitForFunction(()=>window.cityVm.endSentences==='champion_raphael_locked');
 await page.evaluate(()=>{window.cityVm.textImageSequence=[];});await locate('gen_ville5',23,1);await page.goto('about:blank');await page.waitForTimeout(200);
 await dbPool.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES (?,'hoze_defeated','true')",[userId]);
 await page.goto(base+'/game',{waitUntil:'networkidle'});await ready();await locate('gen_arene5',13,6);await page.evaluate(()=>{window.cityVm.preferences.textSpeed=10000;window.cityVm.socket.emit('Space');});await page.waitForFunction(()=>window.cityVm.endSentences==='champion_raphael');await capture('raphael');assert.equal(await page.evaluate(()=>window.cityVm.progressionState.quests.find(q=>q.key==='main_sister_search').map),'gen_arene5');
 await page.evaluate(()=>{window.cityVm.textImageSequence=[];});await page.goto(base+'/colosseum',{waitUntil:'networkidle'});await page.locator('[data-colosseum-start]:enabled').click();await page.locator('[data-starter-choice]').first().click();await page.locator('.starter-backdrop').waitFor({state:'hidden'});const p=cleanup.runtime.playerFor(fixture.user);
 async function atExpedition(map,x,y){Object.assign(p,{currentmap:map,x:x*32+16,y:y*32+16,lastMove:0});await page.reload({waitUntil:'networkidle'});await ready();}
 await atExpedition('route4',18,18);await step('move_s','gen_route8');await capture('colosseum-route8');await step('move_z','route4');await atExpedition('gen_route8',23,18);await step('move_s','gen_ville5');await capture('colosseum-ocreville');
 await atExpedition('gen_ville5',23,18);const colosseumRoutes=await validateRouteExtensions(page,{step,capture,prefix:'colosseum-'});
 for(const [x,y,map]of doors){await atExpedition('gen_ville5',x,y+1);await step('move_z',map);await step('move_s','gen_ville5');}
 assert.deepEqual(errors,[]);success=true;console.log(JSON.stringify({adventureRoutes,colosseumRoutes,northSouthRoundTrips:true,doorsAndReturns:6,centerProvenance:true,shop:true,raphaelLockedAndAvailable:true,objectiveUpdated:true,colosseumExploration:true,viewports:4,errors,output}));
}finally{Math.random=originalRandom;if(!success&&page)await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});await browser?.close();cleanup();await new Promise(r=>io.close(r));if(userId)await dbPool.execute('DELETE FROM users WHERE id=?',[userId]);await dbPool.end();}})().catch(e=>{console.error(e.stack);process.exitCode=1});
