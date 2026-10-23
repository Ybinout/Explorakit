// Actual bag clicks, sockets and SQL; temporary accounts and an isolated server only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(!/test/i.test(process.env.DB_TEST_NAME||''))throw Error('Dedicated test database required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';process.env.BATTLE_DELAY_SCALE='0';
const express=require('express'),{Server}=require('socket.io'),{chromium}=require('playwright');
const {dbPool}=require('../server/config/database'),teams=require('../server/persistence/teamRepository'),factory=require('../server/game/drift/pokemonFactory');
const dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-stone-fix-dist',output=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-stone-fix-browser';fs.mkdirSync(output,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server);
app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));
io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
const store=require('../server/game/drift/lobbyStore').createLobbyStore();
let checkpoint;const cleanup=require('../server/realtime/driftLobbyHandler').registerDriftLobbies(io,{store,checkpointRepository:{async save(bytes){checkpoint=bytes;}},runtimeOptions:{random:()=>.9,paceMs:0}});
let browser,page,base,success=false;const errors=[],userIds=[];
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(!v?.socket?.connected||!v.players[v.socket.id]||v.mapLoading||v.renderedMap!==v.map)return false;window.stoneVm=v;return true;});}
async function createUser(){const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'stone_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(r.status,201);const f=await r.json();userIds.push(f.user.id);return f;}
async function bag(){await page.locator('.menu-toggle-btn').click();await page.locator('[data-menu-action="bag"]').click();await page.locator('[data-bag-pocket="evolution"]').click();const row=page.locator('[data-item-key="fire_stone"]');await row.locator('.bag-item-select').click();await row.locator('[data-medicine-target]:enabled').waitFor();return row;}
async function evolve(row,uuid){await row.locator('[data-medicine-target]').selectOption(uuid);await row.locator('.bag-use-button').click();await page.locator('.evolution-sheet.revealed').waitFor();await page.locator('#evolution-description').filter({hasText:'Feunard'}).waitFor();await page.locator('[data-evolution-continue]').click();await page.waitForFunction(()=>!window.stoneVm.medicineBusy&&window.stoneVm.medicineNotice.includes('Feunard'));assert.equal(await page.locator('.pack-error').count(),0);}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}`;
 const fixture=await createUser(),fox=factory.create(37,15),incompatible=factory.create(7,5),ko=factory.create(37,5);ko.currentHp=0;fox.currentHp-=5;
 await dbPool.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,'hoze_defeated','true')",[fixture.user.id]);
 await teams.editEquipe(fixture.user.id,{pokemons:[incompatible,fox,ko]});await dbPool.execute('UPDATE users SET money=100000,map=?,x=432,y=464 WHERE id=?',['tour_rdc',fixture.user.id]);
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true});await context.addInitScript(s=>{if(location.protocol.startsWith('http'))localStorage.setItem('explorakit.user',JSON.stringify(s));},{...fixture.user,token:fixture.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/game',{waitUntil:'networkidle'});await ready();await page.locator('.location-shop-btn').click();await page.locator('[data-shop-category="evolution"]').click();
 const offer=page.locator('[data-shop-item="fire_stone"]');for(const quantity of [1,2]){await offer.locator('button').click();await page.waitForFunction(quantity=>!window.stoneVm.shop.loading&&window.stoneVm.bagItems.some(i=>i.key==='fire_stone'&&i.quantity===quantity),quantity);}await page.locator('.shop-close').click();
 let row=await bag();assert(await row.locator(`option[value="${incompatible.uuid}"]`).evaluate(n=>n.disabled));assert(await row.locator(`option[value="${ko.uuid}"]`).evaluate(n=>n.disabled));assert.match(await row.locator(`option[value="${fox.uuid}"]`).textContent(),/Goupix → Feunard/);
 for(const [width,height]of [[320,568],[393,852],[1365,900]]){await page.setViewportSize({width,height});await row.locator('.bag-use-button').scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(output,`stone-bag-${width}.png`)});}
 await page.setViewportSize({width:393,height:852});await evolve(row,fox.uuid);
 assert(await row.locator(`option[value="${fox.uuid}"]`).evaluate(n=>n.disabled));
 let saved=(await teams.loadEquipe(fixture.user.id)).pokemons;assert.deepEqual(saved.map(p=>p.data.id),[7,38,37]);assert.equal(saved[1].maxHp-saved[1].currentHp,5);
 await page.reload({waitUntil:'networkidle'});await ready();assert.equal(await page.locator('.evolution-sheet').count(),0);assert.equal(await page.evaluate(()=>window.stoneVm.teamPokemons[1].data.id),38);
 assert.equal((await require('../server/persistence/itemRepository').loadUserItems(fixture.user.id)).find(i=>i.key==='fire_stone').quantity,1);
 // Exercise the same UI and existing RPC in each expedition mode.
 await page.goto(base+'/colosseum',{waitUntil:'networkidle'});await page.locator('[data-colosseum-start]:enabled').click();await page.locator('[data-starter-choice]').first().click();await page.locator('.starter-backdrop').waitFor({state:'hidden'});await ready();
 let p=cleanup.runtime.playerFor(fixture.user),mon=factory.create(37,15);p.equipe.pokemons=[mon];p.items.fire_stone=1;cleanup.runtime.send(p);await page.waitForFunction(()=>window.stoneVm.teamPokemons[0]?.data.id===37);row=await bag();await evolve(row,mon.uuid);assert.equal(mon.data.id,38);assert.equal(p.items.fire_stone,0);await cleanup.checkpoint();assert.equal(require('../server/game/drift/checkpointCodec').decode(checkpoint).runs.get(p.run.id).players.get(fixture.user.id).equipe.pokemons[0].data.id,38);
 cleanup.runtime.abandon(p);store.leave(fixture.user);
 const partner=await createUser();store.connect(fixture.user,'fixture-host');store.connect(partner.user,'fixture-partner');const lobby=store.create(fixture.user,{capacity:2,durationMinutes:30});store.join(partner.user,lobby.code);store.ready(fixture.user,true);store.ready(partner.user,true);await cleanup.runtime.start(fixture.user);
 p=cleanup.runtime.playerFor(fixture.user);const other=cleanup.runtime.playerFor(partner.user);cleanup.runtime.chooseStarter(p,p.starterChoices[0].uuid);cleanup.runtime.chooseStarter(other,other.starterChoices[0].uuid);mon=factory.create(37,15);p.equipe.pokemons=[mon];p.items.fire_stone=1;
 await page.goto(base+'/drift/game',{waitUntil:'networkidle'});await ready();await page.emulateMedia({reducedMotion:'reduce'});row=await bag();await evolve(row,mon.uuid);assert.equal(mon.data.id,38);assert.equal(p.items.fire_stone,0);
 assert.equal((await require('../server/persistence/itemRepository').loadUserItems(fixture.user.id)).find(i=>i.key==='fire_stone').quantity,1);
 assert.deepEqual(errors,[]);success=true;console.log(JSON.stringify({adventurePurchaseAndStone:true,incompatibleAndKoDisabled:true,animation:true,sqlAndReconnect:true,colosseumAndRift:true,checkpoint:true,reducedMotion:true,viewports:3,errors,output}));
}finally{if(!success&&page)await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});await browser?.close();await new Promise(r=>setTimeout(r,400));cleanup();await new Promise(r=>io.close(r));for(const id of userIds)await dbPool.execute('DELETE FROM users WHERE id=?',[id]);await dbPool.end();}})().catch(e=>{console.error(e.stack);process.exitCode=1});
