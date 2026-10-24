// Real game rendering with a disposable player and an isolated test database.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(!/test/i.test(process.env.DB_TEST_NAME||''))throw Error('Dedicated test database required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';
const express=require('express'),{Server}=require('socket.io'),{chromium}=require('playwright'),{dbPool}=require('../server/config/database');
const output=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-butterflies-wind-browser';fs.mkdirSync(output,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server);app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(process.env.RELEASE_DIST_DIR||'/tmp/riftmon-butterflies-wind-dist'));app.get('*',(_q,r)=>r.sendFile(path.resolve(process.env.RELEASE_DIST_DIR||'/tmp/riftmon-butterflies-wind-dist','index.html')));
const cleanup=require('../server/realtime/driftLobbyHandler').registerDriftLobbies(io,{checkpointRepository:{async save(){}},runtimeOptions:{random:()=>.9,paceMs:0}});
let browser,page,userId,success=false;const errors=[];
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 const response=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'ambience_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(response.status,201);const fixture=await response.json();userId=fixture.user.id;
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true});await context.addInitScript(v=>localStorage.setItem('explorakit.user',JSON.stringify(v)),{...fixture.user,token:fixture.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().startsWith(base)&&r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
 await page.goto(base+'/colosseum',{waitUntil:'networkidle'});await page.locator('[data-colosseum-start]:enabled').click();await page.locator('[data-starter-choice]').first().click();await page.locator('.starter-backdrop').waitFor({state:'hidden'});
 await page.waitForFunction(()=>{let e=document.querySelector('.game-stage');while(e&&!e.__vue__)e=e.parentElement;if(!e?.__vue__?.socket?.connected)return false;window.v=e.__vue__;return true;});
 await page.evaluate(()=>v.updatePreferences({...v.preferences,masterVolume:0}));const player=cleanup.runtime.playerFor({id:userId});
 async function locate(map){const repo=require('../server/game/world/mapRepository'),c=repo.loadCollisionData(map),changes=repo.changeMapData(map);const points=[];for(let y=1;y<c.length-1;y++)for(let x=1;x<c[y].length-1;x++)if(!c[y][x]&&!changes[y]?.[x])points.push([x,y]);points.sort((a,b)=>(a[0]-14)**2+(a[1]-11)**2-((b[0]-14)**2+(b[1]-11)**2));const [x,y]=points[0];Object.assign(player,{currentmap:map,x:x*32+16,y:y*32+16});cleanup.runtime.enter(fixture.user,{id:player.socketId});await page.waitForFunction(map=>v.map===map&&v.renderedMap===map&&!v.mapLoading,map);}
 const maps=['gen_ville5','route4'];
 for(const map of maps){await locate(map);await page.waitForFunction(map=>v._placeAmbience?.canvas&&v._placeAmbience.map===map,map);
  for(const [width,height] of [[393,852],[1365,900]]){await page.setViewportSize({width,height});await page.evaluate(w=>{v.showMobileControls=w<1000;},width);await page.waitForTimeout(250);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(output,`${map}-${width}.png`)});}
 }
 await locate('ville5');await page.evaluate(()=>v.updatePreferences({...v.preferences,animationsEnabled:false}));await page.waitForTimeout(150);const frames=await page.evaluate(()=>v._placeAmbience.frames);await page.waitForTimeout(300);assert.equal(await page.evaluate(()=>v._placeAmbience.frames),frames,'reduced motion freezes decorative animation, keeps lighting');
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});assert(await page.evaluate(()=>!v._placeAmbience.canvas));await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));v.updatePreferences({...v.preferences,animationsEnabled:true});});await page.waitForFunction(()=>v._placeAmbience?.canvas);
 await page.evaluate(()=>window.oldSurface=v._placeAmbience.canvas);await locate('route1');assert(await page.evaluate(()=>!v._placeAmbience.canvas&&oldSurface.width===0),'unknown map releases surface');
 await locate('gen_route8');
 await page.waitForFunction(()=>v._worldWeather?.canvas&&v.worldWeatherActive);
 assert.deepEqual(await page.evaluate(()=>v.effectiveWorldWeather),{wind:2,rain:0});
 assert.deepEqual(await page.evaluate(()=>v._worldWeather.budget),{rain:0,leaves:20,gusts:3,splashes:0});
 for(const [width,height]of [[393,852],[1365,900]]){
  await page.setViewportSize({width,height});await page.evaluate(w=>{v.showMobileControls=w<1000;},width);await page.waitForTimeout(250);
  await page.screenshot({path:path.join(output,`route8-${width}.png`)});
 }
 await locate('gen_ville5');assert(await page.evaluate(()=>!v._worldWeather.canvas),'wind is cleared when leaving Route 8');
 assert.deepEqual(errors,[]);success=true;console.log(JSON.stringify({maps:maps.length,windRoute8:true,worldViewports:2,reducedMotion:true,hidden:true,transitionCleanup:true,errors}));
}finally{if(!success&&page)await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});await browser?.close();cleanup();await new Promise(r=>io.close(r));if(userId)await dbPool.execute('DELETE FROM users WHERE id=?',[userId]);await dbPool.end();}})().catch(e=>{console.error(e.stack);process.exitCode=1});
