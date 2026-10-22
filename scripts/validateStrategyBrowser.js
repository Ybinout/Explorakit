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
let checkpoint;const cleanup=registerDriftLobbies(io,{checkpointRepository:{async save(bytes){checkpoint=bytes;}},runtimeOptions:{random:()=>.1}});
let browser,page,userId,success=false;const errors=[];
async function width(){assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Horizontal overflow');}
async function deferLearning(){if(await page.locator('.learning-sheet').isVisible())await page.getByRole('button',{name:'Plus tard',exact:true}).click();}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}/explorakit`;
 const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'strategy_'+randomUUID(),password:randomUUID(),starterId:7})});assert(r.ok);const fixture=await r.json();userId=fixture.user.id;
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true});
 await context.addInitScript(s=>localStorage.setItem('explorakit.user',JSON.stringify(s)),{...fixture.user,token:fixture.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().startsWith(base)&&r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
 await page.goto(base+'/colosseum',{waitUntil:'networkidle'});
 assert.equal(await page.locator('[data-colosseum-format="30"]').getAttribute('aria-pressed'),'true');
 await page.locator('[data-colosseum-start]:enabled').click();
 await page.locator('[data-starter-choice]').first().waitFor();
 await page.locator('[data-expedition-leave]').click();await page.getByRole('button',{name:'Continuer à jouer',exact:true}).click();
 assert.equal(cleanup.runtime.playerFor({id:userId}).run.phase,'selection');
 await page.locator('[data-expedition-leave]').click();await page.locator('[data-expedition-leave-confirm]').click();
 await page.locator('[data-colosseum-start]:enabled').waitFor();assert(!cleanup.runtime.playerFor({id:userId}));
 await page.locator('[data-colosseum-start]:enabled').click();
 await page.locator('[data-starter-choice]').first().waitFor();assert.equal(await page.locator('[data-starter-choice]').count(),3);
 const p=cleanup.runtime.playerFor({id:userId}),offered=p.starterChoices.map(x=>x.uuid);assert(p.starterChoices.every(p=>Object.values(p.iv).every(iv=>iv>=10)));
 for(const [w,h]of [[320,568],[393,852],[844,390],[1365,900]]){await page.setViewportSize({width:w,height:h});await width();for(const button of await page.locator('[data-starter-choice]').all()){const rect=await button.boundingBox();assert(rect.height>=44);}await page.screenshot({path:path.join(output,`strategy-starters-${w}.png`)});}
 await page.reload({waitUntil:'networkidle'});assert.deepEqual(p.starterChoices.map(x=>x.uuid),offered);await page.locator(`[data-starter-choice="${offered[1]}"]`).click();await page.locator('.starter-backdrop').waitFor({state:'hidden'});assert.equal(p.equipe.pokemons[0].uuid,offered[1]);assert.equal(p.run.endsAt-p.run.startedAt,1800000);
 // Give this isolated test expedition resources to exercise the real merchant controls.
 p.money=20000;p.currentmap='ville1_shop';p.equipe.pokemons=[factory.create(25,12,true),factory.create(1,12,true)];
 for(const rarity of ['common','rare','epic'])p.drifts.push(merchant.rollDrift(rarity,()=>.2,[...p.run.merchant.offers.map(o=>o.drift.definitionId),...p.drifts.map(d=>d.definitionId)]));
 await page.reload({waitUntil:'networkidle'});await page.locator('.location-shop-btn').click();
 for(const [key,name,price]of [['pokeball','Pokeball',150],['superball','Superball',450],['hyperball','Hyperball',900]]){
  const item=page.locator('.shop-item').filter({has:page.getByText(name,{exact:true})}),beforeMoney=p.money,beforeCount=p.items[key]||0;
  await item.locator('.shop-buy-controls button').click();
  await item.getByText('Possédé : '+(beforeCount+1),{exact:true}).waitFor();
  assert.equal(p.money,beforeMoney-price);assert.equal(p.items[key],beforeCount+1);
 }
 await page.locator('[data-shop-tab="drifts"]').click();await page.locator('[data-merchant-offer]').first().waitFor();
 const offer=p.run.merchant.offers[0],before=p.money;await page.locator(`[data-merchant-offer="${offer.id}"] button`).click();await page.getByRole('button',{name:'Épuisé',exact:true}).waitFor();assert.equal(p.money,before-offer.price);
 const boxes=await page.locator('.merchant-owned input').all();assert.equal(boxes.length,4);for(const index of [0,1,3])await boxes[index].check();await page.locator('[data-merchant-exchange]').click();await page.locator('[data-merchant-confirm]').click();await page.waitForFunction(()=>document.querySelectorAll('.merchant-owned input').length===2);assert.equal(p.drifts.length,2);
 await page.locator('.merchant-owned article button').first().click();await page.locator('[data-merchant-confirm]').click();await page.waitForFunction(()=>document.querySelectorAll('.merchant-owned input').length===1);
 for(const [w,h]of [[320,568],[393,852],[844,390]]){await page.setViewportSize({width:w,height:h});await width();await page.screenshot({path:path.join(output,`strategy-merchant-${w}.png`)});}
 await page.locator('[data-shop-tab="held"]').click();await page.locator('.shop-item').filter({hasText:'Talisman de sauvegarde'}).locator('.shop-buy-controls button').click();
 await page.waitForFunction(()=>[...document.querySelectorAll('.shop-item')].some(e=>e.textContent.includes('Talisman de sauvegarde')&&e.textContent.includes('Possédé : 1')));
 await page.locator('[data-shop-tab="stones"]').click();await page.locator('.shop-item').filter({hasText:'Pierre Foudre'}).locator('.shop-buy-controls button').click();
 await page.waitForFunction(()=>[...document.querySelectorAll('.shop-item')].some(e=>e.textContent.includes('Pierre Foudre')&&e.textContent.includes('Possédé : 1')));
 await page.locator('.shop-close').click();await page.setViewportSize({width:393,height:852});await page.locator('.menu-toggle-btn').click();await page.locator('[data-menu-action="bag"]').click();
 await page.locator('[data-bag-pocket="evolution"]').click();
 await page.locator('[data-item-key="thunder_stone"] .bag-item-select').click();
 const pika=p.equipe.pokemons[0],stone=page.locator('[data-item-key="thunder_stone"]');await stone.locator('select').selectOption(pika.uuid);await stone.locator('.bag-use-button').click();
 await page.locator('.evolution-sheet.revealed').waitFor();await page.locator('[data-evolution-continue]').click();await page.getByRole('status').filter({hasText:'a évolué en Raichu'}).waitFor();assert.equal(pika.data.id,26);assert.equal(p.items.thunder_stone,0);await page.screenshot({path:path.join(output,'strategy-evolution.png')});
 await page.locator('.bag-panel .panel-close').click();await deferLearning();await page.locator('.menu-toggle-btn').click();await page.locator('[data-menu-action="pokemon"]').click();
 await page.locator('.team-row').filter({hasText:'Raichu'}).locator('.team-held-item-select').selectOption('rift_talisman');
 await page.waitForFunction(()=>[...document.querySelectorAll('.team-held-item-select')].some(e=>e.value==='rift_talisman'));assert.equal(pika.heldItem,'rift_talisman');await page.locator('.team-close').click();
 const target=factory.create(19,12,true);target.maxHp=target.currentHp=500;pika.maxHp=pika.currentHp=500;pika.abilities=['Tackle'];pika.movePp=[35];pika.passiveAbility=target.passiveAbility=null;
 const battle=cleanup.runtime.battle(p,{npc:true,equipe:{pokemons:[target]},drifts:[],equipped:[]},'wild');await page.locator('.battle-scene').waitFor();
 await page.evaluate(()=>{const el=document.querySelector('.battle');const vm=el.__vue__;window.strategyMoves=[];vm.$watch('battleMoveFx.nonce',()=>window.strategyMoves.push({actor:vm.battleMoveFx.actor,at:performance.now()}));});
 await page.locator('.action-attack:enabled').click();await page.locator('.battle-grid-attacks .battle-choice-btn:enabled').first().click();
 await page.waitForFunction(()=>window.strategyMoves.length>=2);const starts=await page.evaluate(()=>window.strategyMoves);assert.notEqual(starts[0].actor,starts[1].actor);assert(starts[1].at-starts[0].at>=800);
 await page.locator('.action-attack:enabled').waitFor();pika.currentHp=0;battle.prune();battle.sync();battle.finish(null,'fled');
 await page.locator('[data-battle-result-continue]').click();await deferLearning();assert.equal(pika.riftFainted,true);assert.equal(pika.heldItem,null);assert.equal(pika.currentHp,0);
 await page.locator('.menu-toggle-btn').click();await page.locator('[data-menu-action="bag"]').click();await page.locator('[data-bag-pocket="medicine"]').click();await page.locator('[data-item-key="drift_potion"] .bag-item-select').click();const potion=page.locator('[data-item-key="drift_potion"]');await potion.locator('select').selectOption(pika.uuid);await potion.locator('.bag-use-button').click();await page.getByRole('status').filter({hasText:'Soin sauvegardé'}).waitFor();assert.equal(pika.currentHp,20);assert(!pika.riftFainted);
 await page.reload({waitUntil:'networkidle'});await deferLearning();assert.equal(p.equipe.pokemons.find(x=>x.uuid===pika.uuid).currentHp,20);assert(p.merchantBought.includes(offer.id));
 const saved=require('../server/game/drift/checkpointCodec').decode(checkpoint).runs.get(p.run.id).players.get(userId);assert.equal(saved.equipe.pokemons.find(x=>x.uuid===pika.uuid).data.id,26);assert(saved.merchantBought.includes(offer.id));
 await page.goto(base+'/drift',{waitUntil:'networkidle'});await page.locator('[data-expedition-resume]').waitFor();
 await page.locator('[data-expedition-leave]').click();await page.locator('[data-expedition-leave-confirm]').click();
 await page.waitForFunction(()=>!document.querySelector('[data-expedition-resume]'));assert(!cleanup.runtime.playerFor({id:userId}));
 assert.deepEqual(errors,[]);success=true;console.log(JSON.stringify({starterChoices:true,discountedBalls:true,privateDurableStock:true,buyExchangeSell:true,stoneEvolution:true,protectedKOAndHeal:true,orderedAttacks:true,viewports:4,checkpoint:true,errors,output}));
}finally{if(!success&&page)await page.screenshot({path:path.join(output,'strategy-failure.png'),fullPage:true}).catch(()=>{});await browser?.close();cleanup();await new Promise(r=>io.close(r));if(userId)await dbPool.execute('DELETE FROM users WHERE id=?',[userId]);await dbPool.end();}})().catch(e=>{console.error(e);process.exitCode=1});
