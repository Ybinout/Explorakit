// Isolated SQL account and real Socket battles; no fixture endpoints in production.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(!/test/i.test(process.env.DB_TEST_NAME||''))throw Error('Dedicated test database required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';
const express=require('express'),{Server}=require('socket.io'),{chromium}=require('playwright');
const {dbPool}=require('../server/config/database'),factory=require('../server/game/drift/pokemonFactory'),engine=require('../server/game/battle/battleEngine');
const output=process.env.RELEASE_SCREENSHOTS||'/tmp/explorakit-castform-browser',dist=process.env.RELEASE_DIST_DIR||'/tmp/explorakit-castform-dist';fs.mkdirSync(output,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server,{path:'/explorakit/socket.io'});app.use(express.json());app.use('/explorakit/api',require('../server/http/routes'));app.use('/explorakit',express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));
let checkpoint;const cleanup=require('../server/realtime/driftLobbyHandler').registerDriftLobbies(io,{runtimeOptions:{paceMs:0,random:()=>.9},checkpointRepository:{async save(bytes){checkpoint=bytes;}}});
let browser,page,userId,success=false;const errors=[];
async function ready(){await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(!v?.socket?.connected)return false;window.castVm=v;return true;});}
async function attack(index){await page.locator('.action-attack:enabled').click();await page.locator('.battle-grid-attacks button').nth(index).click();}
async function show(sprite,type){
 await page.waitForFunction(({sprite,type})=>{const b=window.castVm.$refs.battleOverlay;return b?.canChooseAction&&b.currentPokemon?.__battle?.formSpriteId===(sprite===351?null:sprite)&&b.moveButtonType(0)===type;},{sprite,type});
 for(const side of ['player','wild'])await page.waitForFunction(({side,sprite})=>{const img=document.querySelector('.battle-sprite-'+side+' img');return img?.src.endsWith('/'+sprite+'.png')&&img.complete&&img.naturalWidth>0;},{side,sprite});
 await page.locator('.action-attack:enabled').click();assert.equal(await page.locator('.battle-grid-attacks button').first().getAttribute('data-move-type'),type);
}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}/explorakit`;
 const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'castform_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(r.status,201);const fixture=await r.json();userId=fixture.user.id;
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true});await context.addInitScript(s=>localStorage.setItem('explorakit.user',JSON.stringify(s)),{...fixture.user,token:fixture.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().startsWith(base)&&r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
 await page.goto(base+'/colosseum',{waitUntil:'networkidle'});await page.locator('[data-colosseum-start]:enabled').click();await page.locator('[data-starter-choice]').first().click();await page.locator('.starter-backdrop').waitFor({state:'hidden'});await ready();
 const p=cleanup.runtime.playerFor({id:userId}),cast=factory.create(351,40,true),enemy=factory.create(351,40,true);
 cast.passiveAbility=enemy.passiveAbility='Forecast';cast.abilities=['Weather Ball','Sunny Day','Hail','Sandstorm'];cast.movePp=[10,5,10,10];enemy.abilities=['Splash'];enemy.movePp=[40];enemy.maxHp=enemy.currentHp=10000;p.equipe.pokemons=[cast];p.currentmap='start';
 const battle=cleanup.runtime.battle(p,{npc:true,equipe:{pokemons:[enemy]},drifts:[],equipped:[]},'wild');
 for(const [weather,sprite,type,index]of [['rain',10014,'Water',null],['sun',10013,'Fire',1],['hail',10015,'Ice',2],['sandstorm',351,'Rock',3],[null,351,'Normal',0]]){
  if(index!==null){if(weather===null)battle.state.weather.turns=1;await attack(index);}
  await show(sprite,type);assert.equal(battle.state.weather.kind,weather);assert.equal(cast.data.id,351);assert.equal(cast.type1,'Normal');
  for(const [width,height]of [[320,480],[393,852],[844,390],[1365,900]]){
   await page.setViewportSize({width,height});await page.evaluate(width=>{window.castVm.showMobileControls=width<=920;},width);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   for(const side of ['player','wild'])assert(await page.locator('.battle-sprite-'+side+' img').evaluate(img=>img.complete&&img.naturalWidth>0));
   await page.screenshot({path:path.join(output,`castform-${weather||'clear'}-${width}.png`)});
  }
 }
 // An ability suppressor cancels weather effects without deleting the weather.
 battle.state.weather={kind:'rain',turns:5};enemy.passiveAbility='Cloud Nine';engine.applySwitchInEffects(enemy,battle.sides[1],battle.sides[0],battle.state,cast);battle.sync();
 await show(351,'Normal');assert.equal(battle.state.weather.kind,'rain');
 enemy.passiveAbility='Forecast';engine.applySwitchInEffects(enemy,battle.sides[1],battle.sides[0],battle.state,cast);battle.sync();await show(10014,'Water');
 await cleanup.checkpoint();const saved=require('../server/game/drift/checkpointCodec').decode(checkpoint).runs.get(p.run.id).players.get(userId).equipe.pokemons[0];assert.equal(saved.__battle.formSpriteId,10014);assert.equal(saved.data.id,351);
 await page.reload({waitUntil:'networkidle'});await ready();await show(10014,'Water');await page.screenshot({path:path.join(output,'castform-rain-reload.png')});
 battle.finish(null,'fled');await page.locator('[data-battle-result-continue]').click();assert(!cast.__battle);assert.equal(cast.type1,'Normal');assert.equal(cast.data.id,351);
 assert.deepEqual(errors,[]);success=true;console.log(JSON.stringify({weatherCases:5,viewports:4,frontAndBackSprites:true,actualWeatherMoves:true,weatherBallButtonTypes:true,cloudNine:true,checkpointAndReload:true,permanentSpeciesPreserved:true,errors,output}));
}finally{if(!success&&page)await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});await browser?.close();cleanup();await new Promise(r=>io.close(r));if(userId)await dbPool.execute('DELETE FROM users WHERE id=?',[userId]);await dbPool.end();}})().catch(e=>{console.error(e.stack);process.exitCode=1});
