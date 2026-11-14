const assert=require('node:assert/strict');
const catalogue=require('../vue-explorakit/src/data/combatAudio.json');
exports.instrument=async function(page){await page.evaluate(()=>{
 const overlay=v.$refs.battleOverlay,bank=overlay._battleAudio.samples,play=bank.play.bind(bank);window.sampleTrace=[];window.sampleAttempts=[];const original=overlay.playBattleSample;overlay.playBattleSample=function(p){sampleAttempts.push({kind:p.kind,id:p.pokemon?.pokemonId||p.pokemon?.data?.id,hidden:document.hidden,enabled:this.soundEnabled,volume:this.audioVolume});return original.call(this,p);};
 bank.play=(file,options)=>{const at=performance.now(),raid=document.querySelector('[data-raid-battle]'),double=document.querySelector('[data-double-battle]'),mode=raid?'r':double?'d':'b',vm=(raid||double)?.__vue__||window.b,stage=mode==='b'?vm?.battleMoveFx?.stage:vm?.fx?.stage;const clocks=options?.kind==='cry'?[...document.querySelectorAll('[data-battle-send-out]:not(.is-recall)')].map(n=>({side:n.dataset.side,time:n.querySelector('.send-out-flash').getAnimations?.()[0]?.currentTime})):[];const played=play(file,options);sampleTrace.push({file,kind:options?.kind,at,mode,played,stage,clocks,scheduledDelay:bank.channels.get(options?.kind)?.start-bank.audio.context.currentTime,channels:bank.channels.size});return played;};
 window.entryVisuals=[];document.addEventListener('animationstart',e=>{if(e.animationName.startsWith('send-out-bloom')&&!e.target.closest('.is-recall'))entryVisuals.push({at:performance.now(),side:e.target.closest('[data-battle-send-out]')?.dataset.side});},true);
 });};
