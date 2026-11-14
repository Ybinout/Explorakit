const assert=require('node:assert/strict');

exports.instrument=async function(page){
 await page.evaluate(()=>{v.updatePreferences({...v.preferences,masterVolume:35});v.$refs.battleOverlay.soundEnabled=true;});
 await page.mouse.click(2,2);
 await page.waitForFunction(()=>v.$refs.battleOverlay._battleAudio.context?.state==='running');
 await page.evaluate(()=>{
  const a=v.$refs.battleOverlay._battleAudio;window.audioTrace=[];window.audioMode='b';window.audioVoices=0;
  const voice=a.voice.bind(a),impact=a.impact.bind(a),cue=a.cue.bind(a);
  a.voice=(...args)=>{audioVoices++;return voice(...args);};
  const record=(kind,payload,play)=>{
   const before=audioVoices,c=window[audioMode],fx=audioMode==='b'?c?.battleMoveFx:c?.fx;
   const status=audioMode==='b'?Object.values(c?.statusVisuals||{}).filter(Boolean).map(e=>e.status):[c?.statusFx?.status];
   const stats=audioMode==='b'?[...(c?.conditionFx?.player||[]),...(c?.conditionFx?.wild||[])].map(e=>e.kind):[c?.effect?.kind];
   play(payload);audioTrace.push({kind,payload,mode:audioMode,at:performance.now(),stage:fx?.stage,reduced:audioMode==='b'?c?.reducedMotion():c?.reduced,status,stats,voices:audioVoices-before,hp:audioMode==='b'?c?.opponent?.currentHp:audioMode==='d'?c?.display?.active?.map(s=>s.map(p=>p?.currentHp)):c?.display?.allies?.map(p=>p.currentHp)});
  };
  a.impact=p=>record('impact',p,impact);a.cue=p=>record('cue',p,cue);
 });
};

