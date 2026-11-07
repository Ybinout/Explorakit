const test=require('node:test'),assert=require('node:assert/strict'),rotation=require('../server/game/raids/rotation'),content=require('../server/game/raids/content'),habitats=require('../server/game/world/darkHabitats');
test('every daily boss belongs to its map, is fully evolved, K4 and natively playable',()=>{
 const world=content.createDay(Date.parse('2026-11-07T12:00:00Z'));assert.equal(world.rifts.length,5);
 for(const r of world.rifts){assert(rotation.pool(r.map,world.day).includes(r.bossSpecies));const p=content.bossFor(r);assert.equal(p.level,content.DIFFICULTIES.find(d=>d.id===r.difficulty).level);assert.equal(p.k,4);assert(Object.values(p.iv).every(v=>v===31));assert(habitats.SPECIES.some(s=>s.id===r.bossSpecies));require('../server/game/raids/ruleset').teamSet(p);}
});
test('daily selection is shared, deterministic, renewed daily and offers multiple different species',()=>{
 for(let n=1;n<=9;n++){const m='jungle'+n,a=rotation.pool(m,'2026-11-07');assert(a.length>=2);assert.deepEqual(a,rotation.pool(m,'2026-11-07'));assert.notDeepEqual(a,rotation.pool(m,'2026-11-08'));}
});
test('completion closes the shared generation for exactly twenty minutes and reopening changes species',()=>{
 const w=content.createDay(1000),r=w.rifts[0],run={phase:'won',rift:{...r}},closed=rotation.closedWorld(w,run,2000);assert(closed);assert.equal(closed.rifts[0].closedUntil,2000+1200000);assert.equal(w.rifts[0].closedUntil,null);assert.equal(rotation.closedWorld(closed,run,3000),null);assert(!rotation.reopen(closed,1201999,()=>0));const previous=r.bossSpecies;assert(rotation.reopen(closed,1202000,()=>0));assert.notEqual(closed.rifts[0].bossSpecies,previous);assert.equal(closed.rifts[0].generation,r.generation+1);assert.equal(rotation.closedWorld(closed,run,1203000),null,'late completion cannot close a newly reopened generation');
});
test('only the completed rift closes; running raids and other difficulties are unaffected',()=>{
 const w=content.createDay(1000),r=w.rifts[2],next=rotation.closedWorld(w,{phase:'lost',rift:r},2000);assert(next.rifts[2].closedUntil);assert(next.rifts.filter((_,i)=>i!==2).every(r=>!r.closedUntil));assert.equal(rotation.closedWorld(w,{phase:'active',rift:r},2000),null);
});
test('legacy snapshots are upgraded without changing their location or difficulty',()=>{
 const w=content.createDay(1000);for(const r of w.rifts){delete r.bossSpecies;delete r.generation;}const places=w.rifts.map(r=>[r.map,r.x,r.y,r.difficulty]);assert(rotation.upgrade(w));assert(!rotation.upgrade(w));assert.deepEqual(w.rifts.map(r=>[r.map,r.x,r.y,r.difficulty]),places);
});
test('a twenty-minute closure survives midnight and a cold server startup into a new day',()=>{
 const now=Date.parse('2026-11-07T22:55:00Z'),old=content.createDay(now),r=old.rifts[0];r.closedUntil=now+rotation.COOLDOWN_MS;
 const fresh=rotation.renew(old,content.createDay(now+10*60000),now+10*60000),next=fresh.rifts.find(f=>f.difficulty===r.difficulty);assert.notEqual(fresh.day,old.day);assert.equal(next.closedUntil,r.closedUntil);assert.equal(next.bossSpecies,r.bossSpecies);assert(!rotation.reopen(fresh,now+19*60000));assert(rotation.reopen(fresh,now+20*60000,()=>0));assert.notEqual(next.bossSpecies,r.bossSpecies);
});

test('all eligible land and fishing species produce a legal native boss set',()=>{
 const all=[...new Set([...habitats.LAND.flat(),...habitats.WATER.flat(),...habitats.JUNGLE4_GHOSTS])];for(const id of all){const r={...content.createDay(1000).rifts[0],bossSpecies:id},p=content.bossFor(r);assert.equal(p.abilities.length,4,'four moves for '+id);require('../server/game/raids/ruleset').teamSet(p);}
});
