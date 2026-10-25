// Real movement and isolated fixtures: never exposes fixture commands in production.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(!/test/i.test(process.env.DB_TEST_NAME||''))throw Error('Dedicated test database required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';
const express=require('express'),{Server}=require('socket.io'),{chromium}=require('playwright');
const {dbPool}=require('../server/config/database');
const dist=process.env.RELEASE_DIST_DIR||'/tmp/explorakit-valpierre-dist',output=process.env.RELEASE_SCREENSHOTS||'/tmp/explorakit-valpierre-browser';fs.mkdirSync(output,{recursive:true});
const mount=process.env.RELEASE_PUBLIC_PATH||'/explorakit/';
const app=express(),server=http.createServer(app),io=new Server(server,{path:mount+'socket.io'});
app.use(express.json());app.use(mount+'api',require('../server/http/routes'));app.use(mount,express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));
io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
const cleanup=require('../server/realtime/driftLobbyHandler').registerDriftLobbies(io);
let browser,page,userId,base,success=false;const errors=[];
async function ready(){await page.waitForFunction(()=>{const vm=document.querySelector('.game-root')?.__vue__;if(!vm?.socket?.connected||!vm.players[vm.socket.id]||vm.mapLoading)return false;window.cityVm=vm;return true;});}
async function locate(map,x,y){
 if(await page.locator('.game-root').count())await page.evaluate(()=>new Promise((resolve,reject)=>{const vm=window.cityVm;vm.socket.timeout(5000).emit('requestGameSave',(err,r)=>{if(err||!r?.success)return reject(Error('save'));vm.socket.disconnect();resolve();});}));
 await page.goto('about:blank');await dbPool.execute('UPDATE users SET map=?,x=?,y=? WHERE id=?',[map,x*32+16,y*32+16,userId]);await page.goto(base+'/game',{waitUntil:'networkidle'});await ready();
}
async function step(action,map){await page.evaluate(action=>window.cityVm.socket.emit('playerAction',action),action);await page.waitForFunction(map=>window.cityVm.map===map&&!window.cityVm.mapLoading,map);}
async function scenery(label){
 await page.evaluate(async()=>{const vm=window.cityVm;vm.battle=true;await vm.$nextTick();const own=JSON.parse(JSON.stringify(vm.teamPokemons[0]));const enemy={...own,uuid:'scenery-only',data:{...own.data,id:75}};vm.$refs.battleOverlay.updateBattleState({player:{equipe:{pokemons:[own]}},wildPokemon:enemy});vm.$refs.battleOverlay.requestAction();});
 await page.locator('.battle-cave').waitFor();
 for(const [width,height]of [[320,480],[393,852],[844,390],[1365,900]]){
  await page.setViewportSize({width,height});await page.evaluate(async width=>{window.cityVm.showMobileControls=width<=920;await window.cityVm.$nextTick();await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);},width);await page.waitForFunction(()=>[...document.querySelectorAll('.battle-sprite-anchor')].length===2&&[...document.querySelectorAll('.battle-sprite-anchor')].every(e=>e.querySelector('.battle-sprite-ready')));
  const result=await page.evaluate(()=>{const vm=window.cityVm,b=vm.$refs.battleOverlay,scene=document.querySelector('.battle-scene').getBoundingClientRect();const out={};for(const side of ['wild']){const a=document.querySelector('.battle-sprite-'+side).getBoundingClientRect(),p=document.querySelector('[data-battle-platform="'+side+'"]').getBoundingClientRect(),disc=document.querySelector('[data-battle-platform="'+side+'"] .cave-disc').getBoundingClientRect();out[side]={dx:a.left-p.left,dy:a.top-p.top,disc:disc.width,groundInside:disc.top<scene.bottom&&disc.bottom>scene.top};}return {environment:b.environment,src:document.querySelector('.battle-background').currentSrc,width:document.documentElement.scrollWidth,viewport:innerWidth,anchors:out};});
  assert.equal(result.environment,'cave');assert.match(result.src,/cave-(mobile|wide)-v1/);assert(result.width<=result.viewport+1);for(const a of Object.values(result.anchors)){assert(Math.abs(a.dx)<1&&Math.abs(a.dy)<1&&a.disc>0&&a.groundInside);}
  await page.screenshot({path:path.join(output,`${label}-${width}.png`)});
 }
 // A relocation during a finishing turn must not replace the original battle scenery.
 assert.equal(await page.evaluate(()=>{window.cityVm.map='route4';return window.cityVm.$refs.battleOverlay.environment;}),'cave');
 await page.evaluate(()=>{const b=window.cityVm.$refs.battleOverlay;b.challenge={wave:1,difficulty:{label:'Test'}};});await page.locator('.battle-colosseum').waitFor();assert.equal(await page.locator('[data-battle-environment="cave"]').count(),0);
 await page.evaluate(()=>{window.cityVm.battle=false;});
}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}${mount.replace(/\/$/,'')}`;
 const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'city_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(r.status,201);const fixture=await r.json();userId=fixture.user.id;
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true});await context.addInitScript(s=>{if(location.protocol==='http:'||location.protocol==='https:')localStorage.setItem('explorakit.user',JSON.stringify(s));},{...fixture.user,token:fixture.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().startsWith(base)&&r.status()>=400)errors.push(r.status()+' '+r.url());});
 await locate('route4',26,4);await step('move_d','ville_safe1');await page.locator('.location-name').filter({hasText:'Valpierre'}).waitFor();
 for(const [width,height]of [[320,480],[393,852],[844,390],[1365,900]]){await page.setViewportSize({width,height});assert(await page.evaluate(()=>window.cityVm.mapImage.naturalWidth===448&&window.cityVm.foregroundImage.naturalWidth===448&&document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(output,`city-${width}.png`)});}
 await page.waitForTimeout(180);await step('move_q','route4');
 for(const [x,y,map]of [[14,15,'ville_safe1_arene'],[22,15,'ville_safe1_shop'],[4,5,'ville_safe1_maison1'],[23,5,'ville_safe1_maison2']]){await locate('ville_safe1',x,y+1);await step('move_z',map);if(map.endsWith('_shop')){await page.locator('.location-shop-btn').click();await page.locator('.shop-item').first().waitFor();await page.locator('.shop-close').click();}await page.waitForTimeout(150);await step('move_s','ville_safe1');const tile=await page.evaluate(()=>{const v=window.cityVm,p=v.players[v.socket.id];return [Math.floor(p.x/32),Math.floor(p.y/32)];});assert.deepEqual(tile,[x,y+1]);}
 // The new gym facade and the lake remain solid.
 await locate('ville_safe1',10,14);await page.evaluate(()=>window.cityVm.socket.emit('playerAction','move_d'));await page.waitForTimeout(180);
 assert.deepEqual(await page.evaluate(()=>{const v=window.cityVm,p=v.players[v.socket.id];return [Math.floor(p.x/32),Math.floor(p.y/32)];}),[10,14]);
 // Water remains blocked; the central paved square stays walkable.
 await locate('ville_safe1',1,11);await page.evaluate(()=>window.cityVm.socket.emit('playerAction','move_d'));await page.waitForTimeout(180);
 assert.deepEqual(await page.evaluate(()=>{const v=window.cityVm,p=v.players[v.socket.id];return [Math.floor(p.x/32),Math.floor(p.y/32)];}),[1,11]);
 await locate('ville_safe1',5,7);await page.evaluate(()=>window.cityVm.socket.emit('playerAction','move_s'));await page.waitForFunction(()=>{const v=window.cityVm,p=v.players[v.socket.id];return p.x===176&&p.y===272;});
 // Force the encounter roll only in this isolated Node test process. The author
 // paved city has no wild pool: it must not open an empty combat overlay.
 await locate('ville_safe1',16,17);const originalRandom=Math.random;
 try{Math.random=()=>0;await page.evaluate(()=>window.cityVm.socket.emit('playerAction','move_s'));await page.waitForFunction(()=>{const v=window.cityVm,p=v.players[v.socket.id];return p.x===528&&p.y===592;});await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>window.cityVm.battle),false);}finally{Math.random=originalRandom;}
 await locate('cave1',10,10);await scenery('adventure-cave');
 await page.goto(base+'/colosseum',{waitUntil:'networkidle'});await page.locator('[data-colosseum-start]:enabled').click();await page.locator('[data-starter-choice]').first().click();await page.locator('.starter-backdrop').waitFor({state:'hidden'});const player=cleanup.runtime.playerFor(fixture.user);player.currentmap='cave2';player.x=336;player.y=336;await page.reload({waitUntil:'networkidle'});await ready();await scenery('expedition-cave');
 assert.deepEqual(errors,[]);success=true;console.log(JSON.stringify({authorCollisionAndEmptyEncounter:true,route4EastAndReturn:true,doorsAndReturns:4,shop:true,originalArtAndForeground:true,sceneryModes:['adventure','colosseum exploration'],viewports:4,alignedPlatforms:true,frozenDuringTravel:true,colosseumPriority:true,errors,output}));
}finally{if(!success&&page)await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});await browser?.close();cleanup();await new Promise(r=>io.close(r));if(userId)await dbPool.execute('DELETE FROM users WHERE id=?',[userId]);await dbPool.end();}})().catch(e=>{console.error(e.stack);process.exitCode=1});
