// Dedicated visual check on an isolated test server, using the actual artwork.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(!/test/i.test(process.env.DB_TEST_NAME||''))throw Error('Dedicated test database required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';
const express=require('express'),{Server}=require('socket.io'),{chromium}=require('playwright');
const {dbPool}=require('../server/config/database');
const dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-mounir-storm-dist',output=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-mounir-storm-browser';fs.mkdirSync(output,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server);
app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));
io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
let browser,page,userId,success=false;const errors=[];
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'water_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(r.status,201);const fixture=await r.json();userId=fixture.user.id;await dbPool.execute('UPDATE users SET map=?,x=?,y=? WHERE id=?',['ville1_arene',240,400,userId]);
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true});await context.addInitScript(s=>{if(location.protocol==='http:'||location.protocol==='https:')localStorage.setItem('explorakit.user',JSON.stringify(s));},{...fixture.user,token:fixture.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().startsWith(base)&&r.status()>=400)errors.push(r.status()+' '+r.url());});
 await page.goto(base+'/game',{waitUntil:'networkidle'});await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(!v?.socket?.connected||v.mapLoading||v.renderedMap!=='ville1_arene')return false;window.v=v;return true;});
 await page.waitForTimeout(200);if(await page.evaluate(()=>Boolean(v.textImageSequence.length)))await page.evaluate(()=>v.clearSequence());
 await page.waitForFunction(()=>v._worldWeather?.canvas&&v._villageWater?.canvas);
 assert.deepEqual(await page.evaluate(()=>({...v.effectiveWorldWeather})),{wind:3,rain:3});
 const lake=await require('./validateLakeWaterUi')(page,output,'ville1_arene');
 const sides=await page.evaluate(()=>{const r=v._villageWater;return{left:r.mask.pixels.filter(i=>i%448<100).length,right:r.mask.pixels.filter(i=>i%448>348).length,weather:{...v.effectiveWorldWeather},rain:v._worldWeather.budget.rain,gusts:v._worldWeather.budget.gusts};});assert(sides.left>500&&sides.right>500);assert.equal(sides.rain,128);assert.equal(sides.gusts,6);
assert.deepEqual(errors,[]);success=true;console.log(JSON.stringify({lake,sides,viewports:4,errors,output}));
}finally{if(!success&&page)await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});await browser?.close();await new Promise(r=>io.close(r));if(userId)await dbPool.execute('DELETE FROM users WHERE id=?',[userId]);await dbPool.end();}})().catch(e=>{console.error(e.stack);process.exitCode=1});
