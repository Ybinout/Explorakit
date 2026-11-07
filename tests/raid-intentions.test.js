const test=require('node:test'),assert=require('node:assert/strict');
const {RaidBattle}=require('../server/game/raids/RaidBattle'),{make}=require('../scripts/calibrateCorruptionRaids'),codec=require('../server/game/drift/checkpointCodec');
function mon(id,moves){const p=make(id,100,4,moves,'Keen Eye');p.heldItem=null;return p;}
function setup({owners=[1,1,1,1],moves=[['Splash'],['Splash'],['Splash'],['Splash']],bossMoves=['Tackle'],now=()=>1000,reactive=true}={}){
 return new RaidBattle([135,9,143,195].map((id,i)=>({ownerId:owners[i],ownerName:'Test'+owners[i],pokemon:mon(id,moves[i])})),mon(143,bossMoves),{seed:[1,2,3,4],now,reactive});
}
function act(b,action='attack',extra={}){const slot=b.view(1).currentSlot;return b.action(b.models[slot].ownerId,{token:b.token,slot,action,...(action==='attack'?{moveIndex:0}:{}),...extra});}
function round(b,select=()=>({})){const turn=b.sim.turn,events=[];let n=0;while(!b.finished&&b.sim.turn===turn){act(b,'attack',select(b.view(1).currentSlot));events.push(...b.events);assert(++n<=4);}return events;}
function restore(b,now){return RaidBattle.restore(codec.decode(codec.encode(b.snapshot())),now||b.now);}
test('real decisions resolve before the next input, with two boss casts within one native turn',()=>{
 const b=setup({moves:[['Thunderbolt'],['Splash'],['Splash'],['Splash']]});const first=b.view(1),hp=b.bossPokemon.hp;assert.equal(first.flowVersion,2);assert.equal(first.currentSlot,0);assert.equal(first.intention.remaining,2);assert.deepEqual(first.order,[0,1,4,3,2,4]);
 act(b,'attack',{targetLoc:1});assert(b.bossPokemon.hp<hp);assert.equal(b.sim.turn,1);assert.equal(b.view(1).intention.remaining,1);assert.equal(b.view(1).currentSlot,1);assert(!b.events.some(e=>e.kind==='move'&&e.slot===4));
 act(b);assert.equal(b.events.filter(e=>e.kind==='move'&&e.slot===4).length,1);assert.equal(b.view(1).intention.id,'1:1');assert.equal(b.view(1).intention.remaining,2);
 act(b);act(b);assert.equal(b.sim.turn,2);assert.equal(b.sim.raid.acted.length,0);assert.equal(b.view(1).currentSlot,0);
});
test('relay transfers one reserve, promotes another owner and follows real threat for the imminent cast',()=>{
 const b=setup({owners:[1,2,3,4],moves:[['Splash'],['Splash'],['Splash'],['Follow Me']]});
 b.sim.p1.active[1].m.aggro=80;assert.equal(b.view(1).intention.target,1);
 act(b,'pass',{target:3});assert.equal(b.view(1).currentSlot,3);assert.equal(b.view(1).intention.remaining,2);assert.equal(b.events.filter(e=>e.kind==='pass').length,1);assert.equal(b.sim.p1.active[0].moveSlots[0].pp,b.sim.p1.active[0].moveSlots[0].maxpp);
 const token=b.token;act(b);assert.equal(b.sim.p1.active[3].m.aggro,100);assert.equal(b.view(1).intention.remaining,1);assert.equal(b.view(1).currentSlot,1);
 assert.throws(()=>b.action(4,{token,slot:3,action:'attack',moveIndex:0}),/disponible/);
 act(b);const attack=b.events.find(e=>e.kind==='move'&&e.slot===4);assert(attack);assert.equal(attack.target,3);assert(b.sim.p1.active[3].m.aggro<100);assert.equal(b.view(1).currentSlot,3);
 act(b);act(b);assert.equal(b.sim.turn,2);assert.equal(b.view(1).currentSlot,0);assert.equal(b.sim.p1.active[3].moveSlots[0].pp,b.sim.p1.active[3].moveSlots[0].maxpp-2);
});
test('relay to own, retired or invalid slots fails without consuming any reserve; already-acted remains available',()=>{
 const b=setup();act(b);assert(b.view(1).relayTargets.includes(0));for(const target of [1,9]){const token=b.token;assert.throws(()=>act(b,'pass',{target}),/allié/);assert.equal(b.token,token);assert.equal(b.view(1).currentSlot,1);}b.retreat(0);assert.throws(()=>act(b,'pass',{target:0}),/allié/);
});
test('solo and multiplayer each give the current Pokémon 30 seconds and reject another owner',()=>{
 for(const owners of [[1,1,1,1],[1,1,2,2],[1,2,3,4]]){
  let time=1000;let b=setup({owners,now:()=>time});assert.equal(b.deadline,39000);
  assert.throws(()=>b.action(99,{token:b.token,slot:0,action:'attack',moveIndex:0}),/main/);
  time=5000;act(b,'presented');assert.equal(b.deadline,35000);time=8000;act(b,'presented');assert.equal(b.deadline,35000);
  act(b);const deadline=b.deadline;assert(deadline>=time+30000);b=restore(b,()=>time);assert.equal(b.deadline,deadline);time+=1000;assert.equal(b.view(1).currentSlot,1);
  assert.throws(()=>b.action(owners[0],{token:b.token,slot:0,action:'attack',moveIndex:0}),/main/);
 }
});
test('checkpoint keeps the partly executed turn, PP, PRNG, intent and absolute clock exactly',()=>{
 let time=1000,b=setup({moves:[['Thunderbolt'],['Splash'],['Splash'],['Splash']],now:()=>time});act(b,'attack',{targetLoc:1});const before=b.snapshot(),view=b.view(1);time=7000;const r=restore(b,()=>time);assert.equal(r.deadline,b.deadline);assert.deepEqual(r.sim.prng.getSeed(),b.sim.prng.getSeed());assert.deepEqual(r.view(1).intention,view.intention);assert.deepEqual(r.snapshot().sim.queue,before.sim.queue);
 const a=[],c=[];for(let n=0;n<3;n++){act(b);a.push(...b.events);act(r);c.push(...r.events);}assert.deepEqual(a,c);assert.equal(r.bossPokemon.hp,b.bossPokemon.hp);assert.equal(r.sim.turn,2);
});
test('timeout retires one Pokémon, persists actual HP, and does not skip or refresh the next owner',()=>{
 let time=1000;const b=setup({owners:[1,2,3,4],now:()=>time}),hp=b.sim.p1.active[0].hp;
 time=b.deadline;assert(b.tick());assert.equal(b.sim.p1.active.filter(p=>p.m.retired).length,1);assert.equal(b.view(1).currentSlot,1);assert.equal(b.view(1).intention.remaining,1);assert(b.events.some(e=>e.kind==='retreat'&&e.reason==='timeout'));assert.equal(b.applyModels()[0].pokemon.currentHp,hp);
 const deadline=b.deadline;assert.equal(b.tick(),false);assert.equal(b.deadline,deadline);act(b);assert.equal(b.sim.turn,1);
});
test('area boss attacks ignore aggro, hit all four and retain native collective protection',()=>{
 const b=setup({bossMoves:['Surf']});b.sim.p1.active[3].m.aggro=100;assert(b.view(1).intention.area);assert.equal(b.view(1).intention.target,null);const events=round(b);assert.equal(events.filter(e=>e.kind==='move'&&e.slot===4).length,2);assert.deepEqual(new Set(events.filter(e=>e.kind==='-damage'&&e.direct&&e.slot<4).map(e=>e.slot)),new Set([0,1,2,3]));
 const protectedRaid=setup({bossMoves:['Surf'],moves:[['Wide Guard'],['Splash'],['Splash'],['Splash']]});const hp=protectedRaid.sim.p1.active.map(p=>p.hp);round(protectedRaid);assert.deepEqual(protectedRaid.sim.p1.active.map(p=>p.hp),hp);
});
test('native residuals run once per full turn; Tailwind lasts four turns across decision boundaries',()=>{
 const b=setup({bossMoves:['Splash'],moves:[['Tailwind','Splash'],['Splash'],['Splash'],['Splash']]});
 const target=b.sim.p1.active[2];target.setStatus('psn');const hp=target.hp;act(b);assert.equal(target.hp,hp);assert.equal(b.sim.p1.sideConditions.tailwind.duration,4);act(b);assert.equal(target.hp,hp);act(b);act(b);assert.equal(target.hp,hp-Math.floor(target.baseMaxhp/8));assert.equal(b.sim.p1.sideConditions.tailwind.duration,3);
 for(let i=0;i<3;i++)round(b,slot=>({moveIndex:slot===0?1:0}));assert.equal(b.sim.p1.sideConditions.tailwind,undefined);
});
test('native recoil, abilities, real stats and damage are used for each incremental move',()=>{
 const b=setup({moves:[['Flare Blitz'],['Splash'],['Splash'],['Splash']]});const p=b.sim.p1.active[0],hp=p.hp,atk=p.storedStats.atk;act(b,'attack',{targetLoc:1});assert(p.hp<hp);assert.equal(p.storedStats.atk,atk);assert.equal(p.moveSlots[0].pp,p.moveSlots[0].maxpp-1);assert(b.events.some(e=>e.kind==='-damage'&&e.slot===0&&!e.direct));
});
test('friendship protects only the current turn and no longer prevents damage next turn',()=>{
 const b=setup({bossMoves:['Splash']});const p=b.sim.p1.active[0];p.m.friendGuard=1;p.m.friendUsed=true;round(b);assert.equal(p.m.friendGuard,undefined);p.hp=10;b.sim.damage(20,p,b.bossPokemon,b.sim.dex.moves.get('tackle'));assert.equal(p.hp,0);
});
test('all withdrawals end the raid, retaining real HP/PP and without native phantom replacements',()=>{
 const b=setup({bossMoves:['Splash']});for(let n=0;n<4;n++)act(b,'retreat',{confirm:true});assert(b.finished);assert(!b.won);assert.equal(b.applyModels().filter(m=>m.pokemon.currentHp>0).length,4);
});
test('unselected initiative and non-attacking relays/withdrawals never consume a priority berry',()=>{
 for(const action of ['pass','retreat']){
  const b=setup({bossMoves:['Splash']}),p=b.sim.p1.active[0];p.hp=10;p.setItem('custapberry');
  act(b,action,action==='pass'?{target:3}:{confirm:true});assert.equal(p.item,'custapberry');assert(!b.sim.raid.consumedOwners.includes(p.set.rift.uuid));
 }
});
test('fainted or withdrawn future actors cannot leave the boss waiting forever',()=>{
 const b=setup({bossMoves:['Splash']});for(const i of [1,2,3]){const p=b.sim.p1.active[i];p.hp=0;p.fainted=true;p.isActive=false;b.sim.p1.pokemonLeft--;}
 const events=round(b);assert.equal(b.sim.turn,2);assert.equal(events.filter(e=>e.kind==='move'&&e.slot===4).length,2);assert.equal(b.view(1).currentSlot,0);
});
test('many repeated relays, decisions and cold restores never create a fifth allied action',()=>{
 for(let n=0;n<12;n++){
  let b=setup({owners:[1,2,3,4],bossMoves:['Splash']});const events=[];
  for(let i=0;i<24;i++){
   const v=b.view(1),targets=v.relayTargets;
   if(targets.length&&(n+i)%3===0)act(b,'pass',{target:targets.at(-1)});else act(b);
   events.push(...b.events);b=restore(b);
  }
  const real=events.filter(e=>e.kind==='move'&&e.slot<4).length;assert.equal(b.sim.turn,1+Math.floor(real/4));assert.equal(events.filter(e=>e.kind==='move'&&e.slot===4).length,2*Math.floor(real/4)+(real%4>=2?1:0));
  const allies=events.filter(e=>e.kind==='pass'||e.kind==='move'&&e.slot<4);assert.equal(allies.length,24);
 }
});
test('all viewers receive exactly the same intentions, order, HP and authoritative events',()=>{
 const b=setup({owners:[1,2,3,4]});act(b,'pass',{target:3});const states=[1,2,3,4].map(id=>b.view(id));for(const v of states){assert.deepEqual(v.intention,states[0].intention);assert.deepEqual(v.order,states[0].order);assert.deepEqual(v.events,states[0].events);assert.equal(v.currentSlot,3);}
});
test('old checkpoints keep their submitted choices and native whole-turn implementation',()=>{
 const b=setup({reactive:false});b.action(1,{token:b.token,slot:0,action:'attack',moveIndex:0});const r=restore(b);assert.equal(r.flowVersion,undefined);assert.equal(r.pending[0].action,'attack');for(let i=1;i<4;i++)r.action(1,{token:r.token,slot:i,action:'attack',moveIndex:0});assert.equal(r.sim.turn,2);assert.equal(r.events.filter(e=>e.kind==='move'&&e.slot===4).length,2);
});
test('mist is denser with difficulty and continuous across all horizontal and vertical map edges',async()=>{
 const{darkMistDensity:d}=await import('../vue-explorakit/src/services/darkContinentMist.js');assert.equal(d(224,160),1);assert.equal(d(1120,800),1.85);assert(d(672,480)>d(224,160));
 for(const x of [448,896])for(let y=0;y<=960;y+=40)assert(Math.abs(d(x-.001,y)-d(x+.001,y))<.00001);
 for(const y of [320,640])for(let x=0;x<=1344;x+=40)assert(Math.abs(d(x,y-.001)-d(x,y+.001))<.00001);
});
