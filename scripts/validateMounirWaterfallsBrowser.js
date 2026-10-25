// Shared world/battle renderer on a disposable Colosseum run and a test DB.
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),http=require('http'),{once}=require('events'),{randomUUID}=require('crypto');
if(!/test/i.test(process.env.DB_TEST_NAME||''))throw Error('Dedicated test database required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';process.env.BATTLE_DELAY_SCALE='0';
const express=require('express'),{Server}=require('socket.io'),{chromium}=require('playwright'),{dbPool}=require('../server/config/database');
const dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-waterfalls-dist',out=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-waterfalls-browser';fs.mkdirSync(out,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server);app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));
const cleanup=require('../server/realtime/driftLobbyHandler').registerDriftLobbies(io,{checkpointRepository:{async save(){}},runtimeOptions:{random:()=>.9,paceMs:0}});
let browser,page,userId,success=false;const errors=[],views=[];
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 const response=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'falls_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(response.status,201);const fixture=await response.json();userId=fixture.user.id;
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true});await context.addInitScript(s=>localStorage.setItem('explorakit.user',JSON.stringify(s)),{...fixture.user,token:fixture.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().startsWith(base)&&r.status()>=400)errors.push(r.status()+' '+r.url());});
 await page.goto(base+'/colosseum',{waitUntil:'networkidle'});await page.locator('[data-colosseum-start]:enabled').click();await page.locator('[data-starter-choice]').first().click();await page.locator('.starter-backdrop').waitFor({state:'hidden'});
 await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(!v?.socket?.connected)return false;window.v=v;return true;});await page.evaluate(()=>v.updatePreferences({...v.preferences,masterVolume:0}));
 const player=cleanup.runtime.playerFor(fixture.user);player.equipe.pokemons=[require('../server/game/drift/pokemonFactory').create(9,90,true)];Object.assign(player,{currentmap:'ville1_arene',x:432,y:176});cleanup.runtime.enter(fixture.user,{id:player.socketId});
 await page.waitForFunction(()=>v.renderedMap==='ville1_arene'&&v._villageWater?._waterfalls?.frames>1);assert(await page.evaluate(()=>v._villageWater._waterfalls.mask.pixels.length>2000));
 await page.screenshot({path:path.join(out,'hall-mobile.png')});
 const battle=cleanup.runtime.battle(player,{npc:true,equipe:require('../server/game/world/pnjTeamFactory').getPnjTeam('moonpunch'),drifts:[],equipped:[],chain:0},'arena','moon');battle.deadline=Date.now()+240000;
 await page.locator('.action-attack:enabled').waitFor();assert.equal(battle.state.weather.kind,'rain');
 for(const[width,height]of [[320,568],[393,852],[844,390],[1365,900]]){
  await page.setViewportSize({width,height});await page.waitForTimeout(120);await page.evaluate(async w=>{v.showMobileControls=w<=920;await v.$nextTick();v.resizeWorldViewport();},width);
  const expected=width<=920&&height>width?'mobile':'wide';
  await page.waitForFunction(kind=>{const layer=document.querySelector('[data-battle-waterfalls]')?.__vue__;return layer?._renderer?.kind===kind&&layer._renderer.frames>1;},expected);
  const before=await page.locator('[data-battle-waterfalls]').evaluate(el=>el.toDataURL());await page.waitForTimeout(220);const after=await page.locator('[data-battle-waterfalls]').evaluate(el=>el.toDataURL());assert.notEqual(before,after);
  const geometry=await page.evaluate(()=>{const e=document.querySelector('[data-battle-waterfalls]'),b=document.querySelector('[data-battle-environment="lake-gym"] img'),r=e.getBoundingClientRect(),s=b.getBoundingClientRect(),v=e.__vue__._renderer;return{rect:[r.x,r.y,r.width,r.height],background:[s.x,s.y,s.width,s.height],regions:v.profile.regions.map((_,n)=>v.mask.pixels.filter(i=>v.mask.owners[i]===n+1).length),kind:v.kind};});
  assert.deepEqual(geometry.rect,geometry.background);assert(geometry.regions.every(n=>n>3));views.push({width,kind:geometry.kind,waterfalls:geometry.regions.length});await page.screenshot({path:path.join(out,`battle-${width}.png`)});
 }
 for(const reduced of ['game','system']){
  if(reduced==='game')await page.evaluate(()=>v.updatePreferences({...v.preferences,animationsEnabled:false}));else await page.emulateMedia({reducedMotion:'reduce'});
  await page.waitForFunction(()=>document.querySelector('[data-battle-waterfalls]').width===0&&!document.querySelector('[data-battle-waterfalls]').__vue__._renderer.canvas);
  if(reduced==='game')await page.evaluate(()=>v.updatePreferences({...v.preferences,animationsEnabled:true}));else await page.emulateMedia({reducedMotion:'no-preference'});
  await page.waitForFunction(()=>document.querySelector('[data-battle-waterfalls]').__vue__._renderer.canvas);
 }
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});assert.equal(await page.locator('[data-battle-waterfalls]').evaluate(el=>el.width),0);
 await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});await page.waitForFunction(()=>document.querySelector('[data-battle-waterfalls]').__vue__._renderer.canvas);
 await page.evaluate(()=>{const el=document.querySelector('[data-battle-waterfalls]');window.oldFalls=el.__vue__._renderer;window.oldFallsCanvas=el;v.$refs.battleOverlay.battleMapName='cave1';});await page.waitForFunction(()=>!document.querySelector('[data-battle-waterfalls]'));assert(await page.evaluate(()=>oldFalls.destroyed&&!oldFalls.canvas&&oldFallsCanvas.width===0));
 await page.evaluate(()=>v.$refs.battleOverlay.battleMapName='ville1_arene');await page.waitForFunction(()=>document.querySelector('[data-battle-waterfalls]')?.__vue__?._renderer.canvas);
 battle.finish(null,'fled');await page.locator('[data-battle-result-continue]').click();await page.waitForFunction(()=>!v.battle&&v._villageWater?._waterfalls?.canvas);assert.equal(await page.locator('[data-battle-waterfalls]').count(),0);
 assert.deepEqual(errors,[]);success=true;console.log(JSON.stringify({hallCurtains:10,views,reducedMotion:true,hiddenResume:true,environmentDisposal:true,worldReturn:true,errors,out}));
}finally{if(!success&&page)await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});await browser?.close();cleanup();await new Promise(r=>io.close(r));if(userId)await dbPool.execute('DELETE FROM users WHERE id=?',[userId]);await dbPool.end();}})().catch(e=>{console.error(e.stack);process.exitCode=1});
