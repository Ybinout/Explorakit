// Real clients, isolated server and dedicated SQL fixtures; no production fixture command.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(!/test/i.test(process.env.DB_TEST_NAME||''))throw Error('Dedicated test database required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';
const express=require('express'),{Server}=require('socket.io'),{chromium}=require('playwright'),{dbPool}=require('../server/config/database');
const dist=process.env.RELEASE_DIST_DIR||'/tmp/explorakit-heavy-snow-dist',output=process.env.RELEASE_SCREENSHOTS||'/tmp/explorakit-heavy-snow-browser';fs.mkdirSync(output,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server,{path:'/explorakit/socket.io'});app.use(express.json());app.use('/explorakit/api',require('../server/http/routes'));app.use('/explorakit',express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
const store=require('../server/game/drift/lobbyStore').createLobbyStore(),cleanup=require('../server/realtime/driftLobbyHandler').registerDriftLobbies(io,{store,runtimeOptions:{paceMs:0}});
let browser,page,base,success=false;const ids=[],errors=[];
async function create(){const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'snow_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(r.status,201);const f=await r.json();ids.push(f.user.id);return f;}
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(!v?.socket?.connected||v.mapLoading||v.renderedMap!==v.map)return false;window.snowVm=v;return true;});}
async function disconnect(){await page.evaluate(()=>new Promise(resolve=>window.snowVm.socket.emit('requestGameSave',()=>{window.snowVm.socket.disconnect();resolve();})));await page.goto('about:blank');}
const {validateSnowUi}=require('./validateSnowUi');
async function capture(label){
 for(const [width,height]of [[320,480],[393,852],[844,390],[1365,900]]){await page.setViewportSize({width,height});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(output,`${label}-${width}.png`)});}
}
async function step(action,map){await page.waitForTimeout(180);await page.evaluate(a=>window.snowVm.socket.emit('playerAction',a),action);await page.waitForFunction(m=>window.snowVm.map===m&&window.snowVm.renderedMap===m&&!window.snowVm.mapLoading,map);}
async function probe(mode){
 const route13=await validateSnowUi(page,{capture,label:mode+'-route13'});
 await step('move_z','route14');const route14=await validateSnowUi(page,{capture,label:mode+'-route14'});
 await step('move_s','route13');return{route13,route14};
}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}/explorakit`;const fixture=await create();await dbPool.execute('UPDATE users SET map=?,x=?,y=? WHERE id=?',['route13',432,48,fixture.user.id]);
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true});await context.addInitScript(s=>{if(location.protocol==='http:'||location.protocol==='https:')localStorage.setItem('explorakit.user',JSON.stringify(s));},{...fixture.user,token:fixture.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().startsWith(base)&&r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});await page.goto(base+'/game',{waitUntil:'networkidle'});await ready();const adventure=await probe('adventure');
 await disconnect();await dbPool.execute('UPDATE users SET map=?,x=?,y=? WHERE id=?',['route13',432,592,fixture.user.id]);await page.goto(base+'/game',{waitUntil:'networkidle'});await ready();
 await step('move_s','cave_rochebrume3');await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>window.snowVm.worldWeatherActive),false);assert.equal(await page.evaluate(()=>window.snowVm._worldWeather?.canvas||null),null);
 await capture('cave-no-snow');await step('move_z','route13');await validateSnowUi(page,{capture,label:'snow-returned'});
 await page.goto(base+'/colosseum',{waitUntil:'networkidle'});await page.locator('[data-colosseum-start]:enabled').click();await page.locator('[data-starter-choice]').first().click();await page.locator('.starter-backdrop').waitFor({state:'hidden'});const p=cleanup.runtime.playerFor(fixture.user);Object.assign(p,{currentmap:'route13',x:432,y:48});await page.reload({waitUntil:'networkidle'});await ready();const colosseum=await probe('colosseum');cleanup.runtime.abandon(p);store.leave(fixture.user);
 const second=await create();store.connect(fixture.user,'snow-host');store.connect(second.user,'snow-partner');const lobby=store.create(fixture.user,{capacity:2,durationMinutes:30});store.join(second.user,lobby.code);for(const f of [fixture,second])store.ready(f.user,true);await cleanup.runtime.start(fixture.user);for(const f of [fixture,second]){const p=cleanup.runtime.playerFor(f.user);cleanup.runtime.chooseStarter(p,p.starterChoices[0].uuid);Object.assign(p,{currentmap:'route13',x:432,y:48});}
 await page.goto(base+'/drift/game',{waitUntil:'networkidle'});await ready();const rift=await probe('rift');assert.deepEqual(errors,[]);success=true;console.log(JSON.stringify({adventure,colosseum,rift,viewports:4,reducedMotion:true,actualCaveEntryAndReturn:true,sharedClimate:true,heavyAndAnimated:true,errors,output}));
}finally{if(!success&&page)await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});await browser?.close();cleanup();await new Promise(resolve=>io.close(resolve));await new Promise(resolve=>setTimeout(resolve,200));for(const id of ids)await dbPool.execute('DELETE FROM users WHERE id=?',[id]);await dbPool.end();}})().catch(e=>{console.error(e.stack);process.exitCode=1});
