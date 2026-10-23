// Real HTTP/socket integration against a dedicated test database.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(!/test/i.test(process.env.DB_TEST_NAME||''))throw Error('Dedicated test database required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';
const express=require('express'),{Server}=require('socket.io'),{chromium}=require('playwright'),{dbPool}=require('../server/config/database');
const dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-region-dist',output='/tmp/riftmon-region-browser';fs.mkdirSync(output,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server);
app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));
io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
const cleanup=require('../server/realtime/driftLobbyHandler').registerDriftLobbies(io,{store:require('../server/game/drift/lobbyStore').createLobbyStore(),checkpointRepository:{async save(){}},runtimeOptions:{paceMs:0}});
let browser,page,user,base,success=false;const errors=[];
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(!v?.socket?.connected||v.mapLoading||!v.players[v.socket.id])return false;window.mapVm=v;return true;});}
async function menu(name){await page.locator('.menu-toggle-btn').click();await page.locator(`[data-menu-action="${name}"]`).click();}
async function mapReady(){await page.locator('.region-art').waitFor();}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}`;
 assert.equal((await fetch(base+'/api/world-map')).status,401);
 const response=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'map_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(response.status,201);user=await response.json();
 for(const id of [129,3,150])await require('../server/persistence/progressionRepository').markPokemonSeen(user.user.id,id);
 const dex=await (await fetch(base+`/api/users/${user.user.id}/pokedex`,{headers:{Authorization:`Bearer ${user.token}`}})).json();assert(!dex.entries.find(p=>p.id===151).habitat);assert.equal(dex.entries.find(p=>p.id===129).habitat.kind,'wild');
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:393,height:852},isMobile:true,hasTouch:true});
 await context.addInitScript(s=>{if(location.protocol==='http:')localStorage.setItem('explorakit.user',JSON.stringify(s));},{...user.user,token:user.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/game',{waitUntil:'networkidle'});await ready();await menu('minimap');await mapReady();
 assert.equal(await page.locator('[data-current-marker]').count(),1);assert.match(await page.locator('.region-location').innerText(),/Village de départ/);
 for(const [width,height]of [[320,568],[393,852],[1365,900]]){
  await page.setViewportSize({width,height});const panel=await page.locator('.region-panel').boundingBox();assert(panel.x>=0&&panel.x+panel.width<=width+1);assert(panel.y>=0&&panel.y+panel.height<=height+1);
  await page.screenshot({path:path.join(output,`map-${width}.png`)});
 }
 await page.setViewportSize({width:393,height:852});await page.locator('#region-place').selectOption('ville5');assert.match(await page.locator('.place-detail').innerText(),/Blanchecime/);
 await page.locator('.map-legend button').click();assert(await page.locator('.map-scroll').evaluate(e=>e.scrollWidth>e.clientWidth));await page.locator('.region-close').click();
 await menu('pokedex');const search=page.locator('.dex-search input');await search.fill('129');await page.locator('[data-dex-location="129"]').click();await mapReady();
 assert.equal(await page.locator('[data-habitat-ping]').count(),6);assert.match(await page.locator('.place-detail').innerText(),/Pêche/);await page.screenshot({path:path.join(output,'fishing-393.png')});
 await page.keyboard.press('Escape');assert.equal(await search.inputValue(),'129');assert(await page.locator('[data-dex-location="129"]').evaluate(e=>e===document.activeElement));
 await search.fill('003');await page.locator('[data-dex-location="3"]').click();await mapReady();assert.match(await page.locator('.habitat-heading').innerText(),/évolution/);assert(await page.locator('[data-habitat-ping]').count()>0);await page.locator('.region-close').click();
 await search.fill('150');await page.locator('[data-dex-location="150"]').click();await mapReady();assert.match(await page.locator('.habitat-heading').innerText(),/Aucun habitat/);assert.equal(await page.locator('[data-habitat-ping]').count(),0);await page.locator('.region-close').click();
 await search.fill('151');assert.equal(await page.locator('[data-dex-location="151"]').count(),0);await page.locator('.dex-close').click();
 // Real Centre save, reload and use the server's preserved return location.
 await page.evaluate(()=>window.mapVm.socket.disconnect());await new Promise(r=>setTimeout(r,350));
 const door=require('../data/game/nextMap.json').maps.find(m=>m.mapName==='ville5').mapchange.find(c=>c.goto==='centre');
 const returnPoint=require('../server/game/world/pokemonCenterTravel').getPokemonCenterEntryReturn('ville5',door.valX,door.valY);assert(returnPoint);
 await dbPool.execute('UPDATE users SET map="centre", x=432,y=464,center_return_map="ville5",center_return_x=?,center_return_y=? WHERE id=?',[returnPoint.x,returnPoint.y,user.user.id]);
 await page.reload({waitUntil:'networkidle'});await ready();await menu('minimap');await mapReady();assert.match(await page.locator('.region-location').innerText(),/Blanchecime/);await page.locator('.region-close').click();
 await page.close();
 const desktop=await browser.newContext({viewport:{width:1365,height:900}});
 await desktop.addInitScript(s=>{if(location.protocol==='http:')localStorage.setItem('explorakit.user',JSON.stringify(s));},{...user.user,token:user.token});
 page=await desktop.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/game',{waitUntil:'networkidle'});await ready();await menu('minimap');await mapReady();
 assert(!await page.locator('.game-root').evaluate(e=>e.classList.contains('is-mobile')));
 await page.screenshot({path:path.join(output,'map-desktop.png')});
 await page.keyboard.press('Shift+Tab');assert(await page.locator('#region-place').evaluate(e=>e===document.activeElement));
 await page.keyboard.press('Escape');await page.waitForFunction(()=>document.activeElement===document.querySelector('.menu-toggle-btn'));
 await page.route('**/api/world-map',r=>r.fulfill({status:503,body:'Unavailable'}));await menu('minimap');await page.locator('.region-state button').waitFor();assert.match(await page.locator('.region-state').innerText(),/Impossible/);await page.unroute('**/api/world-map');await page.locator('.region-state button').click();await mapReady();await page.locator('.region-close').click();
 await page.goto(base+'/colosseum',{waitUntil:'networkidle'});await page.locator('[data-colosseum-start]:enabled').click();await page.locator('[data-starter-choice]').first().click();await page.locator('.starter-backdrop').waitFor({state:'hidden'});await ready();await menu('minimap');await mapReady();assert.equal(await page.locator('[data-current-marker]').count(),1);
 await page.emulateMedia({reducedMotion:'reduce'});assert(await page.locator('.region-panel').isVisible());assert.deepEqual(errors,[]);success=true;
 console.log(JSON.stringify({viewports:3,realAuthenticatedMap:true,hiddenUnknownHabitats:true,fishing:true,evolution:true,unavailable:true,filtersAndFocusRestored:true,centreReload:true,desktopKeyboard:true,retry:true,colosseum:true,errors,output}));
}finally{if(!success&&page)await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});await browser?.close();cleanup();await new Promise(r=>io.close(r));await new Promise(r=>setTimeout(r,250));if(user)await dbPool.execute('DELETE FROM users WHERE id=?',[user.user.id]);await dbPool.end();}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
