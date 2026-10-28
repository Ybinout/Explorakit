// Real wild wins/captures and real shop controls; never writes production accounts.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(!/test/i.test(process.env.DB_TEST_NAME||''))throw Error('Dedicated test database required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';process.env.BATTLE_DELAY_SCALE='0';
const express=require('express'),{Server}=require('socket.io'),{chromium}=require('playwright'),{dbPool:db}=require('../server/config/database');
const factory=require('../server/game/drift/pokemonFactory'),teams=require('../server/persistence/teamRepository');
const crystals=require('../server/game/items/wildCrystals').crystals,keys=crystals.map(i=>i.key),names=crystals.map(i=>i.name);
const dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-crystals-dist',out=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-wild-crystal-sales-browser';fs.mkdirSync(out,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server);app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
const store=require('../server/game/drift/lobbyStore').createLobbyStore();let checkpointData;
const cleanup=require('../server/realtime/driftLobbyHandler').registerDriftLobbies(io,{store,checkpointRepository:{async save(data){checkpointData=data;}},runtimeOptions:{random:()=>.9,paceMs:0}});
let browser,page,success=false;const users=[],errors=[],modes=[],screens=[],oldRandom=Math.random;
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(!v?.socket?.connected||!v.players[v.socket.id]||v.mapLoading||v.renderedMap!==v.map)return false;window.v=v;if(window.listened!==v.socket){window.listened=v.socket;v.socket.on('endbattle',r=>window.lastBattle=r);}return true;});}
async function command(name,data){return page.evaluate(({name,data})=>new Promise((resolve,reject)=>{const socket=v.socket.timeout(8000),ack=(error,result)=>error?reject(error):resolve(result);if(data===undefined)socket.emit(name,ack);else socket.emit(name,data,ack);}),{name,data});}
async function create(base){const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'crystal_shop_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(r.status,201);const f=await r.json();users.push(f.user.id);return f;}
function lead(){const p=factory.create(150,200,true);p.passiveAbility=null;p.abilities=[];p.movePp=[];p.addAbility('Ice Beam');return p;}
async function finishWild(capture){
 await page.locator('.action-attack:enabled').waitFor({timeout:20000});
 if(capture){await page.locator('.action-bag:enabled').click();await page.locator('.battle-choice-btn-bag').first().click();}
 else{await page.locator('.action-attack:enabled').click();await page.locator('.battle-grid-attacks button:enabled').first().click();}
 await page.locator('[data-battle-result-continue]').waitFor({timeout:30000});
 const result=await page.evaluate(()=>lastBattle);assert(crystals.every(i=>result.summary.loot.includes(i.name)));assert.equal(result.summary.loot.filter(n=>names.includes(n)).length,3);
 await page.locator('[data-battle-result-continue]').click();await page.waitForTimeout(180);return result;
}
async function openSell(){await page.locator('.location-shop-btn').click();await page.locator('[data-shop-operation="sell"]').click();await page.locator('[data-shop-category="treasures"]').click();await page.locator('[data-shop-item="crystal_shard"]').waitFor();}
async function sell(key,quantity=1){const row=page.locator(`[data-shop-item="${key}"]`);await row.locator('select').selectOption(String(quantity));await row.locator('button').click();await page.locator('[data-sale-review]').waitFor();assert.match(await page.locator('[data-sale-review]').innerText(),new RegExp(String(crystals.find(i=>i.key===key).sell_price*quantity)));await page.locator('[data-sale-confirm]').click();await page.waitForFunction(()=>!v.shop.loading);assert.equal(await page.locator('.shop-error').count(),0);}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`,a=await create(base),b=await create(base);
 await teams.editEquipe(a.user.id,{pokemons:[lead()]});await db.execute("UPDATE users SET map='route1',x=176,y=48,money=1000 WHERE id=?",[a.user.id]);await db.execute("INSERT INTO user_items(user_id,item_key,quantity)VALUES(?,'pokeball',20)ON DUPLICATE KEY UPDATE quantity=20",[a.user.id]);
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true});await context.addInitScript(f=>{if(location.protocol.startsWith('http'))localStorage.setItem('explorakit.user',JSON.stringify(f));},{...a.user,token:a.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().startsWith(base)&&r.status()>=400)errors.push(r.status()+' '+r.url());});
 await page.goto(base+'/game',{waitUntil:'networkidle'});await ready();await page.keyboard.press('Shift');assert.equal((await command('sellShopItem',{itemKey:keys[0],quantity:1,price:999999})).reason,'not_in_shop');
 Math.random=()=>0;await page.evaluate(()=>{window.lastBattle=null;v.socket.emit('playerAction','move_d');});await finishWild(false);
 await page.evaluate(()=>{window.lastBattle=null;v.socket.emit('playerAction','move_q');});await finishWild(true);Math.random=oldRandom;
 const bag=await require('../server/persistence/itemRepository').loadUserItems(a.user.id);assert(keys.every(k=>bag.find(i=>i.key===k)?.quantity===2));
 async function at(map){await command('requestGameSave');await page.evaluate(()=>v.socket.disconnect());await page.waitForTimeout(180);await db.execute('UPDATE users SET map=?,x=432,y=528 WHERE id=?',[map,a.user.id]);await page.reload({waitUntil:'networkidle'});await ready();}
 await at('ville1_shop');await openSell();
 for(const themeMode of['light','dark'])for(const [width,height]of[[320,480],[393,852],[844,390],[1365,900]]){
  await page.setViewportSize({width,height});await page.evaluate(mode=>v.updatePreferences({...v.preferences,themeMode:mode}),themeMode);await page.waitForTimeout(150);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));const rect=await page.locator('.shop-card').boundingBox();assert(rect.x>=0&&rect.y>=0&&rect.x+rect.width<=width+1&&rect.y+rect.height<=height+1);const file=`sales-${themeMode}-${width}.png`;await page.screenshot({path:path.join(out,file)});screens.push(file);
 }
 await page.setViewportSize({width:393,height:852});const initial=await page.evaluate(()=>v.shop.money);
 const row=page.locator('[data-shop-item="crystal_shard"]');await row.locator('button').click();await page.locator('[data-sale-review]').waitFor();await page.keyboard.press('Escape');assert.equal(await page.locator('[data-sale-review]').count(),0);assert.equal(await page.evaluate(()=>v.shop.money),initial);
 for(const k of keys)await sell(k);assert.equal(await page.evaluate(()=>v.shop.money),initial+3600);
 await page.locator('[data-shop-operation="buy"]').click();assert.equal(await page.locator('[data-shop-item="crystal_shard"]').count(),0);await page.locator('[data-shop-category="balls"]').click();await page.locator('[data-shop-item="pokeball"] button').click();await page.waitForFunction(()=>!v.shop.loading);assert.equal(await page.evaluate(()=>v.shop.money),initial+3450);await page.keyboard.press('Escape');
 await at('tour_etage3');await openSell();const beforeFloor=await page.evaluate(()=>v.shop.money);await sell('aurora_prism');assert.equal(await page.evaluate(()=>v.shop.money),beforeFloor+3000);await page.keyboard.press('Escape');await page.reload({waitUntil:'networkidle'});await ready();await page.evaluate(()=>v.loadBagItems());await page.waitForFunction(()=>!v.bagLoading);assert(!await page.evaluate(()=>v.bagItems.some(i=>i.key==='aurora_prism'&&i.quantity>0)));modes.push('adventure');
 await page.goto(base+'/colosseum',{waitUntil:'networkidle'});await page.locator('[data-colosseum-start]:enabled').click();await page.locator('[data-starter-choice]').first().click();await page.locator('.starter-backdrop').waitFor({state:'hidden'});await ready();
 async function expedition(mode){
  const p=cleanup.runtime.playerFor(a.user);p.equipe.pokemons=[lead()];p.items={pokeball:20};p.money=1000;Object.assign(p,{currentmap:'route1',x:208,y:48});cleanup.runtime.enter(a.user,{id:p.socketId});await page.waitForFunction(()=>v.map==='route1'&&!v.mapLoading);
  assert.equal((await command('sellShopItem',{itemKey:keys[0],quantity:1})).success,false);
  for(const capture of[false,true]){const target=factory.create(19,1,true);target.currentHp=1;const battle=cleanup.runtime.battle(p,{npc:true,equipe:{pokemons:[target]},drifts:[],equipped:[]},'wild');battle.random=()=>0;await finishWild(capture);}
  assert(keys.every(k=>p.items[k]===2));Object.assign(p,{currentmap:'ville1_shop',x:432,y:528});cleanup.runtime.enter(a.user,{id:p.socketId});await page.waitForFunction(()=>v.map==='ville1_shop'&&!v.mapLoading);await openSell();const before=p.money;
  for(const k of keys)await sell(k);assert.equal(p.money,before+3600);assert(keys.every(k=>p.items[k]===1));
  await cleanup.checkpoint();const saved=require('../server/game/drift/checkpointCodec').decode(checkpointData),savedPlayer=[...saved.runs.values()].filter(r=>r.id===p.run.id).flatMap(r=>[...r.players.values()]).find(x=>x.userId===a.user.id);assert.equal(savedPlayer.money,p.money);assert(keys.every(k=>savedPlayer.items[k]===1));
  await page.reload({waitUntil:'networkidle'});await ready();await openSell();assert(keys.every(k=>p.items[k]===1));await page.keyboard.press('Escape');modes.push(mode);
 }
 await expedition('colosseum');const p=cleanup.runtime.playerFor(a.user);cleanup.runtime.abandon(p);store.leave(a.user);await page.goto(base+'/colosseum',{waitUntil:'networkidle'});
 store.connect(a.user,'crystal-host');store.connect(b.user,'crystal-guest');const lobby=store.create(a.user,{capacity:2,durationMinutes:30});store.join(b.user,lobby.code);for(const f of[a,b])store.ready(f.user,true);await cleanup.runtime.start(a.user);for(const f of[a,b]){const p=cleanup.runtime.playerFor(f.user);cleanup.runtime.chooseStarter(p,p.starterChoices[0].uuid);}
 await page.goto(base+'/drift/game',{waitUntil:'networkidle'});await ready();await expedition('rift');
 assert.deepEqual(errors,[]);success=true;const result={modes,realWildVictory:true,realWildCapture:true,simultaneousLoot:true,saleAndPurchase:true,cancelBeforeSale:true,ordinaryAndDepartmentCounter:true,checkpointAndReconnect:true,outsideShopRefused:true,viewports:4,themes:2,screens,errors,out};fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{Math.random=oldRandom;if(!success&&page&&!page.isClosed()){await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});console.error(await page.evaluate(()=>({map:window.v?.map,battle:window.v?.battle,result:window.lastBattle,shop:window.v?.shop,text:document.body.innerText.slice(-1000)})).catch(()=>null));}await browser?.close();cleanup();await new Promise(r=>io.close(r));await new Promise(r=>setTimeout(r,200));for(const id of users)await db.execute('DELETE FROM users WHERE id=?',[id]);await db.end();}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
