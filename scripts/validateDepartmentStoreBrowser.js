// Root-domain API, deep links and both Socket.IO namespaces. Test DB only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const{once}=require('node:events'),{randomUUID}=require('node:crypto');
if(!/test/i.test(process.env.DB_TEST_NAME||''))throw Error('Dedicated test database required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';
const express=require('express'),{Server}=require('socket.io'),{chromium}=require('playwright'),{dbPool}=require('../server/config/database');
const dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-commercial-dist',output=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-commercial-browser';fs.mkdirSync(output,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server);app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
const store=require('../server/game/drift/lobbyStore').createLobbyStore(),cleanup=require('../server/realtime/driftLobbyHandler').registerDriftLobbies(io,{store,checkpointRepository:{async save(){}},runtimeOptions:{paceMs:0,random:()=>.99}});
let browser,page,base,success=false;const users=[],errors=[],sockets=[],requests=[];
async function create(){const password=randomUUID(),username='root_'+randomUUID(),r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password,starterId:7})});assert.equal(r.status,201);const f=await r.json();f.password=password;users.push(f);return f;}
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(!v?.socket?.connected||v.mapLoading||v.renderedMap!==v.map||!v.players[v.socket.id])return false;window.cityVm=v;return true;});}
async function leave(){if(await page.locator('.game-root').count())await page.evaluate(()=>new Promise(r=>window.cityVm.socket.emit('requestGameSave',()=>{window.cityVm.socket.disconnect();r();})));await page.goto('about:blank');await page.waitForTimeout(250);}
async function locate(a,map,x,y){await leave();await dbPool.execute('UPDATE users SET map=?,x=?,y=?,repel_steps=1000 WHERE id=?',[map,x*32+16,y*32+16,a.user.id]);await page.goto(base+'/game',{waitUntil:'networkidle'});await ready();assert.equal(await page.evaluate(()=>window.cityVm.map),map);}
let lastActionAt=0;
async function step(action,target){const wait=180-(Date.now()-lastActionAt);if(wait>0)await page.waitForTimeout(wait);const old=await page.evaluate(()=>{const v=window.cityVm,p=v.players[v.socket.id];return{x:p.x,y:p.y,map:v.map};});lastActionAt=Date.now();await page.evaluate(a=>window.cityVm.socket.emit('playerAction',a),action);if(target&&target!==old.map){await page.waitForFunction(m=>{const v=window.cityVm;return v.map===m&&!v.mapLoading&&v.renderedMap===m;},target);}else{const d={move_z:[0,-32],move_s:[0,32],move_q:[-32,0],move_d:[32,0]}[action];await page.waitForFunction(({x,y})=>{const v=window.cityVm,p=v.players[v.socket.id];return p.x===x&&p.y===y&&!v.mapLoading;},{x:old.x+d[0],y:old.y+d[1]});}}
let heldStairChecks=0;
async function useStairs(target,held=false){
 const source=await page.evaluate(()=>window.cityVm.map);
 await step('move_z');assert.equal(await page.evaluate(()=>window.cityVm.map),source,'first step reaches the top of the stairs without changing floor');
 if(!held){await step('move_z',target);return;}
 await page.setViewportSize({width:393,height:852});await page.evaluate(async()=>{window.cityVm.showMobileControls=true;await window.cityVm.$nextTick();window.cityVm.resizeWorldViewport();});
 await page.evaluate(()=>{const v=window.cityVm;v._stairsMapEvents=[];v._stairsProbe=payload=>v._stairsMapEvents.push(payload.mapname);v.socket.on('newmap',v._stairsProbe);});
 const box=await page.locator('.mobile-dpad-up').boundingBox();assert(box);await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
 try{
  await page.waitForFunction(m=>{const v=window.cityVm;return v.map===m&&!v.mapLoading&&v.renderedMap===m;},target);
  await page.waitForTimeout(950);
  assert.equal(await page.evaluate(()=>window.cityVm.map),target,'held Up cannot bounce back to the previous floor');
  assert.deepEqual(await page.evaluate(()=>window.cityVm._stairsMapEvents),[target],'one intentional staircase crossing, no reverse transition');heldStairChecks++;
 }finally{await page.mouse.up();await page.evaluate(()=>{const v=window.cityVm;v.socket.off('newmap',v._stairsProbe);delete v._stairsProbe;});}
}
async function walkTo(tx,ty){const p=await page.evaluate(()=>{const v=window.cityVm,p=v.players[v.socket.id];return{map:v.map,x:Math.floor(p.x/32),y:Math.floor(p.y/32),pnjs:v.pnjs};}),maps=require('../server/game/world/mapRepository'),c=maps.loadCollisionData(p.map),changes=maps.changeMapData(p.map),q=[[p.x,p.y,[]]],seen=new Set();let route;while(q.length){const[x,y,path]=q.shift(),k=x+':'+y;if(seen.has(k)||c[y]?.[x]!==0||p.pnjs.some(n=>n.x===x&&(n.y===y||n.y-1===y)))continue;seen.add(k);if(x===tx&&y===ty){route=path;break;}if(changes[y]?.[x]&&path.length)continue;for(const[dx,dy,a]of[[1,0,'move_d'],[-1,0,'move_q'],[0,1,'move_s'],[0,-1,'move_z']])q.push([x+dx,y+dy,[...path,a]]);}assert(route,'walkable route '+p.map+' '+tx+','+ty);for(const action of route)await step(action);return route.length;}
async function capture(label){for(const[width,height]of [[320,568],[393,852],[844,390],[1365,900]]){await page.setViewportSize({width,height});await page.waitForTimeout(100);await page.evaluate(async w=>{window.cityVm.showMobileControls=w<=920;await window.cityVm.$nextTick();window.cityVm.resizeWorldViewport();},width);await page.waitForTimeout(100);assert(await page.evaluate(()=>{const v=window.cityVm;return v.mapImage.complete&&v.foregroundImage.complete&&v.mapImage.naturalWidth===448&&document.documentElement.scrollWidth<=innerWidth+1;}));await page.screenshot({path:path.join(output,label+'-'+width+'.png')});}}