exports.verify=async function({page,fixture,shot,checks,measurements}){
 const trace=await page.evaluate(()=>audioTrace);
 for(const mode of ['b','d','r']){
  const impacts=trace.filter(e=>e.mode===mode&&e.kind==='impact'&&e.payload.direct&&e.voices>0&&!e.reduced);
  assert(impacts.length>0,'no actual impacts in '+mode);assert(impacts.every(e=>e.stage==='impact'),JSON.stringify(impacts));
 }
 assert(trace.some(e=>e.mode==='d'&&e.kind==='impact'&&e.payload.critical&&e.payload.effectiveness<1));
 assert(trace.some(e=>e.mode==='r'&&e.kind==='impact'&&e.payload.critical&&e.payload.effectiveness>1));
 for(const event of trace.filter(e=>e.kind==='cue'&&e.voices>0&&!e.reduced)){
  if(event.payload.kind==='status')assert(event.status.includes(event.payload.status),JSON.stringify(event));
  if(event.payload.kind.startsWith('stat-'))assert(event.stats.includes(event.payload.kind.slice(5))||event.stats.includes(event.payload.kind==='stat-up'?'-boost':'-unboost'),JSON.stringify(event));
 }
 checks.push('audible-native-simple-double-raid-impacts-and-cues-match-visual-phase');
 measurements.push({audioTimeline:trace});

 for(const width of [393,1365]){
  await page.setViewportSize({width,height:width===393?852:900});await fixture();
  const origin=await page.evaluate(async()=>{
   b.playMoveAnimation({moveName:'Thunderbolt',actor:'player'});b.battleMoveFx.stage='travel';await b.$nextTick();
   const own=b.getSpriteGeometry('player'),enemy=b.getSpriteGeometry('wild'),foe=b.buildMovePath('opponent','special','opponent',b.battleMoveFx);
   const canvas=document.querySelector('canvas.move-library').__vue__;canvas._resize.disconnect();const renderer=canvas.renderer;renderer.stop();const duration=renderer.duration(),times=[];
   for(let i=0;i<24;i++){const t=performance.now();renderer.paintAt(duration*(.25+i*.02));times.push(performance.now()-t);}
   renderer.paintAt(duration*.62);times.sort((a,b)=>a-b);
   return{own,enemy,foe,path:b.movePath,particles:renderer.stats.beamParticles,paintMeanMs:times.reduce((a,b)=>a+b,0)/times.length,paintP95Ms:times[Math.floor(times.length*.95)]};
  });
  assert(origin.path.startX>origin.own.centerX);assert(origin.path.startY<origin.own.centerY);assert.equal(origin.foe.startX,origin.enemy.centerX);assert.equal(origin.foe.startY,origin.enemy.centerY);assert(origin.particles>=12&&origin.particles<=32);
  measurements.push({viewport:width,...origin});await shot('thunderbolt-forward-flow-'+width);
 }
 checks.push('forward-allied-origin-unchanged-enemy-and-distributed-thunderbolt-pc-mobile');

 const state=await fixture();
 await page.evaluate(state=>{
  window.audioMode='b';window.missAt=audioTrace.length;
  b.presentEvent('playMoveAnimation',state.animation);b.presentEvent('showMessage',state.line);b.presentEvent('playMoveResult',{...state.result,missed:true,success:false,damage:0,critical:false});b.presentEvent('updateBattleState',state.initial);window.audioMissDone=b._presentation.drain();
 },state);
 await page.evaluate(()=>audioMissDone);const miss=await page.evaluate(()=>audioTrace.slice(missAt));assert.equal(miss.filter(e=>e.kind==='cue'&&e.payload.kind==='miss'&&e.stage==='miss'&&e.voices>0).length,1);assert(!miss.some(e=>e.kind==='impact'));checks.push('miss-sounds-on-miss-visual-once-without-phantom-impact');

 const samples=await page.evaluate(async()=>{
  const Constructor=b._battleAudio.constructor,results=[];
  const cases=[...['resisted','normal','super','critical'].map(name=>({name,impact:{damage:30,maxHp:100,effectiveness:name==='resisted'?.5:name==='super'?2:1,critical:name==='critical'}})),...['stat-up','stat-down','miss'].map(kind=>({name:kind,cue:{kind}})),...['poison','burn','paralysis','freeze','confusion','disable','sleep','attraction','curse','seed','trap','recoil','cure'].map(status=>({name:status,cue:{kind:'status',status}}))];
  for(const entry of cases){
   const Context=window.OfflineAudioContext||window.webkitOfflineAudioContext,context=new Context(1,44100,44100),audio=new Constructor(()=>context);
   audio.context=context;audio.output=context.createGain();audio.output.connect(context.destination);audio.volume=1;audio.ready=()=>true;
   if(entry.impact)audio.impact(entry.impact);else audio.cue(entry.cue);
   const buffer=await context.startRendering(),data=buffer.getChannelData(0);let peak=0,sum=0,tail=0;
   for(let i=0;i<data.length;i++){peak=Math.max(peak,Math.abs(data[i]));sum+=data[i]*data[i];if(i>data.length*.9)tail=Math.max(tail,Math.abs(data[i]));}
   await new Promise(r=>setTimeout(r,0));results.push({name:entry.name,peak,rms:Math.sqrt(sum/data.length),tail,voices:audio.voices.size});audio.dispose();
  }
  return results;
 });
 for(const sample of samples){assert(sample.peak>.01&&sample.peak<.98,JSON.stringify(sample));assert(sample.rms>.001);assert(sample.tail<.0001);assert.equal(sample.voices,0);}
 assert(samples[0].rms<samples[1].rms&&samples[1].rms<samples[2].rms);measurements.push({offlineAudio:samples});checks.push('twenty-real-web-audio-profiles-audible-no-clipping-silent-tail-and-no-node-leak');

 const silence=await page.evaluate(async()=>{
  const a=b._battleAudio;let n=audioVoices;b.soundEnabled=false;b.playCombatCue({kind:'stat-up'});b.playImpact({damage:30,maxHp:100});const muted=audioVoices-n;
  b.soundEnabled=true;v.updatePreferences({...v.preferences,masterVolume:0});await b.$nextTick();n=audioVoices;b.playCombatCue({kind:'status',status:'poison'});const volumeZero=audioVoices-n;
  v.updatePreferences({...v.preferences,masterVolume:35});await b.$nextTick();Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));n=audioVoices;b.playCombatCue({kind:'stat-up'});const hidden=audioVoices-n;delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));
  v.updatePreferences({...v.preferences,animationsEnabled:false});n=audioVoices;b.playStatusVisual('player',{status:'freeze'});const reduced=audioVoices-n;b.resetBattleUi();return{muted,volumeZero,hidden,reduced,remaining:a.voices.size};
 });
 assert.deepEqual(silence,{muted:0,volumeZero:0,hidden:0,reduced:3,remaining:0});checks.push('mute-volume-background-cancel-and-animation-independent-sound');
};