exports.native=async function({page,mode,width,checks}){
 const data=await page.evaluate(mode=>({cries:sampleTrace.filter(e=>e.kind==='cry'&&e.mode===mode),moves:sampleTrace.filter(e=>e.kind==='move'&&e.mode===mode),attempts:sampleAttempts.filter(e=>e.kind==='cry'),visuals:entryVisuals.slice(-6)}),mode);
 assert(data.cries.some(e=>e.played&&e.file===(mode==='d'?'cries/9.mp3':'cries/131.mp3')),JSON.stringify(data));assert(data.moves.some(e=>e.played&&e.stage==='windup'),JSON.stringify(data));
 if(mode==='r'){const lengths=await page.evaluate(async()=>{const n=sampleTrace.filter(e=>e.kind==='cry').length;await r.focusAlly(2);await r.focusAlly(0);return[n,sampleTrace.filter(e=>e.kind==='cry').length];});assert.equal(lengths[0],lengths[1]);}
 checks.push('native-cry-entry-and-move-launch-'+mode+'-'+width);
};
exports.verify=async function({page,fixture,shot,checks,measurements}){
 const files=[...new Set([...Object.values(catalogue.moves).map(m=>m.file),...Object.values(catalogue.cries)].filter(Boolean))];
 const resources=await page.evaluate(async files=>{
  const context=new OfflineAudioContext(1,1,32000),failures=[];let decoded=0,peak=0,longest=0;
  for(let i=0;i<files.length;i+=4)await Promise.all(files.slice(i,i+4).map(async file=>{try{
   const response=await fetch('/audio/combat/v1/'+file);if(!response.ok)throw Error('HTTP '+response.status);const buffer=await context.decodeAudioData(await response.arrayBuffer());if(!(buffer.duration>0&&buffer.duration<10))throw Error('duration');let max=0,sum=0;const a=buffer.getChannelData(0);for(const x of a){max=Math.max(max,Math.abs(x));sum+=x*x;}if(max<.001||max>1||sum/a.length<1e-8)throw Error('signal '+max);decoded++;peak=Math.max(peak,max);longest=Math.max(longest,buffer.duration);
  }catch(e){failures.push({file,error:e.message});}}));return{decoded,peak,longest,failures};
 },files);assert.deepEqual(resources.failures,[]);assert.equal(resources.decoded,1432);measurements.push({allAudioResources:resources});checks.push('all-1432-local-mp3-samples-decode-with-non-silent-bounded-signal');

 for(const mirrored of [false,true]){
  const state=await fixture();await page.evaluate(async({state,mirrored})=>{
   window.audioMode='b';if(mirrored){const a=state.player.equipe.pokemons[0],foe=state.wildPokemon;state.player.equipe.pokemons[0]=foe;state.wildPokemon=a;b.updateBattleState(state);}
   const a=state.player.equipe.pokemons[0],foe=state.wildPokemon;window.sampleStart=sampleTrace.length;window.visualStart=entryVisuals.length;
   window.entryDone=b.presentState({...state,transitions:[{kind:'enter',side:'player',uuid:a.uuid,name:a.name},{kind:'enter',side:'opponent',uuid:foe.uuid,name:foe.name}]});
  },{state:state.initial,mirrored});await page.waitForFunction(()=>b.sendOuts.length===2);await page.waitForTimeout(420);await shot('pokemon-entry-'+(mirrored?'pvp-mirrored':'own'));await page.evaluate(()=>entryDone);
  const entry=await page.evaluate(()=>({sounds:sampleTrace.slice(sampleStart).filter(e=>e.kind==='cry'),visuals:entryVisuals.slice(visualStart)}));assert.equal(entry.sounds.length,1);assert(entry.sounds[0].played);assert.equal(entry.sounds[0].file,mirrored?'cries/143.mp3':'cries/9.mp3');assert(Math.abs(entry.sounds[0].scheduledDelay-.34)<.02,JSON.stringify(entry));
 }
 checks.push('simultaneous-entrances-play-only-own-cry-in-both-pvp-perspectives-on-bloom');

 const state=await fixture();await page.evaluate(initial=>{window.audioMode='b';window.sampleStart=sampleTrace.length;const p={...initial.wildPokemon,uuid:'audio-enemy-switch',data:{...initial.wildPokemon.data,id:65}};window.switchDone=b.presentState({...initial,wildPokemon:p,transitions:[{kind:'recall',side:'opponent',uuid:initial.wildPokemon.uuid,name:'Ronflex'},{kind:'enter',side:'opponent',uuid:p.uuid,name:'Alakazam'}]});},state.initial);
 await page.waitForFunction(()=>b.transitionFx.wild==='recall');await page.waitForTimeout(170);await shot('pokemon-switch-recall');await page.waitForFunction(()=>b.sendOuts.some(e=>!e.recall));await page.waitForTimeout(430);await shot('pokemon-switch-send');await page.evaluate(()=>switchDone);const switched=await page.evaluate(()=>sampleTrace.slice(sampleStart).filter(e=>e.kind==='cry'));assert.equal(switched.length,1);assert.equal(switched[0].file,'cries/65.mp3');assert(switched[0].played);checks.push('single-opponent-switch-has-recall-light-new-ball-and-one-opponent-cry');

 for(const [width,type]of [[320,'pokeball'],[393,'master_ball'],[1365,'corrupted_ball_ghost']]){
  await page.setViewportSize({width,height:width===320?568:width===393?852:900});await fixture();await page.evaluate(type=>{window.captureDone=b.playCaptureAnimation({itemKey:type,itemName:'Ball',success:true,shakes:3});},type);
  await page.waitForTimeout(210);const ballUid=await page.locator('.capture-fx-ball svg').evaluate(n=>n.__vue__._uid);await shot('capture-arc-'+width);assert.equal(await page.locator('.capture-fx-ball .poke-ball-visual').count(),1);
  await page.waitForFunction(()=>b.captureFx.state==='absorb');assert.equal(await page.locator('.capture-fx-ball svg').evaluate(n=>n.__vue__._uid),ballUid);assert(await page.locator('.capture-fx-ball .poke-ball-visual').evaluate(n=>n.classList.contains('is-open')));await page.waitForTimeout(70);await shot('capture-opening-absorption-'+width);
  await page.evaluate(()=>captureDone);assert.deepEqual(await page.evaluate(()=>({state:b.captureFx.state,contained:b.captureFx.targetContained,opacity:getComputedStyle(document.querySelector('.battle-sprite-wild .battle-sprite')).opacity})),{state:'caught',contained:true,opacity:'0'});await shot('capture-contained-'+width);
 }
 checks.push('capture-trajectory-open-absorb-close-shake-and-success-keeps-pokemon-contained-on-three-sizes');
 await fixture();const balls=require('../data/game/items.json').items.filter(i=>i.category==='ball');const designs=[];for(const ball of balls){await page.evaluate(async type=>{b.captureFx={...b.captureFx,visible:true,state:'caught',ballType:type,targetContained:true,path:b.buildCapturePath()};await b.$nextTick();},ball.key);designs.push(await page.locator('.capture-fx-ball svg').evaluate(n=>({accent:getComputedStyle(n).getPropertyValue('--ball-accent'),paths:n.querySelectorAll('path').length})));}assert(designs.every(d=>d.paths>=4&&d.accent));assert(new Set(designs.map(d=>d.accent)).size>18);checks.push('all-31-ball-models-render-with-distinct-type-accents-and-vector-details');

 await fixture();await page.evaluate(()=>{window.sampleStart=sampleTrace.length;window.captureDone=b.playCaptureAnimation({itemKey:'superball',success:false,shakes:1});});await page.evaluate(()=>captureDone);assert.equal(await page.evaluate(()=>b.captureFx.targetContained),false);assert(await page.evaluate(()=>sampleTrace.slice(sampleStart).some(e=>e.kind==='cry'&&e.played)));checks.push('failed-capture-releases-sprite-and-replays-its-cry');
 await fixture();await page.evaluate(async()=>{await b.prepareSamples({moves:['Thunderbolt']});window.sampleStart=sampleTrace.length;b.playMoveAnimation({moveName:'Thunderbolt',actor:'player'});});const launch=await page.evaluate(()=>sampleTrace.slice(sampleStart).find(e=>e.kind==='move'));assert(launch.played&&launch.stage==='windup');
 await page.evaluate(()=>{b.clearMoveFx();b.playMoveAnimation({moveName:'Wave Crash',actor:'player'});});assert(await page.evaluate(()=>sampleTrace.at(-1).kind==='move'&&!sampleTrace.at(-1).file));
 await page.evaluate(()=>{b.resetBattleUi();});const cleanup=await page.evaluate(()=>({channels:b._battleAudio.samples.channels.size,bytes:b._battleAudio.samples.bytes,budget:b._battleAudio.samples.maxBytes}));assert.equal(cleanup.channels,0);assert(cleanup.bytes<=cleanup.budget);measurements.push({sampleCache:cleanup});checks.push('specific-launch-generic-fallback-and-channel-cancellation-preserve-bounded-cache');
};
