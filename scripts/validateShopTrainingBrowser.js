// Real shop/medicine RPCs and SQL on disposable accounts in an isolated server.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(!/test/i.test(process.env.DB_TEST_NAME||''))throw Error('Dedicated test database required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';process.env.BATTLE_DELAY_SCALE='0';
const express=require('express'),{Server}=require('socket.io'),{chromium}=require('playwright');
const {dbPool}=require('../server/config/database'),repo=require('../server/persistence/teamRepository');
const dist=process.env.RELEASE_DIST_DIR||'/tmp/explorakit-shop-training-dist',output=process.env.RELEASE_SCREENSHOTS||'/tmp/explorakit-shop-training-browser';fs.mkdirSync(output,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server,{path:'/explorakit/socket.io'});
app.use(express.json());app.use('/explorakit/api',require('../server/http/routes'));app.use('/explorakit',express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));
io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
const cleanup=require('../server/realtime/driftLobbyHandler').registerDriftLobbies(io,{checkpointRepository:{async save(){}},runtimeOptions:{random:()=>.9,paceMs:0}});
let browser,page,userId,base,success=false;const errors=[];
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(!v?.socket?.connected||!v.players[v.socket.id]||v.mapLoading||v.renderedMap!==v.map)return false;window.shopVm=v;return true;});}
async function command(event,data){return page.evaluate(({event,data})=>new Promise((resolve,reject)=>{const ack=(e,r)=>e?reject(e):resolve(r),s=window.shopVm.socket.timeout(8000);if(data===undefined)s.emit(event,ack);else s.emit(event,data,ack);}),{event,data});}
async function leave(){if(await page.locator('.game-root').count()){assert((await command('requestGameSave')).success);await page.evaluate(()=>window.shopVm.socket.disconnect());}await page.goto('about:blank');await page.waitForTimeout(250);}
async function locate(map){await leave();await dbPool.execute('UPDATE users SET map=?,x=432,y=464 WHERE id=?',[map,userId]);await page.goto(base+'/game',{waitUntil:'networkidle'});await ready();}
async function shop(){await page.locator('.location-shop-btn').click();await page.locator('.shop-item').first().waitFor();await page.waitForFunction(()=>!window.shopVm.shop.loading);}
async function buy(key,quantity=1){const row=page.locator(`[data-shop-item="${key}"]`);await row.locator('select').selectOption(String(quantity));const before=await page.evaluate(key=>window.shopVm.bagItems.find(i=>i.key===key)?.quantity||0,key);await row.locator('button').click();await page.waitForFunction(({key,before,quantity})=>!window.shopVm.shop.loading&&window.shopVm.bagItems.some(i=>i.key===key&&i.quantity===before+quantity),{key,before,quantity});}
async function use(key,uuid,quantity=1){const row=page.locator(`[data-item-key="${key}"]`);if(await row.locator('.bag-item-select').getAttribute('aria-expanded')!=='true')await row.locator('.bag-item-select').click();await row.locator('[data-medicine-target]').selectOption(uuid);if(quantity>1)await row.locator('[data-medicine-quantity]').selectOption(String(quantity));await row.locator('.bag-use-button:enabled').click();await page.waitForFunction(()=>!window.shopVm.medicineBusy);assert.equal(await page.locator('.pack-error').count(),0);}
async function views(){for(const [width,height]of [[320,480],[393,852],[844,390],[1365,900]]){
 await page.setViewportSize({width,height});await page.waitForTimeout(250);await page.evaluate(width=>{window.shopVm.showMobileControls=width<=920;},width);await page.waitForTimeout(80);
 for(const themeMode of ['light','dark']){await page.evaluate(themeMode=>window.shopVm.updatePreferences({...window.shopVm.preferences,themeMode}),themeMode);
  const box=await page.locator('.shop-card').boundingBox();assert(box.x>=0&&box.y>=0&&box.x+box.width<=width+1&&box.y+box.height<=height+1,JSON.stringify({width,height,box}));
  assert(await page.locator('.shop-card').evaluate(n=>n.scrollWidth<=n.clientWidth+1));
  assert(await page.locator('.shop-list').evaluate(n=>n.scrollWidth<=n.clientWidth+1));
  for(const tab of await page.locator('[data-shop-category]').all())assert((await tab.boundingBox()).height>=44);
  await page.locator('[data-shop-item="zinc"] button').scrollIntoViewIfNeeded();assert(await page.locator('[data-shop-item="zinc"] button').isVisible());
  await page.screenshot({path:path.join(output,`shop-training-${themeMode}-${width}.png`)});
 }
}await page.setViewportSize({width:393,height:852});await page.waitForTimeout(250);await page.evaluate(()=>window.shopVm.updatePreferences({...window.shopVm.preferences,themeMode:'light'}));}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}/explorakit`;
 const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'shop_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(r.status,201);const fixture=await r.json();userId=fixture.user.id;
 await dbPool.execute('UPDATE users SET money=100000 WHERE id=?',[userId]);
 const team=await repo.loadEquipe(userId),lead=team.pokemons[0];lead.iv.attack=5;lead.ev.attack=247;lead.ev.defense=20;lead.recalculateStats();await repo.editEquipe(userId,team);
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true});await context.addInitScript(s=>{if(location.protocol==='http:'||location.protocol==='https:')localStorage.setItem('explorakit.user',JSON.stringify(s));},{...fixture.user,token:fixture.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().startsWith(base)&&r.status()>=400)errors.push(r.status()+' '+r.url());});
 await locate('ville1_shop');await shop();assert.equal(await page.locator('[data-shop-item="pokeball"]').count(),1);assert.equal(await page.locator('[data-shop-item="hyperball"]').count(),0);
 assert.equal((await command('buyShopItem',{itemKey:'iv_randomizer_attack',quantity:1,mapName:'ville5_shop',tier:5,price:1})).reason,'item_unavailable');await buy('pokeball');await page.keyboard.press('Escape');await page.waitForFunction(()=>document.querySelector('.location-shop-btn')===document.activeElement);
 await locate('ville5_shop');await shop();await page.locator('[data-shop-category="training"]').click();assert.match(await page.locator('.shop-empty').innerText(),/Wanda/);await page.keyboard.press('Escape');await leave();
 await dbPool.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,'wanda_defeated','true')",[userId]);await page.goto(base+'/game',{waitUntil:'networkidle'});await ready();await shop();
 const catalog=await command('requestShop');assert(catalog.shopMeta.trainingAvailable);assert.equal(catalog.catalog.filter(i=>i.fieldUse?.ivReroll).length,6);assert.equal(catalog.catalog.filter(i=>i.fieldUse?.effortReset).length,7);
 await page.locator('[data-shop-category="training"]').click();assert.equal(await page.locator('.shop-item').count(),6);await views();
 await buy('protein',25);await buy('zinc',5);await page.locator('[data-training-filter="iv"]').click();await buy('iv_randomizer_attack',5);await page.locator('[data-training-filter="ev"]').click();await buy('ev_reset_all');
 const search=page.getByRole('searchbox');await search.fill('Pierre Foudre');assert.equal(await page.locator('.shop-item').count(),1);assert.equal(await page.locator('[data-shop-item="thunder_stone"]').count(),1);await search.fill('');
 await page.locator('[data-shop-category="balls"]').focus();await page.keyboard.press('ArrowRight');assert.equal(await page.locator('[data-shop-category="medicine"]').getAttribute('aria-selected'),'true');await page.keyboard.press('End');assert.equal(await page.locator('[data-shop-category="training"]').getAttribute('aria-selected'),'true');
 await page.locator('.shop-close').focus();await page.keyboard.press('Shift+Tab');assert(await page.locator('.shop-card').evaluate(n=>n.contains(document.activeElement)));await page.keyboard.press('Tab');assert(await page.locator('.shop-close').evaluate(n=>n===document.activeElement));await page.keyboard.press('Escape');
 await page.locator('.menu-toggle-btn').click();await page.locator('[data-menu-action="bag"]').click();await page.locator('[data-bag-pocket="training"]').click();await use('protein',lead.uuid,25);
 let saved=(await repo.loadEquipe(userId)).pokemons[0];assert.equal(saved.ev.attack,252);assert.equal(await page.evaluate(()=>window.shopVm.bagItems.find(i=>i.key==='protein').quantity),24);assert.match(await page.locator('.pack-notice').innerText(),/1 vitamine/);
 await use('iv_randomizer_attack',lead.uuid);saved=(await repo.loadEquipe(userId)).pokemons[0];assert(saved.iv.attack>=0&&saved.iv.attack<=31);assert.equal(saved.k,lead.k);assert.match(await page.locator('.pack-notice').innerText(),/tirage/);
 await use('ev_reset_all',lead.uuid);assert(Object.values((await repo.loadEquipe(userId)).pokemons[0].ev).every(n=>n===0));await use('zinc',lead.uuid,5);assert.equal((await repo.loadEquipe(userId)).pokemons[0].ev.specialDefense,50);
 await page.keyboard.press('Escape');await page.reload({waitUntil:'networkidle'});await ready();assert.equal(await page.evaluate(()=>window.shopVm.teamPokemons[0].ev.specialDefense),50);
 // Existing expedition merchant and stock remain session-local.
 await page.goto(base+'/colosseum',{waitUntil:'networkidle'});await page.locator('[data-colosseum-start]:enabled').click();await page.locator('[data-starter-choice]').first().click();await page.locator('.starter-backdrop').waitFor({state:'hidden'});await ready();
 const p=cleanup.runtime.playerFor(fixture.user);p.currentmap='ville5_shop';p.money=10000;p.items.zinc=5;p.equipe.pokemons[0].ev.specialDefense=0;p.equipe.pokemons[0].recalculateStats();
 await page.reload({waitUntil:'networkidle'});await ready();await shop();await page.locator('[data-shop-category="drifts"]').click();await page.locator('[data-merchant-offer]').first().waitFor();await page.locator('.shop-close').click();
 p.run.phase='colosseum_ready';await page.locator('.menu-toggle-btn').click();await page.locator('[data-menu-action="bag"]').click();await page.locator('[data-bag-pocket="training"]').click();await use('zinc',p.equipe.pokemons[0].uuid,5);assert.equal(p.equipe.pokemons[0].ev.specialDefense,50);assert.equal(p.items.zinc,0);assert.equal((await repo.loadEquipe(userId)).pokemons[0].ev.specialDefense,50,'Adventure unchanged');
 assert.deepEqual(errors,[]);success=true;console.log(JSON.stringify({progressionAndSpoofRefused:true,snowSpecialty:true,trainingItems:19,realPurchasesAndSqlReceipts:true,bulkOnlyUseful:true,ivRerollMayDecrease:true,evResetAndPersistence:true,keyboardAndFocus:true,viewports:4,themes:2,expeditionMerchantAndTraining:true,errors,output}));
}finally{if(!success&&page)await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});await browser?.close();await new Promise(r=>setTimeout(r,400));cleanup();await new Promise(r=>io.close(r));if(userId)await dbPool.execute('DELETE FROM users WHERE id=?',[userId]);await dbPool.end();}})().catch(e=>{console.error(e.stack);process.exitCode=1});
