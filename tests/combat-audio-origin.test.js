const test=require('node:test'),assert=require('node:assert/strict');

test('allied launch follows visible size and direction, while opponents/self/ground/delayed origins are identical',async()=>{
 const {moveOrigin}=await import('../vue-explorakit/src/services/moveOrigin.js');
 for(const width of [65,118,260,480])for(const direction of [1,-1]){
  const source={x:direction>0?80:500,y:320,width,height:width*.8},target={x:direction>0?600:20,y:80},base={x:source.x,y:source.y},copy=structuredClone(source);
  const p=moveOrigin(source,target,{own:true,family:'beam'});assert((p.x-source.x)*direction>0);assert(p.y<source.y);assert(Math.hypot(p.x-source.x,p.y-source.y)<=120+1e-9);assert.deepEqual(source,copy);
  for(const options of [{own:false,family:'beam'},{own:true,family:'beam',self:true},{own:true,family:'beam',delayed:true},{own:true,family:'zone'},{own:true,family:'status'}])assert.deepEqual(moveOrigin(source,target,options),base);
  assert.deepEqual(moveOrigin(source,source,{own:true,family:'projectile'}),base);
 }
 const p=moveOrigin({x:10,y:10,width:200,height:200},{x:12,y:10},{own:true,family:'beam'});assert(p.x<=10.7);
});

test('actual damage sounds distinguish resisted, neutral, super effective and critical, with critical priority and no fake hit',async()=>{
 const {damageImpactPlan:plan}=await import('../vue-explorakit/src/services/moveSounds.js'),base={damage:30,maxHp:100};
 const neutral=plan(base),resisted=plan({...base,effectiveness:.5}),superHit=plan({...base,effectiveness:2}),critical=plan({...base,critical:true});
 assert.equal(new Set([neutral,resisted,superHit,critical].map(p=>JSON.stringify(p))).size,4);assert(resisted[0].volume<neutral[0].volume);assert(superHit.length>neutral.length);assert(critical.length>superHit.length);
 assert.deepEqual(plan({...base,critical:true,effectiveness:.5}),critical);
 assert.deepEqual(plan({...base,direct:false,critical:true,effectiveness:2}),neutral);
 for(const result of [{damage:0,critical:true},{...base,effectiveness:0}])assert.deepEqual(plan(result),[]);
});

test('stat ascents/descents and thirteen status sounds are distinct, short, finite and bounded',async()=>{
 const {combatCuePlan:plan}=await import('../vue-explorakit/src/services/moveSounds.js'),{STATUS_VISUALS}=await import('../vue-explorakit/src/services/battleStatusVisuals.js');
 const up=plan({kind:'stat-up'}),down=plan({kind:'stat-down'});assert(up[0].frequency<up.at(-1).frequency);assert(down[0].frequency>down.at(-1).frequency);
 const sounds=[up,down,plan({kind:'miss'}),...Object.keys(STATUS_VISUALS).map(status=>plan({kind:'status',status}))];
 assert.equal(new Set(sounds.map(p=>JSON.stringify(p))).size,sounds.length);
 for(const voices of sounds){assert(voices.length>0&&voices.length<=5);for(const v of voices){assert(v.frequency>=40&&v.frequency<=8000);assert(v.endFrequency>=40&&v.volume>0&&v.volume<=.4);assert(v.duration>0&&v.duration+(v.delay||0)<=.65);}}
 assert.deepEqual(plan({kind:'anything'}),[]);assert.deepEqual(plan({kind:'status',status:'unknown'}),[]);
});

test('native raid outcomes retain effectiveness as presentation metadata without changing simulator damage',async()=>{
 const {RaidBattle}=require('../server/game/raids/RaidBattle'),factory=require('../server/game/drift/pokemonFactory'),{raidMovePlan}=await import('../vue-explorakit/src/services/raidPresentation.js');
 const mon=id=>{const p=factory.create(id,100,true);p.passiveAbility='Keen Eye';p.heldItem=null;p.abilities=[];p.movePp=[];p.addAbility('Water Gun');return p;};
 for(const [id,kind,expected]of [[76,'-supereffective',2],[9,'-resisted',.5]]){
  const battle=new RaidBattle([9,135,143,195].map(id=>({ownerId:1,ownerName:'Test',pokemon:mon(id)})),mon(id),{seed:[1,2,3,4],reactive:false});
  const own=battle.sim.p1.active[0],boss=battle.bossPokemon,hp=boss.hp;
  battle.events=[];battle.sim.actions.useMove('Water Gun',own,{target:boss});battle.collect();assert(boss.hp<hp);assert(battle.events.some(e=>e.kind===kind&&e.slot===4));
  const at=battle.events.findIndex(e=>e.kind==='move'),plan=raidMovePlan(battle.events,at,battle.view(1));assert.equal(plan.targets.find(t=>t.slot===4).effectiveness,expected);
 }
});

test('every beam, including lightning, has moving distributed particles with a strict budget for four targets',async()=>{
 const {MoveEffectRenderer}=await import('../vue-explorakit/src/services/moveEffectRenderer.js'),{moveVisual}=await import('../vue-explorakit/src/services/moveVisuals.js');
 const c=new Proxy({globalAlpha:1},{get:(o,k)=>k in o?o[k]:(...args)=>{for(const n of args)if(typeof n==='number')assert(Number.isFinite(n));},set:(o,k,v)=>(o[k]=v,true)}),r=new MoveEffectRenderer({width:1,height:1,getContext:()=>c},{requestFrame:()=>1,cancelFrame(){},now:()=>0});r.resize(896,515,2);
 for(const name of ['Thunderbolt','Charge Beam','Hyper Beam','Ice Beam','Signal Beam','Flamethrower','Bubble Beam']){
  const visual=moveVisual({moveName:name}),targets=Array.from({length:4},(_,i)=>({x:620+i*30,y:70+i*40,connected:true}));
  r.setEffect({...visual,stage:'travel',result:{success:true}},{startX:80,startY:350,targetX:700,targetY:130,targets});r.paintAt(350);assert(r.stats.beamParticles>=12&&r.stats.beamParticles<=32,name);
 }
 r.targetCount=1;r.fx=moveVisual({moveName:'Thunderbolt'});let points=[];r.particle=(_kind,x,y)=>points.push([x,y]);r.stats.beamParticles=0;r.beamFlow(0,0,500,0,.4,true,10);
 assert(points.some(([x])=>x<80)&&points.some(([x])=>x>220&&x<280)&&points.some(([x])=>x>420));const first=JSON.stringify(points);points=[];r.beamFlow(0,0,500,0,.41,true,10);assert.notEqual(JSON.stringify(points),first);r.dispose();
});
