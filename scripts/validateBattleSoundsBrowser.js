// Real Web Audio rendering and trusted gestures on a private test server.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
if(!/test/i.test(process.env.DB_TEST_NAME||''))throw Error('Dedicated test database required');
process.env.DB_NAME=process.env.DB_TEST_NAME;process.env.NODE_ENV='test';
const express=require('express'),{Server}=require('socket.io'),{chromium}=require('playwright');
const {dbPool}=require('../server/config/database'),factory=require('../server/game/drift/pokemonFactory');
const dist=process.env.RELEASE_DIST_DIR||'/tmp/riftmon-battle-sounds-dist',output=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-battle-sounds-browser';fs.mkdirSync(output,{recursive:true});
const app=express(),server=http.createServer(app),io=new Server(server);app.use(express.json());app.use('/api',require('../server/http/routes'));app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));
const cleanup=require('../server/realtime/driftLobbyHandler').registerDriftLobbies(io,{checkpointRepository:{async save(){}},runtimeOptions:{random:()=>.9,paceMs:0}});
let browser,page,userId,success=false;const errors=[];
function mon(id,move){const p=factory.create(id,20,true);p.passiveAbility=null;p.abilities=[move];p.movePp=[40];p.currentHp=p.maxHp=1000;return p;}
(async()=>{try{
 server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 const response=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'sounds_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(response.status,201);const u=await response.json();userId=u.user.id;
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true});await context.addInitScript(s=>localStorage.setItem('explorakit.user',JSON.stringify(s)),{...u.user,token:u.token});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/colosseum',{waitUntil:'networkidle'});await page.locator('[data-colosseum-start]:enabled').click();await page.locator('[data-starter-choice]').first().click();await page.locator('.starter-backdrop').waitFor({state:'hidden'});await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(v?.socket?.connected){window.combatVm=v;return true;}});
 const p=cleanup.runtime.playerFor({id:userId});p.equipe.pokemons=[mon(7,'Water Gun')];p.run.phase='exploration';p.run.endsAt=Date.now()+3600000;cleanup.runtime.send(p);
 const battle=cleanup.runtime.battle(p,{npc:true,equipe:{pokemons:[mon(19,'Splash')]},drifts:[],equipped:[]},'trainer');await page.locator('.action-attack:enabled').tap();
 await page.waitForFunction(()=>window.combatVm.$refs.battleOverlay._battleAudio.context?.state==='running');
 await page.evaluate(()=>{
  const b=window.combatVm.$refs.battleOverlay,a=b._battleAudio;window.soundTrace=[];window.soundCreated=0;
  const voice=a.voice,move=a.move,impact=a.impact;
  a.voice=function(...args){window.soundCreated++;return voice.apply(this,args);};
  for(const[name,original]of[['move',move],['impact',impact]])a[name]=function(payload){const before=window.soundCreated;original.call(this,payload);window.soundTrace.push({stage:name,name:payload.moveName,type:payload.moveType,time:performance.now(),audioTime:this.context.currentTime,voices:window.soundCreated-before,visualStage:b.battleMoveFx.stage,enemyHp:b.opponent?.currentHp});};
  window.restoreSoundTrace=()=>{a.voice=voice;a.move=move;a.impact=impact;};
 });
 await page.locator('.battle-grid-attacks .battle-choice-btn:enabled').first().tap();await page.waitForFunction(()=>window.soundTrace.some(e=>e.stage==='impact'&&e.name==='Water Gun'&&e.voices>0));await page.locator('.action-attack:enabled').waitFor();
 const actual=await page.evaluate(()=>{const cast=window.soundTrace.find(e=>e.name==='Water Gun'&&e.stage==='move'),impact=window.soundTrace.find(e=>e.name==='Water Gun'&&e.stage==='impact');window.restoreSoundTrace();return{cast,impact};});assert(actual.cast.voices>0&&actual.impact.voices>0);assert(actual.impact.time-actual.cast.time>=500);assert.equal(actual.impact.visualStage,'impact');
 battle.finish(null,'fled');await page.locator('[data-battle-result-continue]').click();await page.locator('.battle-scene').waitFor({state:'hidden'});
 await page.evaluate(async()=>{
  const v=window.combatVm;v.battle=true;await v.$nextTick();const b=v.$refs.battleOverlay;b.resetBattleUi();b.entrancePhase='ready';
  const own={uuid:'audio-own',name:'Carapuce',data:{id:7},level:20,k:1,currentHp:80,maxHp:100,abilities:['Tackle'],movePp:[35]},enemy={...own,uuid:'audio-enemy',name:'Salamèche',data:{id:4},currentHp:100};
  window.soundState=()=>({player:{equipe:{pokemons:[structuredClone(own)]}},wildPokemon:structuredClone(enemy)});b.updateBattleState(window.soundState());
  const a=b._battleAudio;window.soundSample=async payload=>{a.stop();await new Promise(r=>setTimeout(r,100));const analyser=a.context.createAnalyser();analyser.fftSize=2048;a.output.connect(analyser);b.playMoveAnimation(payload);let peak=0,sum=0,n=0;const data=new Float32Array(analyser.fftSize);for(let i=0;i<15;i++){await new Promise(r=>setTimeout(r,25));analyser.getFloatTimeDomainData(data);for(const x of data){peak=Math.max(peak,Math.abs(x));sum+=x*x;n++;}}const voices=a.voices.size;a.stop();a.output.disconnect(analyser);analyser.disconnect();return{peak,rms:Math.sqrt(sum/n),voices,visual:b.battleMoveFx.visible};};
 });
 const signals=[];for(const[moveName,moveType,damageClass]of[['Tackle','Normal','physical'],['Flamethrower','Fire','special'],['Surf','Water','special'],['Thunderbolt','Electric','special'],['Ice Beam','Ice','special'],['Crunch','Dark','physical'],['Giga Drain','Grass','special'],['Protect','Normal','status']]){const sample=await page.evaluate(payload=>window.soundSample(payload),{moveName,moveType,damageClass});assert(sample.peak>.008&&sample.rms>.001,JSON.stringify({moveName,sample}));signals.push({moveName,...sample});}
 await page.evaluate(()=>window.combatVm.updatePreferences({...window.combatVm.preferences,animationsEnabled:false}));const noAnimations=await page.evaluate(()=>window.soundSample({moveName:'Surf',moveType:'Water',damageClass:'special'}));assert(noAnimations.peak>.008&&!noAnimations.visual);
 await page.evaluate(()=>window.combatVm.updatePreferences({...window.combatVm.preferences,animationsEnabled:true}));await page.emulateMedia({reducedMotion:'reduce'});const reduced=await page.evaluate(()=>window.soundSample({moveName:'Thunderbolt',moveType:'Electric',damageClass:'special'}));assert(reduced.peak>.008&&!reduced.visual);await page.emulateMedia({reducedMotion:'no-preference'});
 await page.locator('.battle-sound-toggle').tap();const muted=await page.evaluate(()=>window.soundSample({moveName:'Surf',moveType:'Water',damageClass:'special'}));assert.equal(muted.peak,0);await page.locator('.battle-sound-toggle').tap();
 await page.evaluate(()=>window.combatVm.updatePreferences({...window.combatVm.preferences,masterVolume:0}));const zero=await page.evaluate(()=>window.soundSample({moveName:'Surf',moveType:'Water',damageClass:'special'}));assert.equal(zero.peak,0);await page.evaluate(()=>window.combatVm.updatePreferences({...window.combatVm.preferences,masterVolume:35}));
 const background=await page.evaluate(async()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));const result=await window.soundSample({moveName:'Surf',moveType:'Water',damageClass:'special'});delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));return result;});assert.equal(background.peak,0);
 const offline=await page.evaluate(async()=>{
  const Constructor=window.combatVm.$refs.battleOverlay._battleAudio.constructor,results=[];
  const types=['Normal','Fighting','Fire','Water','Electric','Grass','Ice','Flying','Poison','Ground','Rock','Bug','Psychic','Ghost','Dark','Dragon','Steel','Fairy'];
  const profiles=[...types.map(moveType=>({name:moveType,payload:{moveName:'Shadow Ball',moveType,damageClass:'special'}})),...['Crunch','Slash','Mach Punch','Tackle','Ice Beam','Shadow Ball','Giga Drain','Earthquake','Purify','Protect'].map(moveName=>({name:moveName,payload:{moveName,moveType:'Normal'}})),{name:'multi-hit',stage:'impact',payload:{moveName:'Fury Swipes',result:{damage:30,hits:6}}},{name:'charge-turn',payload:{moveName:'Solar Beam',moveType:'Grass',damageClass:'special',phase:'prepare'}}];
  for(const profile of profiles){const context=new OfflineAudioContext(1,44100,44100),a=new Constructor(()=>context);a.setVolume(1);await a.unlock();a.ready=()=>true;if(profile.stage==='impact')a.impact(profile.payload);else a.move(profile.payload);const buffer=await context.startRendering(),data=buffer.getChannelData(0);let peak=0,sum=0,tail=0;for(let i=0;i<data.length;i++){peak=Math.max(peak,Math.abs(data[i]));sum+=data[i]*data[i];if(i>data.length*.9)tail=Math.max(tail,Math.abs(data[i]));}results.push({name:profile.name,peak,rms:Math.sqrt(sum/data.length),tail,voicesRemaining:a.voices.size});a.dispose();}
  return results;
 });
 for(const sample of offline){assert(sample.peak>.04&&sample.peak<.98,JSON.stringify(sample));assert(sample.rms>.002);assert(sample.tail<.0001);assert.equal(sample.voicesRemaining,0);}
 await page.evaluate(()=>{const b=window.combatVm.$refs.battleOverlay;b.playMoveAnimation({moveName:'Earthquake',moveType:'Ground',damageClass:'physical'});if(!b._battleAudio.voices.size)throw Error('Cancellation fixture silent');b.resetBattleUi();if(b._battleAudio.voices.size||b.moveAudio)throw Error('Stale audio after battle cancellation');window.combatVm.battle=false;});
 const timeline=await require('./validateBattleTimeline').validateBattleTimeline(page,output);const moveLibrary=await require('./validateMoveLibraryUi').validateMoveLibraryUi(page,output);
 assert.deepEqual(errors,[]);success=true;console.log(JSON.stringify({trustedGestureUnlock:true,realTurnSynchronized:actual,signals,offlineProfiles:offline,animationsOffStillAudible:true,reducedMotionStillAudible:true,mute:true,masterVolume:true,backgroundSilence:true,cancellation:true,timeline,moveLibrary,errors,output}));
 }finally{if(!success&&page)await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});await browser?.close();cleanup();await new Promise(r=>io.close(r));if(userId)await dbPool.execute('DELETE FROM users WHERE id=?',[userId]);await dbPool.end();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
