const assert=require('node:assert/strict');

exports.native=async function({page,mode,width,checks,measurements,shot}){
 await page.waitForTimeout(100);
 const shape=await page.evaluate(mode=>{
  const vm=window[mode],root=vm.$el,grounds=[...root.querySelectorAll('[data-player-ground]')].map(n=>({width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height,measured:n.__vue__.measured,background:getComputedStyle(n).backgroundColor}));
  const fills=[...root.querySelectorAll('.health-fluid')].map(n=>({width:n.getBoundingClientRect().width,before:getComputedStyle(n,'::before').animationName,after:getComputedStyle(n,'::after').animationName}));
  return{grounds,fills,bossFluid:root.querySelectorAll('.raid-boss-health .health-fluid').length,otherGaugesFluid:root.querySelectorAll('.raid-card-threat .health-fluid,.raid-shield-bar .health-fluid').length};
 },mode);
 assert.equal(shape.grounds.length,mode==='d'?2:1);assert(shape.grounds.every(p=>p.width>=129&&p.height>=29&&p.measured?.width>0));assert(shape.fills.length>=(mode==='d'?4:6));assert(shape.fills.every(f=>f.before==='health-current'&&f.after==='health-wave'));assert.equal(shape.otherGaugesFluid,0);if(mode==='r')assert.equal(shape.bossFluid,1);
 measurements.push({mode,width,nativeLiving:shape});await shot('living-'+mode+'-'+width);checks.push('native-ground-and-fluid-hp-'+mode+'-'+width);
 if(mode==='r')for(const id of ['dark-continent2','dark-pyramid']){
  await page.evaluate(id=>{v.raidState={...v.raidState,rift:{...v.raidState.rift,map:'DC2_48',difficulty:{id:id==='dark-pyramid'?'dc2-final':'hard'}}};},id);
  await page.waitForFunction(id=>document.querySelector('[data-battle-ambience]')?.dataset.battleAmbience===id&&document.querySelector('[data-battle-ambience]')?.__vue__?.renderer?.profile,id,{timeout:10000});
  await shot('living-'+id+'-'+width);
 }
};

