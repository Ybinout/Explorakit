// Catalogue-wide UI coverage and actual item RPCs on disposable SQL accounts.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(!/test/i.test(process.env.DB_TEST_NAME||''))throw Error('Dedicated test database required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';process.env.BATTLE_DELAY_SCALE='0';
const express=require('express'),{Server}=require('socket.io'),{chromium}=require('playwright');
const {dbPool}=require('../server/config/database'),teams=require('../server/persistence/teamRepository');
const {items,targetFor,usage}=require('./lib/itemUsageFixtures'),factory=require('../server/game/drift/pokemonFactory');
const dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-items-audit-dist',output=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-items-audit-browser';fs.mkdirSync(output,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server);
app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));
io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
const store=require('../server/game/drift/lobbyStore').createLobbyStore();
const cleanup=require('../server/realtime/driftLobbyHandler').registerDriftLobbies(io,{store,checkpointRepository:{async save(){}},runtimeOptions:{random:()=>.9,paceMs:0}});
let browser,page,base,success=false;const errors=[],userIds=[];
function team(){const a=factory.create(7,30,true),fox=factory.create(37,15,true),ko=factory.create(25,20,true);a.currentHp=1;a.status='poison';a.abilities=['Tackle'];a.movePp=[0];a.ev.specialAttack=20;a.recalculateStats();a.currentHp=1;ko.currentHp=0;return[a,fox,ko];}
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(!v?.socket?.connected||!v.players[v.socket.id]||v.mapLoading||v.renderedMap!==v.map)return false;window.itemsVm=v;return true;});}
async function createUser(){const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'bag_audit_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(r.status,201);const f=await r.json();userIds.push(f.user.id);return f;}
async function openBag(){await page.locator('.menu-toggle-btn').click();await page.locator('[data-menu-action="bag"]').click();await page.waitForFunction(()=>!window.itemsVm.bagLoading&&!window.itemsVm.teamLoading);}
async function select(key,pocket){await page.locator(`[data-bag-pocket="${pocket}"]`).click();const row=page.locator(`[data-item-key="${key}"]`);await row.locator('.bag-item-select').click();return row;}
async function use(key,pocket,uuid){const row=await select(key,pocket),before=await page.evaluate(key=>window.itemsVm.bagItems.find(i=>i.key===key)?.quantity||0,key);await row.locator('[data-medicine-target]').selectOption(uuid);await row.locator('.bag-use-button:enabled').click();await page.waitForFunction(({key,before})=>!window.itemsVm.medicineBusy&&(window.itemsVm.bagError||(window.itemsVm.bagItems.find(i=>i.key===key)?.quantity||0)===before-1),{key,before});assert.equal(await page.evaluate(()=>window.itemsVm.bagError),'');}
async function audit(mode){
 const result=await page.evaluate(async({expected,targets})=>{
  const vm=window.itemsVm,bp=vm.$refs.bagPanel,seen=[],problems=[];
  for(const pocket of bp.pockets){bp.choosePocket(pocket.key);await bp.$nextTick();for(const item of bp.visibleItems){bp.selectedKey=item.key;await bp.$nextTick();const row=document.querySelector(`[data-item-key="${item.key}"]`),kind=expected[item.key];seen.push(item.key);
   const requireControl=(selector)=>{if(!row.querySelector(selector))problems.push(`${item.key}: missing ${selector}`);};
   if(kind==='machine')requireControl('[data-machine-target]');
   if(kind==='stone'||kind==='medicine'&&!(vm.isDrift&&item.revive))requireControl('.bag-use-button');
   if(kind==='repel')requireControl('[data-use-repel]');
   if(item.category==='held')requireControl('.bag-equip-link');
   if(kind==='medicine'&&!(vm.isDrift&&item.revive)&&!vm.canReceiveMedicine(item,targets[item.key]))problems.push(`${item.key}: valid recipient disabled`);
   if(kind==='passive'){const label=row.querySelector('[data-exp-share-active]').textContent;if(!label.includes(vm.isDrift?'50 %':'40 %'))problems.push(`wrong share: ${label}`);}
  }}return{seen,problems};
 },{expected:Object.fromEntries(items.map(i=>[i.key,usage(i)])),targets:Object.fromEntries(items.filter(i=>usage(i)==='medicine').map(i=>[i.key,targetFor(i)]))});
 assert.deepEqual(result.problems,[]);assert.equal(new Set(result.seen).size,items.length,mode);
}
async function exercise(mode,roster){
 await openBag();await audit(mode);
 await use('potion','medicine',roster[0].uuid);await use('antidote','medicine',roster[0].uuid);await use('leppa_berry','berries',roster[0].uuid);
 await use('calcium','training',roster[0].uuid);await use('hondew_berry','berries',roster[0].uuid);await use('iv_randomizer_attack','training',roster[0].uuid);await use('ev_reset_all','training',roster[0].uuid);
 if(mode==='adventure')await use('revive','medicine',roster[2].uuid);
 let row=await select('cs_surf','machines');await row.locator('[data-machine-target]').selectOption(roster[0].uuid);await row.locator('[data-machine-confirm]').click();await page.waitForFunction(()=>!window.itemsVm.medicineBusy&&window.itemsVm.teamPokemons[0].abilities.includes('Surf'));
 row=await select('max_repel','field');await row.locator('[data-use-repel]').click();await page.waitForFunction(()=>!window.itemsVm.medicineBusy&&window.itemsVm.repelSteps===250);
 await use('fire_stone','evolution',roster[1].uuid);await page.locator('.evolution-sheet.revealed').waitFor();await page.locator('[data-evolution-continue]').click();
 row=await select('choice_scarf','held');await row.locator('.bag-equip-link').click();await page.locator('.team-held-item-select').first().selectOption('choice_scarf');await page.waitForFunction(()=>!window.itemsVm.teamSaving&&window.itemsVm.teamPokemons[0].heldItem==='choice_scarf');await page.locator('.team-held-item-select').first().selectOption('');await page.waitForFunction(()=>!window.itemsVm.teamSaving&&!window.itemsVm.teamPokemons[0].heldItem);
 await page.keyboard.press('Escape');await openBag();row=await select('exp_share','key');
 for(const [width,height]of [[320,568],[393,852],[1365,900]]){await page.setViewportSize({width,height});await row.scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(output,`${mode}-${width}.png`)});}
 await page.keyboard.press('Escape');await page.reload({waitUntil:'networkidle'});await ready();
 const result=await page.evaluate(()=>window.itemsVm.teamPokemons.map(p=>({id:p.data.id,hp:p.currentHp,status:p.status,ev:p.ev,moves:p.abilities,pp:p.movePp,held:p.heldItem})));
 assert.equal(result[1].id,38);assert.equal(result[0].status,'normal');assert.equal(result[0].pp[0],10);assert(result[0].moves.includes('Surf'));assert(Object.values(result[0].ev).every(n=>n===0));assert(!result[0].held);if(mode==='adventure')assert(result[2].hp>0);
}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}`;
 const fixture=await createUser(),roster=team();await teams.editEquipe(fixture.user.id,{pokemons:roster});
 for(const item of items)await dbPool.execute('INSERT INTO user_items(user_id,item_key,quantity) VALUES (?,?,2) ON DUPLICATE KEY UPDATE quantity=2',[fixture.user.id,item.key]);
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true,reducedMotion:'reduce'});await context.addInitScript(s=>{if(location.protocol.startsWith('http'))localStorage.setItem('explorakit.user',JSON.stringify(s));},{...fixture.user,token:fixture.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/game',{waitUntil:'networkidle'});await ready();await exercise('adventure',roster);
 await page.goto(base+'/colosseum',{waitUntil:'networkidle'});await page.locator('[data-colosseum-start]:enabled').click();await page.locator('[data-starter-choice]').first().click();await page.locator('.starter-backdrop').waitFor({state:'hidden'});await ready();
 let p=cleanup.runtime.playerFor(fixture.user);p.equipe.pokemons=team();p.items=Object.fromEntries(items.map(i=>[i.key,2]));cleanup.runtime.send(p);await page.reload({waitUntil:'networkidle'});await ready();await exercise('colosseum',p.equipe.pokemons);
 cleanup.runtime.abandon(p);store.leave(fixture.user);const partner=await createUser();store.connect(fixture.user,'audit-host');store.connect(partner.user,'audit-partner');const lobby=store.create(fixture.user,{capacity:2,durationMinutes:30});store.join(partner.user,lobby.code);store.ready(fixture.user,true);store.ready(partner.user,true);await cleanup.runtime.start(fixture.user);
 p=cleanup.runtime.playerFor(fixture.user);const other=cleanup.runtime.playerFor(partner.user);cleanup.runtime.chooseStarter(p,p.starterChoices[0].uuid);cleanup.runtime.chooseStarter(other,other.starterChoices[0].uuid);p.equipe.pokemons=team();p.items=Object.fromEntries(items.map(i=>[i.key,2]));await page.goto(base+'/drift/game',{waitUntil:'networkidle'});await ready();await exercise('rift',p.equipe.pokemons);
 assert.deepEqual(errors,[]);success=true;console.log(JSON.stringify({catalogueItems:items.length,modes:3,allActionsVisible:true,validMedicineRecipients:true,medicineAndTraining:true,csAndRepelAndStone:true,equipUnequip:true,reconnect:true,multiExpLabel:true,viewports:3,errors,output}));
}finally{if(!success&&page)await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});await browser?.close();await new Promise(r=>setTimeout(r,400));cleanup();await new Promise(r=>io.close(r));for(const id of userIds)await dbPool.execute('DELETE FROM users WHERE id=?',[id]);await dbPool.end();}})().catch(e=>{console.error(e.stack);process.exitCode=1});
