const test=require('node:test'),assert=require('node:assert/strict'),rotation=require('../server/game/raids/rotation'),content=require('../server/game/raids/content'),dc2=require('../server/game/world/darkContinent2'),legendary=require('../server/game/drift/pokemonFactory').legendary;
const day=Date.parse('2026-11-14T12:00:00Z');
const final=world=>world.rifts.find(dc2.isFinal);
test('the true level-1000 final rift always draws a legendary, including extreme RNG and every reopening',()=>{
 const w=content.createDay(day),r=final(w);assert(r);assert.equal(content.bossFor(r).level,1000);assert(legendary.has(r.bossSpecies));
 for(let i=0;i<100;i++){const previous=r.bossSpecies;rotation.populate(r,w.day,previous,max=>(i*7+max-1)%max);assert(legendary.has(r.bossSpecies));assert.notEqual(r.bossSpecies,previous);}
 assert.equal(rotation.closedWorld(w,{phase:'active',rift:r},day),null);
});
test('final closure is exactly one hour, reopens once at its deadline and rejects stale generations',()=>{
 const w=content.createDay(day),r=final(w),run={phase:'won',rift:structuredClone(r)},closed=rotation.closedWorld(w,run,day),f=final(closed),previous=f.bossSpecies;
 assert.equal(f.closedUntil,day+3600000);assert.equal(r.closedUntil,null);assert(!rotation.reopen(closed,day+3599999,()=>0));assert(rotation.reopen(closed,day+3600000,()=>0));assert.equal(f.closedUntil,null);assert.equal(f.generation,r.generation+1);assert(legendary.has(f.bossSpecies));assert.notEqual(f.bossSpecies,previous);assert(!rotation.reopen(closed,day+3600001,()=>0));assert.equal(rotation.closedWorld(closed,run,day+3600002),null);
 const ordinary=w.rifts.find(r=>r.region==='dark');assert.equal(rotation.closedWorld(w,{phase:'won',rift:ordinary},day).rifts.find(r=>r.id===ordinary.id).closedUntil,day+1200000);
});
test('legacy final world is repaired once, preserving position, seed and closed state without changing other rifts',()=>{
 const w=content.createDay(day),r=final(w),before=structuredClone(w.rifts.filter(p=>p!==r));r.bossSpecies=143;r.generation=7;r.closedUntil=day+1200000;delete r.finalRotationVersion;
 const position={x:r.x,y:r.y,map:r.map,seed:r.seed,id:r.id},old={...r};assert(rotation.upgrade(w,day));assert(legendary.has(r.bossSpecies));assert.equal(r.generation,8);assert.equal(r.closedUntil,day+3600000);for(const[k,v]of Object.entries(position))assert.equal(r[k],v);
 assert.deepEqual(w.rifts.filter(p=>p!==r),before);assert(!rotation.upgrade(w,day+1));assert.equal(rotation.closedWorld(w,{phase:'won',rift:old},day+100),null);
});
test('one-hour final closure and legacy upgrade survive midnight and a cold reload',()=>{
 const midnight=Date.parse('2026-11-14T22:55:00Z'),w=content.createDay(midnight),r=final(w),closed=rotation.closedWorld(w,{phase:'won',rift:r},midnight),deadline=final(closed).closedUntil;
 const fresh=rotation.renew(closed,content.createDay(midnight+10*60000),midnight+10*60000);rotation.upgrade(fresh,midnight+10*60000);assert.equal(final(fresh).closedUntil,deadline);
 const cold=JSON.parse(JSON.stringify(fresh));assert(!rotation.reopen(cold,deadline-1));assert(rotation.reopen(cold,deadline,()=>0));assert(legendary.has(final(cold).bossSpecies));
 const legacy=structuredClone(w);final(legacy).bossSpecies=143;final(legacy).closedUntil=midnight+1200000;delete final(legacy).finalRotationVersion;
 const next=rotation.renew(legacy,content.createDay(midnight+10*60000),midnight+10*60000);rotation.upgrade(next,midnight+10*60000);assert.equal(final(next).closedUntil,midnight+3600000);assert(legendary.has(final(next).bossSpecies));
});
test('training level-1000 replicas and normal rifts keep their existing rotation and rewards',()=>{
 const w=content.createDay(day),r=final(w),training={...r,training:true};rotation.populate(training,w.day,null,()=>99%2);assert.equal(dc2.isFinal(training),false);
 const rewards=content.rewards(r,()=>.99);assert(rewards.items.find(i=>i.key==='potential_pearl').quantity>=2);assert(rewards.money>0);assert.equal(rotation.FINAL_COOLDOWN_MS,3600000);assert.equal(rotation.COOLDOWN_MS,1200000);
});