const floors=['tour_rdc','tour_etage1','tour_etage2','tour_etage3'];
async function furniturePerimeter(){
 const edges=[[8,5,'move_s'],[6,7,'move_d'],[8,9,'move_z'],[14,5,'move_s'],[16,7,'move_q'],[14,9,'move_z'],[19,6,'move_s'],[17,8,'move_d'],[19,10,'move_z'],[3,10,'move_s'],[5,12,'move_q'],[3,14,'move_z'],[24,10,'move_s'],[22,12,'move_d'],[24,14,'move_z']];
 for(const[x,y,action]of edges){await walkTo(x,y);await page.waitForTimeout(200);await page.evaluate(a=>window.cityVm.socket.emit('playerAction',a),action);lastActionAt=Date.now();await page.waitForTimeout(220);assert.deepEqual(await page.evaluate(()=>{const v=window.cityVm,p=v.players[v.socket.id];return[Math.floor(p.x/32),Math.floor(p.y/32)];}),[x,y],'solid furniture: '+x+','+y);}
 await walkTo(8,5);
}

async function command(event,data){return page.evaluate(({event,data})=>new Promise((resolve,reject)=>{const ack=(e,r)=>e?reject(e):resolve(r),s=window.cityVm.socket.timeout(8000);if(data===undefined)s.emit(event,ack);else s.emit(event,data,ack);}),{event,data});}
async function counter(number){
 await walkTo(11,9);await page.evaluate(()=>window.cityVm.triggerMobileActionA());await page.waitForFunction(()=>window.cityVm.textImageSequence.length>0);
 for(let n=0;n<8&&!await page.evaluate(()=>window.cityVm.shop.visible);n++){await page.evaluate(()=>window.cityVm.triggerMobileActionA());await page.waitForTimeout(120);}
 await page.waitForFunction(()=>!window.cityVm.shop.loading);if(await page.locator('[data-training-task="vitamins"]').count())await page.locator('[data-training-task="vitamins"]').click();await page.locator('.shop-item').first().waitFor();assert.equal(await page.evaluate(()=>window.cityVm.shop.metadata.department),number);assert.equal(await page.locator('.department-directory li').count(),4);assert.equal(await page.locator('.department-directory [aria-current]').count(),1);if(number>1)assert.equal(await page.locator('[data-shop-category="drifts"]').count(),0);
}
async function buy(key,quantity=1){const item=await page.evaluate(key=>window.cityVm.shop.catalog.find(i=>i.key===key),key);assert(item,key);await page.getByRole('searchbox').fill(item.name);const row=page.locator(`[data-shop-item="${key}"]`),before=await page.evaluate(key=>window.cityVm.bagItems.find(i=>i.key===key)?.quantity||0,key),money=await page.evaluate(()=>window.cityVm.shop.money);await row.locator('select').selectOption(String(quantity));await row.locator('button').click();await page.waitForFunction(({key,before,quantity})=>!window.cityVm.shop.loading&&window.cityVm.bagItems.some(i=>i.key===key&&i.quantity===before+quantity),{key,before,quantity});assert.equal(await page.evaluate(()=>window.cityVm.shop.money),money-item.price*quantity);await page.getByRole('searchbox').fill('');}
async function counterViews(number){for(const[width,height]of[[320,480],[393,852],[844,390],[1365,900]]){await page.setViewportSize({width,height});await page.waitForTimeout(100);for(const mode of['light','dark']){await page.evaluate(mode=>window.cityVm.updatePreferences({...window.cityVm.preferences,themeMode:mode}),mode);await page.waitForTimeout(60);if(String(number).startsWith('locked-'))await page.locator('.shop-unlock').first().scrollIntoViewIfNeeded();const b=await page.locator('.shop-card').boundingBox();assert(b.x>=0&&b.y>=0&&b.x+b.width<=width+1&&b.y+b.height<=height+1,JSON.stringify(b));assert(await page.locator('.shop-list').evaluate(n=>n.scrollWidth<=n.clientWidth+1&&n.clientHeight>40));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(output,`counter-${number}-${mode}-${width}.png`)});}}await page.evaluate(()=>window.cityVm.updatePreferences({...window.cityVm.preferences,themeMode:'light'}));}
async function closeShop(){await page.keyboard.press('Escape');await page.locator('.shop-card').waitFor({state:'hidden'});}
async function lockedAscent(){
 const keys=['hyperball','iv_randomizer_attack','choice_scarf','leppa_berry'];
 for(let i=0;i<4;i++){
  await counter(i+1);
  const item=await page.evaluate(key=>window.cityVm.shop.catalog.find(i=>i.key===key),keys[i]);
  assert.equal(item.locked,true);await page.getByRole('searchbox').fill(item.name);
  const row=page.locator(`[data-shop-item="${item.key}"]`);
  assert(await row.locator('button').isDisabled());assert(await row.locator('select').isDisabled());
  assert((await row.locator('.shop-unlock').innerText()).includes(item.unlockLabel));
  assert.equal((await command('buyShopItem',{itemKey:item.key,quantity:1,flags:{wanda_defeated:'true'},expedition:true,price:1})).reason,'badge_required');
  await counterViews('locked-'+(i+1));await closeShop();
  if(i<3){await walkTo(24,5);await useStairs(floors[i+1]);}
 }
 for(let i=3;i>0;i--){await walkTo(3,5);await useStairs(floors[i-1]);}
}
async function ascent(prefix,views=false){const keys=['max_repel','iv_randomizer_attack','choice_scarf','leppa_berry'];for(let i=0;i<4;i++){assert.equal(await page.evaluate(()=>window.cityVm.map),floors[i]);if(views)await capture(prefix+floors[i]);await counter(i+1);assert(await page.evaluate(()=>window.cityVm.shop.catalog.every(item=>!item.locked)));if(views)await counterViews(i+1);await buy(keys[i],i===3?5:1);await closeShop();if(i<3){await walkTo(24,5);await useStairs(floors[i+1],true);}}for(let i=3;i>0;i--){await walkTo(3,5);await useStairs(floors[i-1],true);}await walkTo(13,16);await step('move_s','ville_commerciale');}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}`;const a=await create(),b=await create();await dbPool.execute('UPDATE users SET money=100000 WHERE id=?',[a.user.id]);
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true});await context.addInitScript(s=>{if(location.protocol==='http:')localStorage.setItem('explorakit.user',JSON.stringify(s));},{...a.user,token:a.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().startsWith(base)&&r.status()>=400)errors.push(r.status()+' '+r.url());});
 if(process.env.RELEASE_FURNITURE_ONLY==='1'){
  await locate(a,'tour_rdc',13,16);
  for(let i=0;i<floors.length;i++){
   await counter(i+1);await closeShop();await furniturePerimeter();await capture('compact-'+floors[i]);
   if(i<3){await walkTo(24,5);await useStairs(floors[i+1]);}
  }
  for(let i=3;i>0;i--){await walkTo(3,5);await useStairs(floors[i-1]);}
  await walkTo(13,16);await step('move_s','ville_commerciale');
  assert.deepEqual(errors,[]);success=true;console.log(JSON.stringify({floors:4,blockedFurnitureEdges:60,realWalking:true,saleswomen:true,allStairsBothDirections:true,exit:true,viewports:4,errors,output}));return;
 }
 await locate(a,'route6',1,17);await step('move_q','ville_commerciale');await capture('city');await walkTo(4,9);await step('move_z','centre');await step('move_s','ville_commerciale');assert.deepEqual(await page.evaluate(()=>{const v=window.cityVm,p=v.players[v.socket.id];return[p.x,p.y];}),[144,304]);await walkTo(13,12);await step('move_z','tour_rdc');
 assert.equal((await command('buyShopItem',{itemKey:'choice_scarf',quantity:1,mapName:'tour_etage2',price:1})).reason,'item_unavailable');await lockedAscent();await dbPool.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,'hoze_defeated','true')",[a.user.id]);await ascent('adventure-',true);
 await walkTo(26,17);await step('move_d','route6');await page.reload({waitUntil:'networkidle'});await ready();assert.equal(await page.evaluate(()=>window.cityVm.map),'route6');const inventory=await require('../server/persistence/itemRepository').loadUserItems(a.user.id);for(const key of['max_repel','iv_randomizer_attack','choice_scarf','leppa_berry'])assert(inventory.some(i=>i.key===key&&i.quantity>0));const adventureItems=JSON.stringify(inventory);
 const factory=require('../server/game/drift/pokemonFactory');await page.goto(base+'/colosseum',{waitUntil:'networkidle'});await page.locator('[data-colosseum-start]:enabled').click();await page.locator('[data-starter-choice]').first().click();await page.locator('.starter-backdrop').waitFor({state:'hidden'});let p=cleanup.runtime.playerFor(a.user);Object.assign(p,{currentmap:'route6',x:48,y:560,repelSteps:1000,money:100000,equipe:{pokemons:[factory.create(9,100,true)]}});await page.reload({waitUntil:'networkidle'});await ready();await step('move_q','ville_commerciale');await walkTo(13,12);await step('move_z','tour_rdc');await ascent('colosseum-');assert.equal(p.items.choice_scarf,1);assert.equal(p.items.leppa_berry,5);assert.equal(JSON.stringify(await require('../server/persistence/itemRepository').loadUserItems(a.user.id)),adventureItems);await page.evaluate(()=>window.cityVm.leaveDrift());await page.locator('[data-colosseum-lobby]').waitFor();
 store.connect(a.user,'store-host');store.connect(b.user,'store-guest');const lobby=store.create(a.user,{capacity:2,durationMinutes:30});store.join(b.user,lobby.code);for(const f of[a,b])store.ready(f.user,true);await cleanup.runtime.start(a.user);for(const f of[a,b]){p=cleanup.runtime.playerFor(f.user);cleanup.runtime.chooseStarter(p,p.starterChoices[0].uuid);Object.assign(p,{currentmap:'route6',x:48,y:560,repelSteps:1000,money:100000,equipe:{pokemons:[factory.create(9,100,true)]}});}await page.goto(base+'/drift/game',{waitUntil:'networkidle'});await ready();await step('move_q','ville_commerciale');await walkTo(13,12);await step('move_z','tour_rdc');await ascent('rift-');assert.equal(cleanup.runtime.playerFor(a.user).items.choice_scarf,1);assert.equal(JSON.stringify(await require('../server/persistence/itemRepository').loadUserItems(a.user.id)),adventureItems);
 assert.deepEqual(errors,[]);success=true;console.log(JSON.stringify({heldStairChecks,noBounceWhileHeld:true,deeperStairEntry:true,allStairsBothDirections:true,realWalking:true,cityRouteBothDirections:true,centerReturn:true,saleswomenDialogue:true,departments:4,actualPurchases:true,badgeLocksFourFloors:true,earnedBadgeUnlocks:true,spoofedUnlocksRejected:true,spoofedDepartmentRejected:true,sqlReload:true,expeditionInventorySeparate:true,viewports:4,themes:2,modes:['adventure','rift','colosseum'],errors,output}));
}finally{if(!success&&page)await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});await browser?.close();cleanup();await new Promise(r=>io.close(r));await new Promise(r=>setTimeout(r,250));for(const f of users)await dbPool.execute('DELETE FROM users WHERE id=?',[f.user.id]);await dbPool.end();}})().catch(e=>{console.error(e.stack);process.exitCode=1});
