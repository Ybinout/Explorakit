// Real shop/medicine RPCs and SQL on disposable accounts in an isolated server.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(!/test/i.test(process.env.DB_TEST_NAME||''))throw Error('Dedicated test database required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';process.env.BATTLE_DELAY_SCALE='0';
const express=require('express'),{Server}=require('socket.io'),{chromium}=require('playwright');
const {dbPool}=require('../server/config/database'),repo=require('../server/persistence/teamRepository');
const dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-machines-dist',output=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-machines-browser';fs.mkdirSync(output,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server);
app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));
io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
const cleanup=require('../server/realtime/driftLobbyHandler').registerDriftLobbies(io,{checkpointRepository:{async save(){}},runtimeOptions:{random:()=>.9,paceMs:0}});
let browser,page,userId,base,success=false;const errors=[];
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(!v?.socket?.connected||!v.players[v.socket.id]||v.mapLoading||v.renderedMap!==v.map)return false;window.shopVm=v;return true;});}
async function command(event,data){return page.evaluate(({event,data})=>new Promise((resolve,reject)=>{const ack=(e,r)=>e?reject(e):resolve(r),s=window.shopVm.socket.timeout(8000);if(data===undefined)s.emit(event,ack);else s.emit(event,data,ack);}),{event,data});}
async function leave(){if(await page.locator('.game-root').count()){assert((await command('requestGameSave')).success);await page.evaluate(()=>window.shopVm.socket.disconnect());}await page.goto('about:blank');await page.waitForTimeout(250);}
async function locate(map){await leave();await dbPool.execute('UPDATE users SET map=?,x=432,y=464 WHERE id=?',[map,userId]);await page.goto(base+'/game',{waitUntil:'networkidle'});await ready();}
async function shop(){await page.locator('.location-shop-btn').click();await page.locator('.shop-item').first().waitFor();await page.waitForFunction(()=>!window.shopVm.shop.loading);}
async function buy(key,quantity=1){const row=page.locator(`[data-shop-item="${key}"]`);await row.locator('select').selectOption(String(quantity));const before=await page.evaluate(key=>window.shopVm.bagItems.find(i=>i.key===key)?.quantity||0,key);await row.locator('button').click();await page.waitForFunction(({key,before,quantity})=>!window.shopVm.shop.loading&&window.shopVm.bagItems.some(i=>i.key===key&&i.quantity===before+quantity),{key,before,quantity});}
async function openBag(key='cs_surf'){await page.locator('.menu-toggle-btn').click();await page.locator('[data-menu-action="bag"]').click();await page.locator('[data-bag-pocket="machines"]').click();const row=page.locator(`[data-item-key="${key}"]`);await row.locator('.bag-item-select').click();return row;}
async function inspectShopMoves(){
 const definitions=require('../vue-explorakit/src/data/pokemonReference.fr.json').moves,machines=require('../vue-explorakit/src/data/machines.json');
 const cards=await page.locator('[data-shop-item]').evaluateAll(nodes=>nodes.map(n=>({key:n.dataset.shopItem,description:n.querySelector('[data-shop-move-description]')?.textContent.trim(),stats:n.querySelector('[data-shop-move-stats]')?.textContent,power:n.querySelector('[data-shop-move-power]')?.textContent.trim()})));
 assert.equal(cards.length,264);
 for(const card of cards){const move=definitions[machines[card.key].move];assert.equal(card.description,move.description,card.key);assert(card.stats.includes('Puissance')&&card.stats.includes('Précision')&&card.stats.includes('PP'),card.key);}
 for(const [key,power]of Object.entries({cs_surf:'90',cs_fire_punch:'75',cs_protect:'—',cs_seismic_toss:'Variable',cs_dragon_rage:'40 PV'}))assert.equal(cards.find(c=>c.key===key).power,power,key);
 await page.getByRole('searchbox').fill('CS Surf');
 for(const [width,height]of [[320,480],[393,852],[844,390],[1365,900]]){
  await page.setViewportSize({width,height});await page.waitForTimeout(100);
  for(const themeMode of ['light','dark']){await page.evaluate(themeMode=>window.shopVm.updatePreferences({...window.shopVm.preferences,themeMode}),themeMode);
   const row=page.locator('[data-shop-item="cs_surf"]');await row.locator('button').scrollIntoViewIfNeeded();
   for(const selector of ['.shop-card','.shop-list','[data-shop-item="cs_surf"]','[data-shop-move-stats]'])assert(await page.locator(selector).evaluate(n=>n.scrollWidth<=n.clientWidth+1),selector+' '+width);
   const desc=await row.locator('[data-shop-move-description]').boundingBox(),stats=await row.locator('[data-shop-move-stats]').boundingBox(),buy=await row.locator('button').boundingBox();assert(desc.y>=stats.y+stats.height-1);assert(desc.x+desc.width<=buy.x+1||desc.y>=buy.y+buy.height-1||desc.y+desc.height<=buy.y+1);
   await page.screenshot({path:path.join(output,`shop-cs-${themeMode}-${width}.png`)});
  }
 }
 await page.setViewportSize({width:393,height:852});await page.evaluate(()=>window.shopVm.updatePreferences({...window.shopVm.preferences,themeMode:'light'}));await page.getByRole('searchbox').fill('');
}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}`;
 const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'machine_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(r.status,201);const fixture=await r.json();userId=fixture.user.id;
 await dbPool.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,'ana_defeated','true')",[userId]);
 await dbPool.execute('UPDATE users SET money=100000 WHERE id=?',[userId]);
 const team=await repo.loadEquipe(userId),lead=team.pokemons[0];lead.abilities=['Tackle','Tail Whip','Water Gun','Withdraw'];lead.movePp=[2,3,4,5];const incompatible=require('../server/game/drift/pokemonFactory').create(4,5,true);team.pokemons.push(incompatible);await repo.editEquipe(userId,team);
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true});await context.addInitScript(s=>{if(location.protocol==='http:'||location.protocol==='https:')localStorage.setItem('explorakit.user',JSON.stringify(s));},{...fixture.user,token:fixture.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await locate('tour_etage1');await shop();await page.locator('[data-shop-category="machines"]').click();assert.equal(await page.locator('.shop-item').count(),264);await inspectShopMoves();await page.getByLabel('Type des CS').selectOption('Fire');assert(await page.locator('.shop-item').count()>0);assert.equal(await page.locator('[data-shop-item="cs_surf"]').count(),0);await page.getByLabel('Type des CS').selectOption('all');await page.getByRole('searchbox').fill('CS Surf');await buy('cs_surf');await buy('cs_surf');await page.keyboard.press('Escape');
 let row=await openBag();assert(await row.locator(`option[value="${incompatible.uuid}"]`).evaluate(n=>n.disabled));await row.locator('[data-machine-target]').selectOption(lead.uuid);assert(await row.locator('[data-machine-confirm]').isDisabled());
 assert.equal(await row.locator('[data-machine-description]').count(),5);
 for(const text of await row.locator('[data-machine-description]').allTextContents())assert(text.trim().length>15&&!text.includes('indisponible'));
await row.locator('[data-machine-slot="2"]').click();
 for(const [width,height]of [[320,480],[393,852],[1365,900]]){await page.setViewportSize({width,height});await page.waitForTimeout(150);assert(await row.evaluate(n=>n.scrollWidth<=n.clientWidth+1));await row.locator('[data-machine-confirm]').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,`machine-${width}.png`)});}
 await row.getByRole('button',{name:'Annuler',exact:true}).click();assert.equal((await require('../server/persistence/itemRepository').loadUserItems(userId)).find(i=>i.key==='cs_surf').quantity,2);
 await row.locator('[data-machine-target]').selectOption(lead.uuid);await row.locator('[data-machine-slot="2"]').click();await row.locator('[data-machine-confirm]').click();await page.waitForFunction(()=>!window.shopVm.medicineBusy&&window.shopVm.medicineNotice.includes('sauvegardée'));assert.equal(await page.locator('.pack-error').count(),0);
 let saved=(await repo.loadEquipe(userId)).pokemons[0];assert.deepEqual(saved.abilities,['Tackle','Tail Whip','Surf','Withdraw']);assert.deepEqual(saved.movePp,[2,3,15,5]);assert(await row.locator(`option[value="${lead.uuid}"]`).evaluate(n=>n.disabled));
 await page.keyboard.press('Escape');await page.reload({waitUntil:'networkidle'});await ready();assert.equal(await page.evaluate(()=>window.shopVm.teamPokemons[0].abilities[2]),'Surf');
 // Only the evolved Blastoise can learn Liquidation in this generation.
 await leave();const evolved=await repo.loadEquipe(userId);evolved.pokemons[0].updatePokemon(9);evolved.pokemons[0].pendingMoves=[];await repo.editEquipe(userId,evolved);
 // Purchase and teach a newly added move through the actual responsive UI.
 await locate('tour_etage1');await shop();await page.locator('[data-shop-category="machines"]').click();await page.getByRole('searchbox').fill('CS Aqua-Brèche');await buy('cs_liquidation');await page.locator('.shop-close').click();row=await openBag('cs_liquidation');await row.locator('[data-machine-target]').selectOption(lead.uuid);await row.locator('[data-machine-slot="0"]').click();
 for(const [width,height]of [[320,640],[1365,900]]){await page.setViewportSize({width,height});await row.locator('[data-machine-confirm]').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,`liquidation-${width}.png`)});}
 await row.locator('[data-machine-confirm]').click();await page.waitForFunction(()=>!window.shopVm.medicineBusy&&window.shopVm.medicineNotice.includes('sauvegardée'));saved=(await repo.loadEquipe(userId)).pokemons[0];assert.equal(saved.abilities[0],'Liquidation');assert.equal(saved.movePp[0],10);await page.keyboard.press('Escape');
 // Level-up choice: the offered move and all four current attacks expose their effect.
 await page.keyboard.press('Escape');
 await page.evaluate(()=>{const v=window.shopVm;v.teamPokemons[0].pendingMoves=[{move:'Hydro Pump',level:36}];v.learningDeferred=false;v.isBagOpen=false;});
 await page.locator('.learning-sheet').waitFor();assert.equal(await page.locator('[data-learning-description]').count(),5);
 for(const text of await page.locator('[data-learning-description]').allTextContents())assert(text.trim().length>15&&!text.includes('indisponible'));
 for(const [width,height]of [[320,480],[393,852],[1365,900]]){await page.setViewportSize({width,height});assert(await page.locator('.learning-sheet').evaluate(n=>n.scrollWidth<=n.clientWidth+1));await page.screenshot({path:path.join(output,`learning-description-${width}.png`)});}
 await page.locator('.learning-sheet button[aria-label="Choisir plus tard"]').click();
 // Real expedition RPC; inventory must remain separate from Adventure.
 await page.goto(base+'/colosseum',{waitUntil:'networkidle'});await page.locator('[data-colosseum-start]:enabled').click();await page.locator('[data-starter-choice]').first().click();await page.locator('.starter-backdrop').waitFor({state:'hidden'});await ready();
 const p=cleanup.runtime.playerFor(fixture.user);p.currentmap='tour_etage1';p.money=10000;const mon=require('../server/game/drift/pokemonFactory').create(7,10,true);mon.abilities=['Tackle'];mon.movePp=[2];p.equipe.pokemons=[mon];
 await page.reload({waitUntil:'networkidle'});await ready();await shop();await page.locator('[data-shop-category="machines"]').click();await page.getByRole('searchbox').fill('CS Surf');await buy('cs_surf');await page.locator('.shop-close').click();row=await openBag();await row.locator('[data-machine-target]').selectOption(mon.uuid);assert.equal(await row.locator('[data-machine-slot]').count(),0);await row.locator('[data-machine-confirm]').click();await page.waitForFunction(()=>!window.shopVm.medicineBusy&&window.shopVm.medicineNotice.includes('sauvegardée'));assert.deepEqual(mon.abilities,['Tackle','Surf']);assert.equal(p.items.cs_surf,0);assert.equal((await require('../server/persistence/itemRepository').loadUserItems(userId)).find(i=>i.key==='cs_surf').quantity,1);
 assert.deepEqual(errors,[]);success=true;console.log(JSON.stringify({machines:264,descriptionsForOfferedAndCurrentMoves:true,levelUpDescriptions:true,purchaseAndReplace:true,incompatibleDisabled:true,cancelPreservesItem:true,reconnectAndSql:true,expeditionAppend:true,viewports:3,shopCsDescriptions:264,shopCsPowerCases:5,shopCsViewports:4,shopCsThemes:2,errors,output}));
}finally{if(!success&&page)await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});await browser?.close();await new Promise(r=>setTimeout(r,400));cleanup();await new Promise(r=>io.close(r));if(userId)await dbPool.execute('DELETE FROM users WHERE id=?',[userId]);await dbPool.end();}})().catch(e=>{console.error(e.stack);process.exitCode=1});
