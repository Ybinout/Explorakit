const test=require('node:test'),assert=require('node:assert/strict');

test('combat mix lowers music by25%, reinforces plans within a safe amplitude budget, and uses bass impacts',async()=>{
 const {COMBAT_MUSIC_GAIN,damageImpactPlan,combatCuePlan,audibleCombatPlan}=await import('../vue-explorakit/src/services/moveSounds.js');assert.equal(COMBAT_MUSIC_GAIN,.75);
 for(const damage of [10,30,60])for(const result of [{},{effectiveness:.5},{effectiveness:2},{critical:true}]){
  const raw=damageImpactPlan({damage,maxHp:100,...result}),mixed=audibleCombatPlan(raw);assert(mixed.length===raw.length);assert(mixed.reduce((a,v)=>a+v.volume,0)<=.920001);
  assert(mixed.filter(v=>v.kind==='tone').every(v=>v.frequency<=196&&v.endFrequency<=90));
  for(let i=0;i<raw.length;i++)assert.equal(mixed[i].frequency,raw[i].frequency);
 }
 const cue=combatCuePlan({kind:'stat-up'});assert(audibleCombatPlan(cue)[0].volume>cue[0].volume*1.5);assert.deepEqual(audibleCombatPlan([]),[]);
});

test('HP themes retain exact green/yellow/red thresholds, bounded progress and shared native colours',async()=>{
 const {healthPercent,healthColors,healthFill}=await import('../vue-explorakit/src/services/healthBarTheme.js');
 assert.equal(healthPercent(120,100),100);assert.equal(healthPercent(-2,100),0);assert.equal(healthPercent('25','100'),25);
 assert.equal(healthColors(51).end,'#2cb55b');assert.equal(healthColors(50).end,'#e6a13b');assert.equal(healthColors(21).end,'#e6a13b');assert.equal(healthColors(20).end,'#d14444');assert(healthFill(50,100).includes('#e6a13b'));
});

test('the allied floor follows visible sprite bounds rather than transparent padding and remains bounded for giants',async()=>{
 const {portraitGround,groundStyle,groundMaterial}=await import('../vue-explorakit/src/services/battleGround.js');
 const image={src:'test',getBoundingClientRect:()=>({left:100,top:200,width:200,height:200})},node={querySelector:()=>image},stage={getBoundingClientRect:()=>({left:10,top:20})};
 const g=portraitGround(node,stage,()=>({size:[100,100],bounds:[20,10,80,90]}));assert.deepEqual(g,{centerX:190,centerY:280,bottomY:360,width:120,height:160});
 assert.equal(groundStyle({...g,width:1500}).width,'500px');assert.equal(groundStyle({...g,width:15}).width,'130px');assert.equal(groundStyle(null).display,'none');assert.equal(groundMaterial('7p-gym'),'snow');assert.equal(groundMaterial('lake'),'water');
});

test('eighteen elemental debris types follow a ballistic arc, land on actual ground and fade completely; misses/status moves add none',async()=>{
 const {debrisPoint,drawGroundDebris,GROUND_DEBRIS}=await import('../vue-explorakit/src/services/moveGroundDebris.js');assert.equal(Object.keys(GROUND_DEBRIS).length,18);
 const target={x:300,y:120,groundY:280,connected:true};
 for(let n=0;n<18;n++){
  const first=debrisPoint(target,0,n,.5),air=debrisPoint(target,.3,n,.5),last=debrisPoint(target,1,n,.5);assert.equal(first.fade,0);assert(air.y<280);assert(last.landed);assert.equal(last.y,280);assert.equal(last.fade,0);
 }
 let draws=0;const c=new Proxy({},{get:()=>()=>{draws++;},set:()=>true}),r={c,unit:1,quality:1,seeds:Array(216).fill(.5),stats:{},palette:{ink:'#fff',dark:'#111'},particle(){draws++;},fx:{damageClass:'special',moveType:'Water',result:{success:true}}};
 drawGroundDebris(r,[target],.4,'impact');assert(draws>0&&r.stats.groundParticles<=18);draws=0;drawGroundDebris(r,[{...target,connected:false}],.4,'impact');assert.equal(draws,0);
 r.fx.damageClass='status';drawGroundDebris(r,[target],.4,'impact');assert.equal(draws,0);
});

test('artwork profiles have distinct identities and only localized valid masks in both formats',async()=>{
 const {BATTLE_AMBIENCES,ambienceProfile}=await import('../vue-explorakit/src/services/battleAmbienceProfiles.js');assert(Object.keys(BATTLE_AMBIENCES).length>=22);assert.equal(new Set(Object.values(BATTLE_AMBIENCES).map(p=>p.family)).size,Object.keys(BATTLE_AMBIENCES).length);
 for(const env of Object.keys(BATTLE_AMBIENCES))for(const format of ['wide','mobile']){
  const p=ambienceProfile(env,format);for(const z of p.zones){assert(z.x>=0&&z.y>=0&&z.w>0&&z.h>0&&z.x+z.w<=1.001&&z.y+z.h<=1.001,env);assert(z.w*z.h<.08,'no whole-foreground movement');}
  for(const [x,y,w,h]of p.windows)assert(x>=0&&y>=0&&w>0&&h>0&&x+w<=1.001&&y+h<=1.001,env);
 }
});

test('ambience respects cover/fill geometry and bounds caches and particles across repeated resizing',async()=>{
 const {BattleAmbienceRenderer,artworkTransform}=await import('../vue-explorakit/src/services/battleAmbience.js'),{BATTLE_AMBIENCES}=await import('../vue-explorakit/src/services/battleAmbienceProfiles.js');
 assert.deepEqual(artworkTransform(400,600,1000,1000),{sx:.6,sy:.6,x:-100,y:0});assert.deepEqual(artworkTransform(400,600,1000,1000,'fill'),{sx:.4,sy:.6,x:0,y:0});
 const context=new Proxy({globalAlpha:1,createRadialGradient:()=>({addColorStop(){}})},{get:(o,k)=>k in o?o[k]:(...args)=>{for(const n of args)if(typeof n==='number')assert(Number.isFinite(n));},set:(o,k,v)=>(o[k]=v,true)});
 const canvas=()=>({width:1,height:1,getContext:()=>context,ownerDocument:{createElement:()=>canvas()}});
 for(const environment of Object.keys(BATTLE_AMBIENCES)){
  const r=new BattleAmbienceRenderer(canvas(),{width:1536,height:1024},environment);r.resize(896,515);
  for(let frame=0;frame<20;frame++)r.paintAt(frame*330);assert(r.stats.particles<=20,environment);assert(r.stats.cacheBytes<4*1024*1024,environment);
  for(let n=0;n<12;n++){r.resize(393+n,640);r.paintAt(5000+n*100);}assert(r.stats.cacheBytes<4*1024*1024,environment);r.dispose();assert.equal(r.stats.cacheBytes,0);assert.equal(r.canvas.width,0);
 }
});
