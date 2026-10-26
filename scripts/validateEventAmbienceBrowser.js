// Real room-audio gains and Ana’s decoration on a disposable SQL account.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),http=require('node:http');
const{once}=require('node:events'),{randomUUID}=require('node:crypto');
if(!/test/i.test(process.env.DB_TEST_NAME||''))throw Error('Dedicated test DB required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';
const express=require('express'),{Server}=require('socket.io'),{chromium}=require('playwright'),{dbPool:db}=require('../server/config/database');
const dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-event-ambience-dist',app=express(),server=http.createServer(app),io=new Server(server);
app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
let browser,page,id;const checks=[],errors=[];
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'volume_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(r.status,201);const u=await r.json();id=u.user.id;
 for(const[k,v]of Object.entries({lucie_freed:'true',lucie_departure:'seen',professor_lab_key:'true','arena_entry:champion_ana':'true'}))await db.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value)VALUES(?,?,?)',[id,k,v]);
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true});await context.addInitScript(s=>localStorage.setItem('explorakit.user',JSON.stringify(s)),{...u.user,token:u.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 for(const map of ['route2_maison','professor_lab','ville3_arene']){
  if(page.url()!=='about:blank'){await page.evaluate(()=>new Promise(r=>v.socket.emit('requestGameSave',r)));await page.evaluate(()=>v.socket.disconnect());await page.waitForTimeout(160);}
  await db.execute('UPDATE users SET map=?,x=432,y=528 WHERE id=?',[map,id]);await page.goto(base+'/game',{waitUntil:'networkidle'});await page.waitForFunction(map=>{const v=document.querySelector('.game-root')?.__vue__;if(!v?.socket?.connected||v.mapLoading||v.renderedMap!==map)return false;window.v=v;return true;},map);
  const gain=map==='ville3_arene'?.34:.5,track=map==='ville3_arene'?'ana-room':'lucie-room';
  for(const volume of [60,0,100]){
   await page.evaluate(async volume=>{v.updatePreferences({...v.preferences,masterVolume:volume});await v.$nextTick();v.syncWorldMusic();},volume);
   await page.waitForFunction(({volume,track,gain})=>Math.abs((v._worldMusic?.tracks.get(track)?.volume??-1)-volume/100*gain)<1e-9,{volume,track,gain});
   const audio=await page.evaluate(()=>{const m=v._worldMusic,a=m.tracks.get(m.track);return{map:v.map,track:m.track,src:a.src,volume:a.volume,paused:a.paused};});assert.equal(audio.track,track);assert.match(audio.src,map==='ville3_arene'?/ana_arene/:/lucie-maison/);if(!volume)assert(audio.paused);checks.push({...audio,masterVolume:volume});
  }
  if(map==='ville3_arene'){
   await page.waitForFunction(()=>v._placeAmbience?.ana?.foliage.length===18);
   for(const [width,height]of [[320,568],[393,852],[844,390],[1365,900]]){await page.setViewportSize({width,height});await page.evaluate(async w=>{v.showMobileControls=w<=920;await v.$nextTick();v.resizeWorldViewport();},width);await page.waitForTimeout(150);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:'/tmp/riftmon-ana-pink-canvas/world-'+width+'.png'});}
   await page.evaluate(()=>v.updatePreferences({...v.preferences,animationsEnabled:false}));await page.waitForTimeout(120);const frozen=await page.evaluate(()=>v._placeAmbience.ana.frames);await page.waitForTimeout(120);assert.equal(await page.evaluate(()=>v._placeAmbience.ana.frames),frozen);
  }
 }
 assert.deepEqual(errors,[]);const result={rooms:2,controlRoom:'ville3_arene',anaWorldViewports:4,anaReducedMotion:true,checks,masterSliderHonored:true,muteHonored:true,errors};fs.writeFileSync('/tmp/riftmon-event-ambience-browser.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser?.close();await new Promise(r=>io.close(r));await new Promise(r=>setTimeout(r,200));if(id)await db.execute('DELETE FROM users WHERE id=?',[id]);await db.end();}})().catch(e=>{console.error(e.stack);process.exitCode=1});
