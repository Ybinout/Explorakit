// Test server only: fixtures and accelerated clock never add production endpoints.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(!/test/i.test(process.env.DB_TEST_NAME||''))throw Error('Dedicated test database required.');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';
const express=require('express'),{Server}=require('socket.io'),{chromium}=require('playwright');
const {dbPool}=require('../server/config/database'),factory=require('../server/game/drift/pokemonFactory'),merchant=require('../server/game/drift/merchant');
const {registerDriftLobbies}=require('../server/realtime/driftLobbyHandler');
const output=process.env.RELEASE_SCREENSHOTS||'/tmp/explorakit-six-browser',dist=process.env.RELEASE_DIST_DIR||'/tmp/explorakit-release-dist';fs.mkdirSync(output,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server,{path:'/explorakit/socket.io'});app.use(express.json());app.use('/explorakit/api',require('../server/http/routes'));app.use('/explorakit',express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));
let checkpoint;const store=require('../server/game/drift/lobbyStore').createLobbyStore();const cleanup=registerDriftLobbies(io,{store,checkpointRepository:{async save(bytes){checkpoint=bytes;}},runtimeOptions:{random:()=>.1}});
let browser,page,userId,success=false;const errors=[];
async function width(){assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Horizontal overflow');}
async function deferLearning(){if(await page.locator('.learning-sheet').isVisible())await page.getByRole('button',{name:'Plus tard',exact:true}).click();}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}/explorakit`;
 const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'contracts_'+randomUUID(),password:randomUUID(),starterId:7})});assert(r.ok);const fixture=await r.json();userId=fixture.user.id;
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true});
 await context.addInitScript(s=>localStorage.setItem('explorakit.user',JSON.stringify(s)),{...fixture.user,token:fixture.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().startsWith(base)&&r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
 await page.goto(base+'/colosseum',{waitUntil:'networkidle'});await page.locator('[data-colosseum-format="30"]').click();await page.locator('[data-colosseum-start]:enabled').click();
 await page.locator('[data-starter-choice]').first().waitFor();assert.equal(await page.locator('[data-starter-choice]').count(),3);
 const p=cleanup.runtime.playerFor({id:userId}),offered=p.starterChoices.map(x=>x.uuid);
 for(const [w,h]of [[320,568],[393,852],[844,390],[1365,900]]){await page.setViewportSize({width:w,height:h});await width();for(const button of await page.locator('[data-starter-choice]').all()){const rect=await button.boundingBox();assert(rect.height>=44);}await page.screenshot({path:path.join(output,`strategy-starters-${w}.png`)});}
 await page.reload({waitUntil:'networkidle'});assert.deepEqual(p.starterChoices.map(x=>x.uuid),offered);await page.locator(`[data-starter-choice="${offered[1]}"]`).click();await page.locator('.starter-backdrop').waitFor({state:'hidden'});assert.equal(p.equipe.pokemons[0].uuid,offered[1]);assert.equal(p.run.endsAt-p.run.startedAt,1800000);

 p.equipe.pokemons=[factory.create(7,20,true),factory.create(4,20,true)];
 const team=[...p.equipe.pokemons];
 for(const poke of team){poke.passiveAbility=null;poke.abilities=['Tackle'];poke.movePp=[35];}
 async function finish(){await page.locator('[data-battle-result-continue]').click();await deferLearning();await page.locator('.battle-scene').waitFor({state:'hidden'});}
 async function attack(){await page.locator('.action-attack:enabled').click();await page.locator('.battle-grid-attacks .battle-choice-btn:enabled').first().click();await page.locator('[data-battle-result-continue]').waitFor();await finish();}
 async function openContracts(){await page.locator('.menu-toggle-btn').click();await page.locator('[data-menu-action="contracts"]').click();await page.locator('[data-expedition-contracts]').waitFor();}
 async function closePanel(){await page.getByRole('button',{name:'Fermer le carnet Drift',exact:true}).click();}
 async function request(name,data){return page.evaluate(({name,data})=>new Promise(resolve=>{let el=document.querySelector('.game-stage');while(el&&!el.__vue__)el=el.parentElement;el.__vue__.socket.timeout(5000).emit(name,data,(error,result)=>resolve(error?{success:false,message:error.message}:result));}),{name,data});}
 // A forged completion cannot claim a reward.
 const rejected=await request('drift:contractClaim',{contractId:p.contracts[0].id,reward:'supplies',progress:99});assert.equal(rejected.success,false);
 for(const attacker of team){p.equipe.pokemons=[attacker,...p.equipe.pokemons.filter(v=>v!==attacker)];const target=factory.create(19,1,true);target.currentHp=1;target.passiveAbility=null;target.abilities=['Growl'];target.movePp=[40];cleanup.runtime.battle(p,{npc:true,equipe:{pokemons:[target]},drifts:[],equipped:[]},'wild');await attack();}
 assert.equal(p.contracts[0].progress.length,2);
 await page.locator('[data-contract-alert]').waitFor();assert.equal(await page.locator('[data-contract-alert]').innerText(),'1');
 await page.reload({waitUntil:'networkidle'});await deferLearning();await page.locator('[data-contract-alert]').waitFor();
 await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('[data-contract-alert]').evaluate(el=>getComputedStyle(el).animationName),'none');await page.emulateMedia({reducedMotion:'no-preference'});
 await page.screenshot({path:path.join(output,'contracts-menu-reward.png')});
 await openContracts();await page.locator('[data-contract="rotation"] .choose-reward').click();
 for(const [w,h]of [[320,568],[393,852],[844,390],[1365,900]]){await page.setViewportSize({width:w,height:h});await width();const button=page.locator('[data-contract="rotation"] [data-contract-reward="training"]');await button.scrollIntoViewIfNeeded();assert((await button.boundingBox()).height>=44);await page.screenshot({path:path.join(output,`contracts-rewards-${w}.png`)});}
 const reserve=p.equipe.pokemons[1],beforeLevel=reserve.level,claimedId=p.contracts[0].id;
 await page.locator('[data-contract="rotation"] [data-contract-reward="training"]').click();await page.waitForFunction(()=>document.querySelector('.learning-sheet')||document.querySelector('[data-contract="rotation"][data-contract-stage="2"]'));await deferLearning();await page.locator('[data-contract="rotation"][data-contract-stage="2"]').waitFor();assert.equal(reserve.level,beforeLevel+1);
 const repeated=await request('drift:contractClaim',{contractId:claimedId,reward:'training'});assert.equal(repeated.success,false);assert.equal(reserve.level,beforeLevel+1);
 assert.equal(await page.locator('[data-contract-alert]').count(),0);
 await closePanel();await deferLearning();await page.reload({waitUntil:'networkidle'});await deferLearning();await openContracts();assert.match(await page.locator('[data-contract="rotation"]').innerText(),/Palier 2/);await closePanel();
 for(const id of [16,19]){const target=factory.create(id,1,true);target.currentHp=1;cleanup.runtime.battle(p,{npc:true,equipe:{pokemons:[target]},drifts:[],equipped:[]},'wild');await page.locator('.action-bag:enabled').click();await page.locator('.battle-choice-btn-bag').first().click();await page.locator('[data-battle-result-continue]').waitFor();await finish();}
 await openContracts();const beforeBalls=p.items.pokeball;await page.locator('[data-contract="capture"] .choose-reward').click();await page.locator('[data-contract="capture"] [data-contract-reward="supplies"]').click();await page.locator('[data-contract="capture"][data-contract-stage="2"]').waitFor();assert.equal(p.items.pokeball,beforeBalls+3);await closePanel();
 // Visit an actual expedition NPC; declining starts no battle, confirming uses its announced team.
 const trainer=require('../server/game/drift/trainers').find('expedition_lina');p.currentmap=trainer.map;p.x=(trainer.x+1)*32+16;p.y=trainer.y*32+16;
 await page.setViewportSize({width:393,height:852});await page.reload({waitUntil:'networkidle'});await deferLearning();await page.locator('.mobile-action-a').click();await page.locator('[data-trainer-offer]').waitFor();assert.equal(p.inbattle,false);assert.match(await page.locator('[data-trainer-offer]').innerText(),/Fouinette/);
 await page.getByRole('button',{name:'Plus tard',exact:true}).click();assert.equal(p.inbattle,false);
 await page.locator('.mobile-action-a').click();await page.locator('[data-trainer-offer]').waitFor();await page.screenshot({path:path.join(output,'contracts-trainer.png')});await page.locator('[data-trainer-challenge]').click();await page.locator('.battle-scene').waitFor();assert.equal(p.battle.npcKey,trainer.id);p.battle.active(1).currentHp=1;await attack();assert(p.defeated.has(trainer.id));
 await openContracts();await page.locator('[data-contract="trainer"] .choose-reward').click();const beforeItem=p.items.expert_belt||0;await page.locator('[data-contract="trainer"] [data-contract-reward="item"]').click();await page.locator('[data-contract="trainer"][data-contract-stage="2"]').waitFor();assert.equal(p.items.expert_belt,beforeItem+1);await closePanel();
 // Five equipped slots, replacement and family upgrade in place, no separate selection screen.
 p.drifts=Array.from({length:6},(_,i)=>({uuid:'ui-'+i,definitionId:'DRF-00'+(i+1),rarity:'rare'}));p.drifts.push({uuid:'ui-upgrade',definitionId:'DRF-001',rarity:'epic'});p.equipped=p.drifts.slice(0,5).map(d=>d.uuid);cleanup.runtime.send(p);
 await page.locator('.drift-hud-toggle').click();await page.locator('[data-drift-id="ui-5"] [data-drift-action="equip"]').click();await page.locator('[data-replace-drift="ui-1"]').click();await page.waitForFunction(()=>document.querySelector('[data-drift-id="ui-5"] [data-drift-action="unequip"]'));
 assert.equal(p.equipped.length,5);assert(!p.equipped.includes('ui-1'));
 await page.locator('[data-drift-id="ui-upgrade"] [data-drift-action="equip"]').click();await page.waitForFunction(()=>document.querySelector('[data-drift-id="ui-upgrade"] [data-drift-action="unequip"]'));assert(!p.equipped.includes('ui-0'));assert.equal(p.equipped.length,5);
 await page.locator('[data-drift-id="ui-5"] [data-drift-action="unequip"]').click();await page.waitForFunction(()=>document.querySelector('[data-drift-id="ui-5"] [data-drift-action="equip"]'));assert.equal(p.equipped.length,4);
 for(const [w,h]of [[320,568],[393,852],[844,390],[1365,900]]){await page.setViewportSize({width:w,height:h});await width();const row=page.locator('[data-drift-id="ui-5"]');await row.scrollIntoViewIfNeeded();assert((await row.locator('[data-drift-action="equip"]').boundingBox()).height>=44);await page.screenshot({path:path.join(output,`contracts-drifts-${w}.png`)});}
 await closePanel();await page.reload({waitUntil:'networkidle'});await deferLearning();assert.equal(p.equipped.length,4);assert.equal(p.contracts.filter(c=>c.stage===2).length,3);
 const saved=require('../server/game/drift/checkpointCodec').decode(checkpoint).runs.get(p.run.id).players.get(userId);assert.equal(saved.contracts.filter(c=>c.stage===2).length,3);assert.deepEqual(saved.equipped,p.equipped);assert(saved.defeated.has(trainer.id));
 // A real merchant command cascades into an equipped Drift, visible after reconnect/checkpoint.
 p.currentmap='ville1_shop';p.money=1000;
 p.drifts=[{uuid:'fusion-equipped',definitionId:'DRF-002',rarity:'common',element:null},{uuid:'fusion-rare',definitionId:'DRF-002',rarity:'rare',element:null}];p.equipped=['fusion-equipped'];
 p.run.merchant={id:'fusion-stock',offers:[{id:'fusion-offer',price:200,drift:{uuid:'offered',definitionId:'DRF-002',rarity:'common',element:null}}]};
 const bought=await request('drift:merchantBuy',{offerId:'fusion-offer'});assert.equal(bought.success,true);assert.equal(p.drifts.length,1);assert.equal(p.drifts[0].rarity,'epic');assert.equal(p.money,800);assert.deepEqual(p.equipped,['fusion-equipped']);
 await page.reload({waitUntil:'networkidle'});await deferLearning();await page.locator('.drift-hud-toggle').click();
 await page.locator('[data-drift-fusion]').waitFor();assert.match(await page.locator('[data-drift-fusion]').innerText(),/2 fusions en chaîne/);assert.match(await page.locator('[data-drift-id="fusion-equipped"]').innerText(),/Épique/);
 for(const [w,h]of [[320,568],[393,852],[844,390]]){await page.setViewportSize({width:w,height:h});await width();await page.screenshot({path:path.join(output,`fusion-${w}.png`)});}
 await page.locator('[data-drift-tab="contracts"]').click();assert.equal(await page.locator('[data-contract-stage="2"]').count(),3);assert.match(await page.locator('[data-contract="capture"]').innerText(),/Bats ou capture/);
 await closePanel();
 const fusedSave=require('../server/game/drift/checkpointCodec').decode(checkpoint).runs.get(p.run.id).players.get(userId);assert.equal(fusedSave.drifts[0].rarity,'epic');assert.deepEqual(fusedSave.equipped,['fusion-equipped']);
 // Complete the next bestiary with real wins, then claim its stronger kit via the UI.
 for(const id of [16,19,25]){const target=factory.create(id,5,true);target.currentHp=1;target.passiveAbility=null;target.abilities=['Growl'];target.movePp=[40];cleanup.runtime.battle(p,{npc:true,equipe:{pokemons:[target]},drifts:[],equipped:[]},'wild');await attack();}
 await openContracts();await page.locator('[data-contract="capture"] .choose-reward').click();assert.match(await page.locator('[data-contract="capture"] [data-contract-reward="supplies"]').innerText(),/4 Super Balls et 3 Super Potions/);
 const beforeSuper=p.items.superball||0,beforeMoney=p.money,secondId=p.contracts[1].id;
 await page.locator('[data-contract="capture"] [data-contract-reward="supplies"]').click();await page.locator('[data-contract="capture"][data-contract-stage="3"]').waitFor();assert.equal(p.items.superball,beforeSuper+4);assert.equal(p.money,beforeMoney+75);
 assert.equal((await request('drift:contractClaim',{contractId:secondId,reward:'supplies'})).success,false);
 await closePanel();await page.reload({waitUntil:'networkidle'});await deferLearning();await openContracts();assert.match(await page.locator('[data-contract="capture"]').innerText(),/niveau 8/);await page.screenshot({path:path.join(output,'contracts-stage-3.png')});await closePanel();
 // The shared controls must also fit a real multiplayer expedition with five tabs.
 cleanup.runtime.abandon(p);store.leave(fixture.user);
 const guest={id:1000000007,username:'Invité du test'};store.connect(guest,'fixture-guest');store.create(fixture.user,{capacity:2,durationMinutes:30});store.join(guest,store.snapshot(fixture.user).code);store.ready(guest,true);store.ready(fixture.user,true);cleanup.runtime.start(fixture.user);
 const rift=cleanup.runtime.playerFor(fixture.user),guestPlayer=cleanup.runtime.playerFor(guest);cleanup.runtime.chooseStarter(guestPlayer,guestPlayer.starterChoices[0].uuid);
 await page.goto(base+'/drift/game',{waitUntil:'networkidle'});await page.locator('[data-starter-choice]').first().click();await page.locator('.starter-backdrop').waitFor({state:'hidden'});
 rift.drifts=[{uuid:'rift-ui',definitionId:'DRF-001',rarity:'rare'}];cleanup.runtime.send(rift);
 await page.locator('.drift-hud-toggle').click();assert.equal(await page.locator('[data-drift-tab]').count(),5);
 for(const [w,h]of [[320,568],[393,852],[844,390]]){await page.setViewportSize({width:w,height:h});await width();for(const button of await page.locator('[data-drift-tab]').all()){const rect=await button.boundingBox();assert(rect.x>=0&&rect.x+rect.width<=w+1);assert(rect.height>=44);}await page.screenshot({path:path.join(output,`contracts-rift-${w}.png`)});}
 await page.locator('[data-drift-id="rift-ui"] [data-drift-action="equip"]').click();await page.waitForFunction(()=>document.querySelector('[data-drift-id="rift-ui"] [data-drift-action="unequip"]'));assert.deepEqual(rift.equipped,['rift-ui']);
 await page.locator('[data-drift-tab="contracts"]').click();assert.equal(await page.locator('[data-contract]').count(),3);assert(rift.contracts.every(c=>!c.claimed));
 assert.deepEqual(errors,[]);success=true;console.log(JSON.stringify({automaticContracts:true,progressiveContracts:true,automaticFusion:true,multiplayerControls:true,threeRewards:true,claimReplayRejected:true,realNpcChoiceAndBattle:true,directDriftEquip:true,atomicReplacement:true,familyUpgrade:true,reconnected:true,checkpoint:true,viewports:4,errors,output}));
}finally{if(!success&&page)await page.screenshot({path:path.join(output,'contracts-failure.png'),fullPage:true}).catch(()=>{});await browser?.close();cleanup();await new Promise(r=>io.close(r));if(userId)await dbPool.execute('DELETE FROM users WHERE id=?',[userId]);await dbPool.end();}})().catch(e=>{console.error(e);process.exitCode=1});
