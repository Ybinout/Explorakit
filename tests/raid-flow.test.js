const test=require('node:test'),assert=require('node:assert/strict');
const{RaidBattle}=require('../server/game/raids/RaidBattle'),f=require('../server/game/drift/pokemonFactory'),codec=require('../server/game/drift/checkpointCodec');
function mon(id,moves,ability='Keen Eye'){const p=f.create(id,100,true);p.k=4;p.passiveAbility=ability;p.heldItem=null;p.abilities=[];p.movePp=[];for(const m of moves)p.addAbility(m);p.recalculateStats();p.currentHp=p.maxHp;return p;}
function setup({owners=[1,1,1,1],moves=['Splash'],bossMoves=['Splash'],ids=[143,143,143,143],abilities=[] ,now=()=>1000}={}){return new RaidBattle(ids.map((id,i)=>({ownerId:owners[i],ownerName:'Test'+owners[i],pokemon:mon(id,i===0?moves:['Splash'],abilities[i])})),mon(143,bossMoves),{reactive:false,seed:[1,2,3,4],now});}
function choose(b,i,m=0,loc=1){return b.action(b.models[i].ownerId,{token:b.token,slot:i,action:'attack',moveIndex:m,targetLoc:loc});}
function round(b,m=0){for(let i=0;i<4;i++)if(b.sim.p1.active[i].hp&&!b.sim.p1.active[i].m.retired)choose(b,i,i===0?m:0);}
test('solo gives four separate authoritative clocks; changing focus preserves each remaining budget',()=>{
 let time=1000;const b=setup({now:()=>time});assert.equal(b.deadline,39000);assert.equal(b.view(1).soloClock.slot,0);
 time=19000;b.action(1,{token:b.token,slot:1,action:'focus'});assert.equal(b.deadline,49000);assert.equal(b.soloClock.budgets[0],20000);
 time=24000;b.action(1,{token:b.token,slot:0,action:'focus'});assert.equal(b.deadline,44000);assert.equal(b.soloClock.budgets[1],25000);
 const same=b.deadline;b.action(1,{token:b.token,slot:0,action:'focus'});assert.equal(b.deadline,same);
 choose(b,0);assert.equal(b.soloClock.slot,1);assert.equal(b.deadline,49000);
 time=30000;choose(b,1);assert.equal(b.deadline,60000);assert.equal(b.soloClock.slot,2);
 time=45000;choose(b,2);assert.equal(b.deadline,75000);assert.equal(b.soloClock.slot,3);
 time=65000;choose(b,3);assert.equal(b.sim.turn,2);assert.deepEqual(b.soloClock.budgets,[30000,30000,30000,30000]);assert.equal(b.deadline,b.playbackUntil+30000);
});
test('solo expiration retires only that Pokémon, preserves the other choices, and survives reconnect without resetting',()=>{
 let time=1000;const b=setup({now:()=>time});time=18000;choose(b,0);time=48001;assert(b.tick());assert.equal(b.sim.p1.active.filter(p=>p.m.retired).length,1);assert.equal(b.soloClock.slot,2);assert.equal(b.deadline,78001);assert.equal(b.pending[0].action,'attack');assert.equal(b.events[0].kind,'retreat');
 const saved=codec.decode(codec.encode(b.snapshot())),r=RaidBattle.restore(saved,()=>time);assert.equal(r.deadline,78001);assert.deepEqual(r.soloClock,b.soloClock);assert.equal(r.view(1).eventKey,b.view(1).eventKey);time+=10000;assert.equal(r.view(1).soloClock.remainingMs[2],20000);
 const legacy=codec.decode(codec.encode(b.snapshot()));delete legacy.soloClock;const upgraded=RaidBattle.restore(legacy,()=>time);assert.equal(upgraded.deadline,78001);const again=RaidBattle.restore(codec.decode(codec.encode(upgraded.snapshot())),()=>time+1000);assert.equal(again.deadline,78001);
});
test('multiplayer keeps its shared 30-second turn window, including two Pokémon owned by one player',()=>{
 for(const owners of [[1,1,2,2],[1,2,3,4]]){let time=1000;const b=setup({owners,now:()=>time});assert.equal(b.view(1).soloClock,null);choose(b,0);assert.equal(b.deadline,39000);time=39001;assert(b.tick());assert.equal(b.sim.p1.active.filter(p=>p.m.retired).length,3);}
});
test('Earthquake hits the boss and all three allies except an airborne Pokémon and a protected ally',()=>{
 const b=setup({moves:['Earthquake'],ids:[445,143,94,9],abilities:['Keen Eye','Keen Eye','Levitate','Keen Eye']});
 const protectedMon=b.sim.p1.active[3];protectedMon.moveSlots=[{...protectedMon.moveSlots[0],move:'Protect',id:'protect',pp:10,maxpp:10,target:'self'}];
 const before=b.sim.p1.active.map(p=>p.hp),boss=b.bossPokemon.hp;
 choose(b,0);choose(b,1);choose(b,2);choose(b,3);
 assert(b.bossPokemon.hp<boss);assert.equal(b.sim.p1.active[0].hp,before[0]);assert(b.sim.p1.active[1].hp<before[1]);assert.equal(b.sim.p1.active[2].hp,before[2]);assert.equal(b.sim.p1.active[3].hp,before[3]);
 assert(b.events.some(e=>e.kind==='-immune'&&e.slot===2));assert(b.events.some(e=>e.kind==='-activate'&&e.slot===3&&/Protect/.test(e.effect)));assert(b.events.some(e=>e.kind==='-damage'&&e.slot===4));assert(b.events.some(e=>e.kind==='-damage'&&e.slot===1));
});
test('Discharge, Surf and foe-only area moves retain their native targets, abilities and protections',()=>{
 for(const move of ['Surf','Discharge','Dazzling Gleam']){
  const b=setup({moves:[move],ids:[143,143,143,143]});const before=b.sim.p1.active.map(p=>p.hp);round(b);
  const friendly=b.events.filter(e=>e.kind==='-damage'&&e.direct&&e.slot<4);
  if(move==='Dazzling Gleam'){assert.equal(friendly.length,0);assert.deepEqual(b.sim.p1.active.map(p=>p.hp),before);}else assert.deepEqual(new Set(friendly.map(e=>e.slot)),new Set([1,2,3]));
  assert(b.events.some(e=>e.kind==='-damage'&&e.slot===4));
 }
 const b=setup({moves:['Discharge'],abilities:['Keen Eye','Volt Absorb','Keen Eye','Keen Eye']});b.sim.p1.active[1].hp-=50;const hp=b.sim.p1.active[1].hp;round(b);assert(b.sim.p1.active[1].hp>hp);assert(!b.events.some(e=>e.kind==='-damage'&&e.slot===1));
});
test('Tailwind doubles all four allies for four native turns across owners and a checkpoint',()=>{
 const b=setup({owners:[1,2,3,4],moves:['Tailwind','Splash']});const speeds=b.sim.p1.active.map(p=>p.getActionSpeed());round(b);
 assert.equal(b.sim.p1.sideConditions.tailwind.duration,3);assert.deepEqual(b.sim.p1.active.map(p=>p.getActionSpeed()),speeds.map(v=>v*2));assert(b.events.some(e=>e.kind==='-sidestart'&&e.effect==='tailwind'&&e.turns===4));
 const r=RaidBattle.restore(codec.decode(codec.encode(b.snapshot())),()=>1000);assert.equal(r.view(1).sideEffects[0].find(e=>e.id==='tailwind').turns,3);
 for(let n=0;n<2;n++){round(r,1);assert(r.sim.p1.sideConditions.tailwind);assert.deepEqual(r.sim.p1.active.map(p=>p.getActionSpeed()),speeds.map(v=>v*2));}
 round(r,1);assert(!r.sim.p1.sideConditions.tailwind);assert.deepEqual(r.sim.p1.active.map(p=>p.getActionSpeed()),speeds);assert(r.events.some(e=>e.kind==='-sideend'&&e.effect==='tailwind'));
});
test('Reflect, Light Screen and Trick Room are shared native effects with visible remaining durations',()=>{
 for(const move of ['Reflect','Light Screen','Safeguard','Trick Room']){const b=setup({moves:[move]});round(b);const view=b.view(1),id=move.toLowerCase().replace(/\s/g,''),effects=[...view.sideEffects.flat(),...view.fieldEffects];assert(effects.some(e=>e.id===id&&e.turns>0),move);assert(b.events.some(e=>['-sidestart','-fieldstart'].includes(e.kind)&&e.effect===id));}
});
test('each shield cue carries exact numeric health and survives native private/public split-log merging',()=>{
 const b=setup(),sim=b.sim,p=sim.p1.active[0],boss=b.bossPokemon,m=sim.dex.moves.get('tackle');sim.damage(boss.maxhp*.6,boss,p,m);b.collect();const spawn=b.events.find(e=>e.kind==='shield');assert(spawn);assert.equal(spawn.hp,sim.raid.shield.max);assert.equal(spawn.max,Math.ceil(boss.maxhp*.14));
 b.events=[];const old=sim.raid.shield.hp;sim.damage(100,boss,p,m);b.collect();const hit=b.events.find(e=>e.kind==='shieldHit');assert.equal(hit.hp,old-100);assert.equal(hit.max,spawn.max);assert.equal(hit.amount,100);assert(b.events.some(e=>e.kind==='-damage'&&e.hp===boss.hp&&e.maxHp===boss.maxhp));
 b.events=[];sim.damage(100000,boss,p,m);b.collect();assert.equal(b.events.filter(e=>e.kind==='shieldBreak').length,1);assert.equal(b.events.find(e=>e.kind==='shieldHit').amount,old-100);
});
test('visual AoE plans keep successful targets when another is immune or protected, and ignore recoil',async()=>{
 const{raidMovePlan}=await import('../vue-explorakit/src/services/raidPresentation.js');const frame={boss:{currentHp:999},allies:Array.from({length:4},()=>({currentHp:100}))};
 const events=[{kind:'move',slot:0,target:4,moveName:'Earthquake',moveTarget:'allAdjacent',damageClass:'physical'},{kind:'-immune',slot:2},{kind:'-activate',slot:3,effect:'move: Protect'},{kind:'-damage',slot:1,direct:true,hp:50},{kind:'-damage',slot:4,direct:true,hp:900},{kind:'-damage',slot:0,direct:false,hp:90}];
 const plan=raidMovePlan(events,0,frame);assert(!plan.failed);assert.deepEqual(plan.targets.filter(t=>t.connected).map(t=>t.slot).sort(),[1,4]);assert(!plan.targets.some(t=>t.slot===0));
});
test('Wide Guard protects all four allies against both area actions of the boss',()=>{
 const b=setup({owners:[1,2,3,4],moves:['Wide Guard'],bossMoves:['Surf']});const before=b.sim.p1.active.map(p=>p.hp);round(b);assert.deepEqual(b.sim.p1.active.map(p=>p.hp),before);assert.equal(b.events.filter(e=>e.kind==='move'&&e.slot===4).length,2);assert(b.events.filter(e=>e.kind==='-activate'&&/Wide Guard/.test(e.effect)).length>=4);
});
test('solo replay acknowledgement starts exactly 30 seconds and can never refresh or extend a clock',()=>{
 let time=1000;const b=setup({now:()=>time});time=5000;b.action(1,{token:b.token,slot:0,action:'presented'});assert.equal(b.deadline,35000);time=9000;b.action(1,{token:b.token,slot:0,action:'presented'});assert.equal(b.deadline,35000);choose(b,0);assert.equal(b.deadline,39000);
 const r=RaidBattle.restore(codec.decode(codec.encode(b.snapshot())),()=>time);r.action(1,{token:r.token,slot:1,action:'presented'});assert.equal(r.deadline,39000);
});