const maps={grass:'route1',lake:'ville1','lake-gym':'ville1_arene','raph-gym':'gen_arene5','hoze-gym':'ville_safe1_arene','ana-gym':'ville3_arene','wanda-gym':'ville4_arene','7p-gym':'ville5_arene','whitepeak-club':'ville5_maison1','super-tournament':'super_tournament_room','draft-house':'draft_house',colosseum:'route1',cave:'cave1',snow:'route13','professor-lab':'professor_lab','lucie-house':'route2_maison','gwenn-house':'route4_maison','void-arena':'void_arena','dark-jungle':'jungle1','dark-continent2':'DC2_01'};
exports.verify=async function({page,fixture,shot,checks,measurements}){
 await fixture();await page.evaluate(()=>{b.music={paused:true,pause(){},play(){return Promise.resolve();},volume:0};});
 const music=await page.evaluate(()=>{const values={};for(const kind of ['wild','trainer','pvp','raid']){b.musicKind=kind;b.syncMusic();values[kind]=b.music.volume;}b.music=null;return{values,master:b.audioVolume};});
 for(const [kind,volume]of Object.entries(music.values))assert(Math.abs(volume-music.master*(kind==='wild'?.24:.4)*.75)<1e-9);checks.push('music-is-exactly-25-percent-lower-in-every-shared-battle-mode');

 for(const width of [393,1365]){
  await page.setViewportSize({width,height:width===393?852:900});
  for(const [environment,map]of Object.entries(maps)){
   await fixture();await page.evaluate(async({environment,map})=>{b.battleMapName=map;b.challenge=environment==='colosseum'?{name:'Arène'}:null;b.encounterEnvironment=environment==='lake'?'lake':null;await b.$nextTick();}, {environment,map});
   await page.waitForFunction(environment=>{const n=document.querySelector('[data-battle-ambience]')?.__vue__;return n?.renderer?.environment===environment&&n.renderer.profile&&n.renderer.width>0;},environment,{timeout:12000});
   const scene=await page.evaluate(()=>{
    const vm=document.querySelector('[data-battle-ambience]').__vue__,r=vm.renderer;vm.observer.disconnect();cancelAnimationFrame(vm.frame);vm.frame=0;
    const times=[];for(let i=0;i<25;i++){const start=performance.now();r.paintAt(1200+i*100);times.push(performance.now()-start);}times.sort((a,b)=>a-b);
    r.paintAt(1200);const first=r.c.getImageData(0,0,r.canvas.width,r.canvas.height).data;r.paintAt(2300);const second=r.c.getImageData(0,0,r.canvas.width,r.canvas.height).data;let changed=0;for(let i=0;i<first.length;i+=4)if(first[i]!==second[i]||first[i+1]!==second[i+1]||first[i+2]!==second[i+2]||first[i+3]!==second[i+3])changed++;
    const ground=document.querySelector('[data-player-ground]').getBoundingClientRect(),stage=b.$refs.battleScene.getBoundingClientRect();
    return{family:r.profile.family,changed,particles:r.stats.particles,cacheBytes:r.stats.cacheBytes,paintMeanMs:times.reduce((a,b)=>a+b,0)/times.length,paintP95Ms:times[Math.floor(times.length*.95)],ground:{x:ground.x-stage.x,y:ground.y-stage.y,width:ground.width,height:ground.height,stageHeight:stage.height},field:JSON.stringify(b.fieldState)};
   });
   assert(scene.changed>0,environment+' is static');assert(scene.particles<=20&&scene.cacheBytes<4*1024*1024);assert(scene.ground.width>=129&&scene.ground.width<=501&&scene.ground.y<scene.ground.stageHeight);assert(scene.ground.y+scene.ground.height>scene.ground.stageHeight,'allied ground is not cropped below the frame');
   measurements.push({environment,width,...scene});await shot('living-'+environment+'-'+width);
  }
  checks.push('twenty-distinct-scenery-profiles-and-cropped-allied-ground-'+width);
 }

 await fixture();for(const kind of ['up','down']){
  const visual=await page.evaluate(async kind=>{window.audioMode='b';b.playConditionChanges({player:[{key:'attack',kind,delta:kind==='up'?1:-1,text:kind==='up'?'ATQ +1':'ATQ −1'}],wild:[]});await b.$nextTick();return{color:getComputedStyle(document.querySelector('.stat-stream')).color,tint:document.querySelector('.sprite-tint-layer').style.filter,cue:audioTrace.at(-1)};},kind);
  assert.equal(visual.color,kind==='up'?'rgb(113, 200, 255)':'rgb(255, 130, 145)');assert.equal(visual.cue.payload.kind,'stat-'+kind);await page.waitForTimeout(270);await shot('living-stat-'+kind);
 }
 checks.push('filled-blue-red-arrows-sprite-tints-and-corresponding-sounds');

 await fixture();for(const moveName of ['Surf','Flamethrower','Thunderbolt','Ice Beam','Energy Ball','Earthquake']){
  const profile=await page.evaluate(async moveName=>{b.clearMoveFx();b.playMoveAnimation({moveName,actor:'player'});b.battleMoveFx.result={success:true,damage:10};b.battleMoveFx.stage='impact';await b.$nextTick();const vm=document.querySelector('canvas.move-library').__vue__;vm._resize.disconnect();const r=vm.renderer;r.stop();r.paintAt(r.duration()*.78);return{groundParticles:r.stats.groundParticles,moveType:b.battleMoveFx.moveType};},moveName);
  assert(profile.groundParticles>0&&profile.groundParticles<=18);measurements.push({moveName,...profile});await shot('living-ground-debris-'+moveName.toLowerCase().replaceAll(' ','-'));
 }
 checks.push('elemental-debris-reaches-the-ground-with-fading-water-fire-electric-ice-grass-earth');

 const disabled=await page.evaluate(async()=>{b.clearMoveFx();v.updatePreferences({...v.preferences,animationsEnabled:false});await b.$nextTick();await b.$nextTick();const ambient=document.querySelector('[data-battle-ambience]').__vue__;return{renderer:!!ambient.renderer,width:ambient.$el.width,fluid:document.querySelectorAll('.health-fluid').length};});
 assert.deepEqual(disabled,{renderer:false,width:0,fluid:0});await page.evaluate(()=>v.updatePreferences({...v.preferences,animationsEnabled:true}));await page.waitForFunction(()=>document.querySelector('[data-battle-ambience]')?.__vue__?.renderer);
 const background=await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));const ambient=document.querySelector('[data-battle-ambience]').__vue__;const result={renderer:!!ambient.renderer,width:ambient.$el.width,frame:ambient.frame};delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));return result;});assert.deepEqual(background,{renderer:false,width:0,frame:0});checks.push('disabled-animations-and-hidden-tabs-release-ambience-canvases-and-frames');
};
