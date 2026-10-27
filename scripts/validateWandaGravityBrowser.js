// Actual shared world renderer, isolated SQL accounts and real game controls.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(!/test/i.test(process.env.DB_TEST_NAME||''))throw Error('Dedicated test database required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';process.env.BATTLE_DELAY_SCALE='0';
const express=require('express'),{Server}=require('socket.io'),{chromium}=require('playwright'),{dbPool:db}=require('../server/config/database');
const dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-wanda-gravity-dist',out=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-wanda-gravity-browser';fs.mkdirSync(out,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server);app.use(express.json());app.use('/api',require('../server/http/routes'));
app.get('/__test/worldCamera.js',(_q,r)=>r.sendFile(path.resolve(__dirname,'../vue-explorakit/src/services/worldCamera.js')));
app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
const store=require('../server/game/drift/lobbyStore').createLobbyStore();
const cleanup=require('../server/realtime/driftLobbyHandler').registerDriftLobbies(io,{store,checkpointRepository:{async save(){}},runtimeOptions:{random:()=>.9,paceMs:0}});
let browser,page,success=false;const users=[],errors=[],views=[],modes=[];
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(!v?.socket?.connected||!v.players[v.socket.id]||v.mapLoading||v.renderedMap!==v.map)return false;window.v=v;return true;});}
async function effects(){await page.waitForFunction(()=>v.map==='ville4_arene'&&v._placeAmbience?.wanda?.canvas&&v._placeAmbience.wanda.frames>1);}
async function dialogueDone(){for(let i=0;i<35&&await page.locator('.dialogue-layer .text').count();i++){await page.locator('.dialogue-layer .text').click();await page.waitForTimeout(100);}}
async function create(base){const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'wanda_gravity_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(r.status,201);const f=await r.json();users.push(f.user.id);return f;}
async function capture(mode){
 for(const [width,height]of[[320,568],[393,852],[844,390],[1365,900]]){
  await page.setViewportSize({width,height});await page.evaluate(w=>{v.showMobileControls=w<1000;},width);await page.waitForTimeout(350);await effects();
  const info=await page.evaluate(async()=>{const r=v._placeAmbience.wanda,c=v.$refs.gameCanvas||document.querySelector('canvas'),p=v.players[v.socket.id],{getWorldCamera}=await import('/__test/worldCamera.js');
   const camera=getWorldCamera(c.width,c.height,p,v.showMobileControls);const crystals=r.poses.filter(p=>p.kind==='crystal'&&p.x*2>camera.x&&p.x*2<camera.x+camera.visibleWidth&&p.y*2>camera.y&&p.y*2<camera.y+camera.visibleHeight).length;
   return{overflow:document.documentElement.scrollWidth>innerWidth+1,crystals,props:r.poses.length,inlays:r.inlayPixels,camera,position:{x:p.x,y:p.y},canvas:{width:c.width,height:c.height}};});
  assert(!info.overflow);assert.equal(info.props,14);assert.equal(info.inlays,7896);assert(info.crystals>=2,'At least two crystals visible, including on centered phone camera');views.push({mode,width,height,...info});
  await page.screenshot({path:path.join(out,mode+'-'+width+'.png')});
 }
 modes.push(mode);
}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`,a=await create(base),b=await create(base);
 await db.execute("UPDATE users SET map='ville4_arene',x=432,y=528 WHERE id=?",[a.user.id]);
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true});await context.addInitScript(f=>{if(location.protocol.startsWith('http'))localStorage.setItem('explorakit.user',JSON.stringify(f));},{...a.user,token:a.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().startsWith(base)&&r.status()>=400)errors.push(r.status()+' '+r.url());});
 await page.goto(base+'/game',{waitUntil:'networkidle'});await ready();await page.keyboard.press('Shift');
 await page.waitForFunction(()=>v.wandaArenaSpeaking&&v._placeAmbience.wanda?.speaking);await page.waitForTimeout(80);
 const paused=await page.evaluate(()=>({clock:v._placeAmbience.wanda.floatTime,flow:v._placeAmbience.wanda.flowTime,poses:JSON.stringify(v._placeAmbience.wanda.poses)}));await page.waitForTimeout(200);
 assert.equal(await page.evaluate(()=>v._placeAmbience.wanda.floatTime),paused.clock);assert.equal(await page.evaluate(()=>JSON.stringify(v._placeAmbience.wanda.poses)),paused.poses);assert(await page.evaluate(()=>v._placeAmbience.wanda.flowTime)>paused.flow);
 await page.waitForTimeout(1150);assert(await page.evaluate(()=>v._placeAmbience.wanda.floatTime)>paused.clock);assert(await page.evaluate(()=>v.wandaArenaSpeaking),'resumes while dialogue remains open');await dialogueDone();await effects();
 for(let i=0;i<6;i++){await page.evaluate(()=>v.socket.emit('playerAction','move_z'));await page.waitForTimeout(180);}
 await capture('aventure');
 await page.evaluate(()=>v.updatePreferences({...v.preferences,animationsEnabled:false}));await page.waitForTimeout(150);const staticState=await page.evaluate(()=>({frames:v._placeAmbience.wanda.frames,image:v._placeAmbience.wanda.canvas.toDataURL()}));await page.waitForTimeout(350);assert.deepEqual(await page.evaluate(()=>({frames:v._placeAmbience.wanda.frames,image:v._placeAmbience.wanda.canvas.toDataURL()})),staticState);
 await page.evaluate(()=>{window.oldWanda=v._placeAmbience.wanda.canvas;Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});assert(await page.evaluate(()=>oldWanda.width===0&&!v._placeAmbience.wanda.canvas));
 await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));v.updatePreferences({...v.preferences,animationsEnabled:true});});await effects();
 const before=await page.evaluate(()=>v.players[v.socket.id].y);await page.evaluate(()=>v.socket.emit('playerAction','move_z'));await page.waitForFunction(y=>v.players[v.socket.id].y<y,before);assert.equal(before-await page.evaluate(()=>v.players[v.socket.id].y),32,'approach stays walkable');
 await page.evaluate(()=>window.oldRenderer=v._placeAmbience.wanda);await page.goto(base+'/colosseum',{waitUntil:'networkidle'});await page.locator('[data-colosseum-start]:enabled').click();await page.locator('[data-starter-choice]').first().click();await page.locator('.starter-backdrop').waitFor({state:'hidden'});await ready();
 async function locate(){const p=cleanup.runtime.playerFor(a.user);Object.assign(p,{currentmap:'ville4_arene',x:432,y:336});cleanup.runtime.enter(a.user,{id:p.socketId});await effects();}
 await locate();await capture('colosseum');
 const p=cleanup.runtime.playerFor(a.user);cleanup.runtime.abandon(p);store.leave(a.user);await page.goto(base+'/colosseum',{waitUntil:'networkidle'});
 store.connect(a.user,'gravity-host');store.connect(b.user,'gravity-guest');const lobby=store.create(a.user,{capacity:2,durationMinutes:30});store.join(b.user,lobby.code);for(const f of[a,b])store.ready(f.user,true);await cleanup.runtime.start(a.user);for(const f of[a,b]){const p=cleanup.runtime.playerFor(f.user);cleanup.runtime.chooseStarter(p,p.starterChoices[0].uuid);}
 await page.goto(base+'/drift/game',{waitUntil:'networkidle'});await ready();await locate();await capture('rift');
 await page.evaluate(()=>window.oldSurface=v._placeAmbience.wanda.canvas);const riftPlayer=cleanup.runtime.playerFor(a.user);Object.assign(riftPlayer,{currentmap:'start',x:336,y:272});cleanup.runtime.enter(a.user,{id:riftPlayer.socketId});await page.waitForFunction(()=>v.map==='start'&&v.renderedMap==='start'&&!v.mapLoading);assert(await page.evaluate(()=>oldSurface.width===0&&!v._placeAmbience.wanda.canvas));
 await page.close();const desktop=await browser.newContext({viewport:{width:1365,height:900},hasTouch:false,isMobile:false});await desktop.addInitScript(f=>{if(location.protocol.startsWith('http'))localStorage.setItem('explorakit.user',JSON.stringify(f));},{...a.user,token:a.token});page=await desktop.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/game',{waitUntil:'networkidle'});await ready();await effects();assert(await page.evaluate(()=>!v.showMobileControls&&document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(out,'desktop-keyboard-1365.png')});
 assert.deepEqual(errors,[]);success=true;const result={modes,views,desktopKeyboard:true,speechPause:true,speechResume:true,floorKeepsFlowing:true,reducedMotion:true,hidden:true,centralMovement:true,mapChangeReleases:true,errors,out};fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{if(!success&&page&&!page.isClosed()){await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});console.error(await page.evaluate(()=>({map:window.v?.map,speech:window.v?.endSentences,position:window.v?.players[window.v?.socket?.id],text:document.body.innerText.slice(-900)})).catch(()=>null));}await browser?.close();cleanup();await new Promise(r=>io.close(r));await new Promise(r=>setTimeout(r,180));for(const id of users)await db.execute('DELETE FROM users WHERE id=?',[id]);await db.end();}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
