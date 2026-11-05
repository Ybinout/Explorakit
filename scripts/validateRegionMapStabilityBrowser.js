// Real authenticated client, dedicated test account; classic desktop scrollbar regression.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{once}=require('node:events'),{randomUUID,createHash}=require('node:crypto');
if(process.env.DB_TEST_NAME!=='explorakit_test')throw Error('Dedicated test database required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';
const {dbPool:db}=require('../server/config/database'),engine=process.env.PRESENTATION_BROWSER||'chromium',dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-minimap-stability-dist',out=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-minimap-stability-'+engine,diagnostic=process.env.RELEASE_ALLOW_JITTER==='1';fs.mkdirSync(out,{recursive:true});fs.rmSync(path.join(out,'report.json'),{force:true});
const express=require('express'),app=express(),server=http.createServer(app),io=new(require('socket.io').Server)(server);app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
let browser,page,userId,success=false,terrainReport=null;const errors=[],checks=[],newAtlas=process.env.RELEASE_ATLAS_CHECKS==='1';
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(v?.socket?.connected&&v.players[v.socket.id]&&!v.mapLoading&&v.renderedMap===v.map){window.v=v;return true;}});}
async function menu(name){await page.locator('.menu-toggle-btn').click();await page.locator(`[data-menu-action="${name}"]`).click();}
async function mapReady(){await page.locator('.region-art').waitFor();await page.evaluate(()=>{const find=v=>v.$options.name==='RegionMapPanel'?v:v.$children.map(find).find(Boolean);window.m=find(v);});if(newAtlas)await page.waitForFunction(()=>v.progressionState.flight?.unlocked);await page.evaluate(()=>document.fonts.ready);await page.waitForFunction(()=>{const e=m.$refs.mapScroll;return e&&m.viewport.width===e.clientWidth&&m.viewport.height===e.clientHeight;});await page.waitForTimeout(160);}
async function sample(label){
 await page.waitForTimeout(160);
 const samples=await page.evaluate(()=>new Promise(resolve=>{const a=[];let n=0;function frame(){const e=m.$refs.mapScroll,art=e.querySelector('.region-art').getBoundingClientRect();a.push([m.zoom,e.clientWidth,e.clientHeight,m.layout.mapWidth,m.layout.mapHeight,art.width,art.height,e.scrollLeft,e.scrollTop].map(n=>Math.round(n*1000)/1000));if(++n<40)requestAnimationFrame(frame);else resolve(a);}requestAnimationFrame(frame);}));
 const states=[...new Set(samples.map(s=>JSON.stringify(s)))],gutter=await page.locator('.map-scroll').evaluate(e=>({width:e.offsetWidth-e.clientWidth,height:e.offsetHeight-e.clientHeight-6}));checks.push({label,zoom:await page.evaluate(()=>m.zoom),frames:samples.length,distinctStates:states.length,gutter,samples:states.slice(0,4)});
 if(!diagnostic)assert.equal(states.length,1,'Map resized or moved without input: '+JSON.stringify(checks.at(-1)));
}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'Map_stable_'+randomUUID().slice(0,8),password:randomUUID(),starterId:7})});assert.equal(r.status,201);const a=await r.json();userId=a.user.id;
 await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,'adventure_opening','complete') ON DUPLICATE KEY UPDATE flag_value='complete'",[userId]);await require('../server/persistence/progressionRepository').markPokemonSeen(userId,129);
 await require('../server/persistence/patchNotesRepository').acknowledge(userId,require('../data/game/latest_patch.json').version);
 if(newAtlas){
  await require('../server/persistence/progressionRepository').markPokemonSeen(userId,501);
  for(const flag of ['raphael_defeated','visited_town:safari8'])await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,'true') ON DUPLICATE KEY UPDATE flag_value='true'",[userId,flag]);
 }
 browser=await require('playwright')[engine].launch({headless:true,...(engine==='chromium'?{ignoreDefaultArgs:['--hide-scrollbars'],args:['--no-sandbox','--disable-features=OverlayScrollbar']}: {})});const context=await browser.newContext({viewport:{width:1536,height:900},serviceWorkers:'block'});await context.addInitScript(a=>localStorage.setItem('explorakit.user',JSON.stringify(a)),{...a.user,token:a.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/game');await ready();await page.evaluate(()=>v.updatePreferences({...v.preferences,masterVolume:0,animationsEnabled:false}));
 await page.addStyleTag({content:'.map-scroll::-webkit-scrollbar{display:block;width:16px;height:16px}'});await menu('minimap');await mapReady();assert.equal(await page.locator('[data-current-marker]').count(),1);
 for(const[width,height]of[[1536,900],[1536,800],[1365,900],[1280,720]]){
  await page.setViewportSize({width,height});if(await page.locator('[data-map-zoom="reset"]').isEnabled())await page.locator('[data-map-zoom="reset"]').click();await sample(`classic-${width}x${height}-overview`);
  await page.locator('[data-map-zoom="in"]').click();assert.equal(await page.locator('.map-zoom-level').innerText(),'125 %');await sample(`classic-${width}x${height}-125`);
  await page.locator('[data-map-zoom="in"]').click();await sample(`classic-${width}x${height}-156`);
 }
 if(!diagnostic){
  if(engine==='chromium')assert(checks.some(c=>c.gutter.width>0&&c.gutter.height>0),'Classic scrollbar space must be exercised');
  await page.setViewportSize({width:1536,height:900});for(let i=0;i<7;i++)if(await page.locator('[data-map-zoom="in"]').isEnabled())await page.locator('[data-map-zoom="in"]').click();assert.equal(await page.locator('.map-zoom-level').innerText(),'400 %');await sample('maximum-zoom');
  const box=await page.locator('.map-scroll').boundingBox(),before=await page.locator('.map-scroll').evaluate(e=>({x:e.scrollLeft,y:e.scrollTop}));await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2-55,box.y+box.height/2-35,{steps:5});await page.mouse.up();const after=await page.locator('.map-scroll').evaluate(e=>({x:e.scrollLeft,y:e.scrollTop}));assert(after.x>before.x+30&&after.y>before.y+20);await sample('mouse-pan');
  await page.locator('.region-location button').click();const pin=await page.locator('[data-current-marker]').boundingBox(),viewport=await page.locator('.map-scroll').boundingBox();assert(pin.x>=viewport.x-1&&pin.x+pin.width<=viewport.x+viewport.width+1&&pin.y>=viewport.y-1&&pin.y+pin.height<=viewport.y+viewport.height+1);
  await page.locator('[data-map-zoom="reset"]').click();assert.equal(await page.locator('.map-zoom-level').innerText(),'100 %');assert(await page.locator('.map-scroll').evaluate(e=>e.scrollLeft===0&&e.scrollTop===0));
  await page.locator('.map-scroll').focus();await page.keyboard.press('+');assert.equal(await page.locator('.map-zoom-level').innerText(),'125 %');await sample('keyboard-125');await page.keyboard.press('0');await page.mouse.move(viewport.x+100,viewport.y+100);await page.mouse.wheel(0,-120);await page.waitForTimeout(150);assert(await page.evaluate(()=>m.zoom>1));await sample('wheel-zoom');
  await page.addStyleTag({content:'.map-scroll::-webkit-scrollbar{display:none;width:0;height:0}'});await page.locator('[data-map-zoom="reset"]').click();await page.locator('[data-map-zoom="in"]').click();await sample('overlay-125');
  for(const mode of['light','dark']){await page.evaluate(mode=>v.updatePreferences({...v.preferences,themeMode:mode}),mode);await sample('desktop-theme-'+mode);await page.screenshot({path:path.join(out,'desktop-'+mode+'.png')});}
  await page.setViewportSize({width:393,height:852});await page.locator('[data-map-zoom="reset"]').click();await page.locator('[data-map-zoom="in"]').click();await sample('mobile-125');assert(await page.locator('.region-panel').evaluate(e=>e.scrollWidth<=e.clientWidth+1));await page.screenshot({path:path.join(out,'mobile.png')});
  await page.locator('.region-close').click();await menu('pokedex');await page.locator('.dex-search input').fill('129');await page.locator('[data-dex-location="129"]').click();await mapReady();assert(await page.locator('[data-habitat-ping]').count()>0);await page.setViewportSize({width:1536,height:900});await page.locator('[data-map-zoom="in"]').click();await sample('pokedex-habitat-125');await page.keyboard.press('Escape');assert.equal(await page.locator('.dex-search input').inputValue(),'129');await page.locator('.dex-close').click();
 }
 if(newAtlas){
  await menu('minimap');await mapReady();
  const geometry=await page.evaluate(()=>{
   const terrain=document.querySelector('[data-atlas-terrain]'),wrong=[];
   for(const n of m.atlas.nodes){
    const dark=/^jungle/.test(n.id),safari=/^safari/.test(n.id),tournament=n.kind==='event';
    const path=terrain.querySelector(dark?'[data-dark-coast]':safari?'[data-safari-coast]':tournament?'[data-tournament-island] path:last-child':'[data-mainland-coast]');
    const x=n.x-(dark?m.atlas.darkContinent.offsetX:safari?m.atlas.safari.x:0),y=n.y-(safari?m.atlas.safari.y:0);
    if(!path.isPointInFill(new DOMPoint(x,y)))wrong.push(n.id);
   }
   return{wrong,total:m.atlas.nodes.length,safari:{...m.atlas.safari},decorativeOnly:getComputedStyle(terrain).pointerEvents==='none',routes:m.edges.length,svgElements:document.querySelector('.region-art').querySelectorAll('*').length};
  });
  assert.deepEqual(geometry.wrong,[],'Every marker must lie on its island');assert.equal(geometry.total,51);assert(geometry.decorativeOnly);assert(geometry.routes>20);assert.equal(geometry.safari.x,465);assert.equal(geometry.safari.y,445);
  for(const mode of ['light','dark']){await page.evaluate(mode=>v.updatePreferences({...v.preferences,themeMode:mode}),mode);await page.screenshot({path:path.join(out,'atlas-overview-'+mode+'.png')});await page.locator('.region-art').screenshot({path:path.join(out,'atlas-geography-'+mode+'.png')});}
  await page.locator('[data-map-node="safari8"]').click();assert.equal(await page.locator('[data-fly]').isEnabled(),true);assert.equal(await page.evaluate(()=>m.selected),'safari8');
  await page.locator('[data-fly]').click();await page.waitForFunction(()=>v.map==='safari8'&&!v.mapLoading&&!v.flight);await menu('minimap');await mapReady();
  assert.deepEqual(await page.evaluate(()=>({id:m.currentNode.id,x:m.currentNode.x,y:m.currentNode.y})),{id:'safari8',x:612,y:508});
  await page.locator('.region-location button').click();await sample('safari-current-marker');await page.screenshot({path:path.join(out,'atlas-safari-current.png')});
  await page.locator('.region-close').click();await menu('pokedex');await page.locator('.dex-search input').fill('501');await page.locator('[data-dex-location="501"]').click();await mapReady();
  const habitats=await page.evaluate(()=>m.habitatNodes.map(n=>({id:n.id,x:n.x,y:n.y})));assert(habitats.length>0&&habitats.every(n=>/^safari/.test(n.id)));
  for(const n of habitats){const pin=page.locator(`[data-habitat-ping="${n.id}"] circle`).first();assert.equal(Number(await pin.getAttribute('cx')),n.x);assert.equal(Number(await pin.getAttribute('cy')),n.y);}
  await page.setViewportSize({width:393,height:852});await mapReady();await page.screenshot({path:path.join(out,'atlas-safari-habitats-mobile.png')});
  terrainReport={geometry,actualFlightToSafari:true,currentSafariMarkerAligned:true,pokedexSafariHabitatsAligned:true,habitatCount:habitats.length};
 }
 assert.deepEqual(errors,[]);success=true;fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({success,engine,diagnostic,stable:checks.every(c=>c.distinctStates===1),buildIndexSha256:createHash('sha256').update(fs.readFileSync(dist+'/index.html')).digest('hex'),checks,terrain:terrainReport,controls:!diagnostic?{buttons:true,keyboard:true,wheel:true,mousePan:true,locateMarker:true,overviewReset:true,mobileLayout:true,pokedexHabitats:true}:null,errors},null,2));
}catch(e){console.error(e.stack);if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});process.exitCode=1;}
finally{await browser?.close();require('../server/realtime/whitepeakClub').getClub(io).close();await new Promise(r=>io.close(r));await require('../server/realtime/accountConnection').waitForAccountConnections(io);if(userId)await db.execute('DELETE FROM users WHERE id=?',[userId]);await db.end();console.log(JSON.stringify({success,engine,checks:checks.length,testUserDeleted:true}));}})();
