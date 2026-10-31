// Disposable accounts and a private test server; never changes a live player.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(!/test/i.test(process.env.DB_TEST_NAME||''))throw Error('Dedicated test database required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';
const express=require('express'),{Server}=require('socket.io'),{chromium}=require('playwright');
const {dbPool}=require('../server/config/database'),factory=require('../server/game/drift/pokemonFactory');
const dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-trainer-party-dist',output=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-trainer-party-browser';fs.mkdirSync(output,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server);app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));
const cleanup=require('../server/realtime/driftLobbyHandler').registerDriftLobbies(io,{checkpointRepository:{async save(){}},runtimeOptions:{random:()=>.9,paceMs:0}});
let browser,page,userId,success=false;const errors=[];
function mon(id){const p=factory.create(id,20,true);p.passiveAbility=null;p.abilities=['Splash'];p.movePp=[40];return p;}
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(v?.socket?.connected){window.partyVm=v;return true;}});}
async function row(alive,total){await page.waitForFunction(({alive,total})=>{const el=document.querySelector('[data-opponent-party]');return el?.querySelectorAll('[data-party-state]:not([data-party-state="ko"])').length===alive&&el.querySelectorAll('[data-party-state]').length===total;},{alive,total});}
async function closeResult(){await page.locator('[data-battle-result-continue]').click();await page.locator('.battle-scene').waitFor({state:'hidden'});}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 const res=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'balls_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(res.status,201);const u=await res.json();userId=u.user.id;
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true});await context.addInitScript(s=>localStorage.setItem('explorakit.user',JSON.stringify(s)),{...u.user,token:u.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/colosseum',{waitUntil:'networkidle'});await page.locator('[data-colosseum-start]:enabled').click();await page.locator('[data-starter-choice]').first().click();await page.locator('.starter-backdrop').waitFor({state:'hidden'});await ready();
 const p=cleanup.runtime.playerFor({id:userId});p.equipe.pokemons=[mon(7),mon(4)];const lead=p.equipe.pokemons[0];lead.abilities=['Dragon Rage'];lead.movePp=[10];lead.currentSpeed=999;lead.currentHp=lead.maxHp=1000;
 p.run.phase='exploration';p.run.endsAt=Date.now()+3600000;cleanup.runtime.send(p);
 const enemy={npc:true,equipe:{pokemons:[19,16,25,1,4,7].map(mon)},drifts:[],equipped:[]};enemy.equipe.pokemons.forEach(p=>{p.currentHp=1;p.currentSpeed=1;});
 const battle=cleanup.runtime.battle(p,enemy,'arena','party_test');await row(6,6);await page.locator('.action-attack:enabled').click();await page.locator('.battle-grid-attacks .battle-choice-btn:enabled').first().click();await row(5,6);await page.locator('.action-attack:enabled').waitFor();assert.equal(enemy.equipe.pokemons.length,5);
 const geometry=[];
 for(const[width,height]of[[320,480],[393,852],[844,390],[1365,900]]){
  await page.setViewportSize({width,height});await page.waitForTimeout(120);
  for(const theme of['light','dark']){
   await page.evaluate(theme=>document.documentElement.setAttribute('data-game-theme-mode',theme),theme);
   const bounds=await page.evaluate(()=>{const ball=document.querySelector('[data-opponent-party]'),scene=document.querySelector('.battle-scene'),actions=document.querySelector('.battle-action-shell'),card=document.querySelector('.battle-status-wild');const rect=n=>n.getBoundingClientRect().toJSON(),before=rect(actions);ball.style.display='none';const without=rect(actions);ball.style.display='';return{ball:rect(ball),scene:rect(scene),card:rect(card),before,without,ko:getComputedStyle(ball.querySelector('.is-fainted .ball-top')).fill,ready:getComputedStyle(ball.querySelector('.party-ball:not(.is-fainted) .ball-top')).fill};});
   assert(bounds.ball.left>=bounds.scene.left&&bounds.ball.right<=bounds.scene.right+1);assert(bounds.ball.bottom<=bounds.scene.bottom+1,JSON.stringify({width,bounds}));assert(bounds.ball.top>=bounds.card.bottom);
   assert.equal(bounds.before.y,bounds.without.y);assert.equal(bounds.before.height,bounds.without.height);assert.notEqual(bounds.ko,bounds.ready);assert.match(await page.locator('[data-opponent-party]').getAttribute('aria-label'),/5 Pokémon encore aptes sur 6/);
   geometry.push({width,theme,height:bounds.ball.height,actionsUnchanged:true});await page.screenshot({path:path.join(output,`party-${theme}-${width}.png`)});
  }
 }
 await page.setViewportSize({width:393,height:852});await page.reload({waitUntil:'networkidle'});await ready();await row(5,6);
 battle.finish(null,'fled');await page.locator('[data-battle-result-continue]').waitFor();await closeResult();
 const wild=cleanup.runtime.battle(p,{npc:true,equipe:{pokemons:[mon(19)]},drifts:[],equipped:[]},'wild');await page.locator('.action-attack:enabled').waitFor();assert.equal(await page.locator('[data-opponent-party]').count(),0);wild.finish(null,'fled');await page.locator('[data-battle-result-continue]').waitFor();await closeResult();
 const trainer=cleanup.runtime.battle(p,{npc:true,equipe:{pokemons:[mon(19),mon(16),mon(25)]},drifts:[],equipped:[]},'trainer');await row(3,3);trainer.finish(null,'fled');await page.locator('[data-battle-result-continue]').waitFor();await closeResult();
 assert.deepEqual(errors,[]);success=true;console.log(JSON.stringify({realSixMemberTrainer:true,realKnockout:true,removedMembersRetainGreyBall:true,reconnect:true,wildHasNoBalls:true,newBattleResets:true,controlsStayFixed:true,viewports:4,themes:2,geometry,errors,output}));
 }finally{if(!success&&page)await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});await browser?.close();cleanup();await new Promise(r=>io.close(r));if(userId)await dbPool.execute('DELETE FROM users WHERE id=?',[userId]);await dbPool.end();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
