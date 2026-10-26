// Disposable SQL/Socket/browser fixture; never changes an existing player.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(!/test/i.test(process.env.DB_TEST_NAME||''))throw Error('Dedicated test database required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';
const express=require('express'),{Server}=require('socket.io'),{chromium}=require('playwright');
const {dbPool}=require('../server/config/database'),factory=require('../server/game/drift/pokemonFactory'),engine=require('../server/game/battle/battleEngine');
const output=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-transform-browser',dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-transform-dist';fs.mkdirSync(output,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server,{path:'/socket.io'});app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));
let checkpoint;const cleanup=require('../server/realtime/driftLobbyHandler').registerDriftLobbies(io,{runtimeOptions:{paceMs:0,random:()=>.5},checkpointRepository:{async save(bytes){checkpoint=bytes;}}});
let browser,page,userId,success=false;const errors=[],cases=[];
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(!v?.socket?.connected)return false;window.transformVm=v;return true;});}
async function readyAction(){await page.waitForFunction(()=>window.transformVm.$refs.battleOverlay?.canChooseAction);}
async function attack(index){await readyAction();await page.locator('.action-attack:enabled').click();await page.locator('.battle-grid-attacks button').nth(index).click();}
async function sprite(side,id){await page.waitForFunction(({side,id})=>{const img=document.querySelector('.battle-sprite-'+side+' img');return img?.src.endsWith('/'+id+'.png')&&img.complete&&img.naturalWidth>0;},{side,id});}
async function finish(battle){battle.finish(null,'fled');await page.locator('[data-battle-result-continue]').click();await page.locator('.battle-sprite-player').waitFor({state:'hidden'});}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'transform_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(r.status,201);const fixture=await r.json();userId=fixture.user.id;
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true});await context.addInitScript(s=>localStorage.setItem('explorakit.user',JSON.stringify(s)),{...fixture.user,token:fixture.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().startsWith(base)&&r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
 await page.goto(base+'/colosseum',{waitUntil:'networkidle'});await page.locator('[data-colosseum-start]:enabled').click();await page.locator('[data-starter-choice]').first().click();await page.locator('.starter-backdrop').waitFor({state:'hidden'});await ready();
 const p=cleanup.runtime.playerFor({id:userId});
 for(const ability of ['Limber','Imposter']){
  const ditto=factory.create(132,40,true),enemy=factory.create(94,40,true),reserve=factory.create(9,40,true);
  for(const poke of [ditto,enemy,reserve]){poke.currentHp=poke.maxHp=10000;poke.status='normal';poke.passiveAbility=null;poke.heldItem=null;}
  ditto.passiveAbility=ability;ditto.heldItem='choice_scarf';ditto.abilities=['Transform'];ditto.movePp=[10];ditto.currentSpeed=40;
  enemy.abilities=['Tackle','Protect'];enemy.movePp=[35,10];enemy.currentSpeed=200;enemy.passiveAbility='Levitate';reserve.abilities=['Splash'];reserve.movePp=[40];
  p.equipe.pokemons=[ditto,reserve];p.currentmap='start';
  const battle=cleanup.runtime.battle(p,{npc:true,equipe:{pokemons:[enemy]},drifts:[],equipped:[]},'wild');
  if(ability==='Limber'){await sprite('player',132);await attack(0);}
  await page.waitForFunction(()=>{const b=window.transformVm.$refs.battleOverlay;return b?.canChooseAction&&b.currentPokemon?.__battle?.transformed;});await sprite('player',94);await sprite('wild',94);
  assert.equal(engine.getBattleSpeed(ditto),300);assert.deepEqual(ditto.movePp,[5,5]);
  await cleanup.checkpoint();const saved=require('../server/game/drift/checkpointCodec').decode(checkpoint).runs.get(p.run.id).players.get(userId).equipe.pokemons[0];assert.equal(saved.__battle.transformSpriteId,94);assert.equal(engine.getBattleSpeed(saved),300);
  await page.reload({waitUntil:'networkidle'});await ready();await readyAction();await sprite('player',94);
  await page.locator('.action-attack:enabled').click();const moves=page.locator('.battle-grid-attacks button');assert.match(await moves.nth(0).innerText(),/5 PP/);assert(await moves.nth(0).isEnabled());assert(await moves.nth(1).isEnabled());
  for(const [width,height]of [[320,480],[393,852],[844,390],[1365,900]]){
   await page.setViewportSize({width,height});await page.evaluate(width=>{window.transformVm.showMobileControls=width<=920;},width);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await sprite('player',94);await sprite('wild',94);
   await page.screenshot({path:path.join(output,`transform-${ability}-${width}.png`)});
  }
  await moves.nth(0).click();await page.waitForFunction(()=>{const b=window.transformVm.$refs.battleOverlay;return b?.canChooseAction&&b.currentPokemon?.movePp?.[0]===4;});
  await page.locator('.action-attack:enabled').click();assert(await moves.nth(0).isEnabled());assert(await moves.nth(1).isDisabled());
  // Recall and re-enter: real Ditto sprite, original PP and no stale Choice lock.
  await page.evaluate(()=>window.transformVm.$refs.battleOverlay.setPanel('default'));
  await page.locator('.action-pokemon:enabled').click();await page.locator(`[data-party-uuid="${reserve.uuid}"]`).click();await readyAction();await sprite('player',9);
  assert(!ditto.__battle);assert.deepEqual(ditto.abilities,['Transform']);assert.deepEqual(ditto.movePp,[ability==='Imposter'?10:9]);
  await finish(battle);cases.push({ability,copiedSpeed:200,effectiveSpeed:300,viewports:4,checkpointAndReload:true,ppAndChoiceLock:true,recallRestoresDitto:true});
 }
 // The enemy's transformed front sprite must also change, not only our back sprite.
 const own=factory.create(9,40,true),opponent=factory.create(132,40,true);own.abilities=['Splash'];own.movePp=[40];own.passiveAbility=null;opponent.passiveAbility='Imposter';opponent.abilities=['Transform'];opponent.movePp=[10];p.equipe.pokemons=[own];
 const battle=cleanup.runtime.battle(p,{npc:true,equipe:{pokemons:[opponent]},drifts:[],equipped:[]},'wild');await readyAction();await sprite('wild',9);assert.equal(opponent.data.id,132);assert.equal(opponent.__battle.transformSpriteId,9);await finish(battle);
 assert.deepEqual(errors,[]);success=true;const result={cases,enemyFrontSprite:true,errors,output};fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{if(!success&&page)await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});await browser?.close();cleanup();await new Promise(r=>io.close(r));if(userId)await dbPool.execute('DELETE FROM users WHERE id=?',[userId]);await dbPool.end();}})().catch(e=>{console.error(e.stack);process.exitCode=1});
