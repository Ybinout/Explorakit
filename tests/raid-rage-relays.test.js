const test=require('node:test'),assert=require('node:assert/strict'),{RaidBattle}=require('../server/game/raids/RaidBattle'),{make}=require('../scripts/calibrateCorruptionRaids'),codec=require('../server/game/drift/checkpointCodec'),native=require('../server/game/raids/ruleset'),relays=require('../server/game/raids/relays'),pressure=require('../server/game/raids/pressure'),{config}=require('../server/game/raids/cooperation');
function setup(owners=[1,2,3,4],moves=['Dragon Claw','Splash','Protect','Tailwind'],bossMoves=['Splash']){
 const party=[135,9,143,195].map((id,i)=>({ownerId:owners[i],ownerName:'Owner'+owners[i],pokemon:make(id,100,4,moves,'Keen Eye')}));for(const p of party)p.pokemon.heldItem=null;
 const boss=make(143,100,4,bossMoves,'Keen Eye');boss.heldItem=null;
 const b=new RaidBattle(party,boss,{seed:[1,2,3,4],now:()=>1000});b.sim.raid.shieldsUsed=2;return b;
}
function act(b,action='attack',extra={}){const slot=b.view(1).currentSlot;return b.action(b.models[slot].ownerId,{token:b.token,slot,action,...(action==='attack'?{moveIndex:0,targetLoc:1}:{}),...extra});}
function cold(b){return RaidBattle.restore(codec.decode(codec.encode(b.snapshot())),b.now);}
function round(b){const turn=b.sim.turn;let n=0;while(!b.finished&&b.sim.turn===turn){act(b,'attack',{moveIndex:1});assert(++n<=4);}}

for(const owners of [[1,1,1,1],[1,2,3,4],[1,1,2,2]])test('four real actions can be concentrated on an already-acted Pokémon; owners '+owners.join(','),()=>{
 let b=setup(owners),events=[];const pp=b.sim.p1.active.map(p=>p.moveSlots[0].pp);act(b);events.push(...b.events);assert.equal(b.view(1).actionPool,3);
 for(let i=0;i<3;i++){
  const before=b.view(1),token=b.token;act(b,'pass',{target:0});events.push(...b.events);
  assert.equal(b.sim.turn,1);assert.equal(b.view(1).currentSlot,0);assert.equal(b.view(1).actionPool,3-i);assert.equal(b.deadline-b.playbackUntil,30000);assert.equal(b.view(1).intention.remaining,before.intention.remaining);assert(!b.view(1).allies[0].ready);
  assert.throws(()=>b.action(b.models[0].ownerId,{token,slot:0,action:'attack',moveIndex:0,targetLoc:1}),/disponible/);
  b=cold(b);act(b);events.push(...b.events);
 }
 assert.equal(b.sim.turn,2);assert.deepEqual(b.sim.p1.active.map(p=>p.moveSlots[0].pp),[pp[0]-4,...pp.slice(1)]);assert.equal(events.filter(e=>e.kind==='move'&&e.slot<4).length,4);assert.equal(events.filter(e=>e.kind==='move'&&e.slot===4).length,2);assert.equal(events.filter(e=>e.kind==='pass').length,3);
});
test('a transferable reserve can visit each ally only once; cycles, self passes and dead targets are rejected without mutation',()=>{
 const b=setup();const tokenId=relays.waits(b)[0].raidToken.id;
 for(const target of [1,2,3]){act(b,'pass',{target});assert.equal(relays.waits(b)[0].raidToken.id,tokenId);assert.equal(b.view(1).actionPool,4);}
 assert.deepEqual(b.view(1).relayTargets,[]);for(const target of [0,1,2,3,99]){const before=JSON.stringify(b.snapshot());assert.throws(()=>act(b,'pass',{target}),/allié/);assert.equal(JSON.stringify(b.snapshot()),before);}
 act(b);assert.equal(b.view(1).actionPool,3);
 const c=setup();c.sim.p1.active[1].hp=0;assert(!c.view(1).relayTargets.includes(1));assert.throws(()=>act(c,'pass',{target:1}),/allié/);
});
test('transfers do not refresh volatile durations, residuals, PP, held-item cycles, wishes or RNG',()=>{
 let b=setup(),p=b.sim.p1.active[0];p.setStatus('psn');p.setItem('leftovers');b.sim.actions.runMove('tailwind',p);b.sim.actions.runMove('protect',p);b.sim.raid.wishes=[{due:2,amount:100,sourceSlot:0}];const hp=p.hp,pp=p.moveSlots.map(s=>s.pp),seed=b.sim.prng.getSeed(),duration=b.sim.p1.sideConditions.tailwind.duration;
 act(b,'pass',{target:1});act(b,'pass',{target:2});act(b,'pass',{target:3});b=cold(b);p=b.sim.p1.active[0];assert.equal(p.hp,hp);assert.deepEqual(p.moveSlots.map(s=>s.pp),pp);assert.deepEqual(b.sim.prng.getSeed(),seed);assert.equal(b.sim.p1.sideConditions.tailwind.duration,duration);assert.equal(b.sim.raid.wishes.length,1);assert(p.volatiles.protect);
 for(let i=0;i<4;i++)act(b,'attack',{moveIndex:1});assert.equal(b.sim.turn,2);assert.equal(b.sim.p1.sideConditions.tailwind.duration,duration-1);
});
test('choice locking and native PP remain authoritative on repeated attacks, no free called move or replayed reserve',()=>{
 const b=setup();b.sim.p1.active[0].setItem('choiceband');act(b);act(b,'pass',{target:0});assert(b.moves(0).find(m=>m.index===1).disabled);const before=b.snapshot();assert.throws(()=>act(b,'attack',{moveIndex:1}),/indisponible/);assert.deepEqual(b.snapshot(),before);act(b);assert.equal(b.sim.p1.active[0].moveSlots[0].pp,13);
});
test('old reactive checkpoints gain reserve metadata without moving the current actor or extending its deadline',()=>{
 const b=setup();act(b);const data=codec.decode(codec.encode(b.snapshot()));delete data.sim.raid.relayVersion;for(const a of data.sim.queue)delete a.raidToken;const oldView=b.view(1),r=RaidBattle.restore(data,b.now);assert.equal(r.deadline,b.deadline);assert.equal(r.view(1).currentSlot,oldView.currentSlot);assert.equal(r.view(1).actionPool,3);act(r,'pass',{target:0});assert.equal(r.view(1).currentSlot,0);
});

test('boss rage rewards burst damage over spread cycles, respects actual HP loss and caps at +66%',()=>{
 const burst=setup(),slow=setup();const add=(b,f)=>pressure.received(b.sim,b.bossPokemon,b.bossPokemon.maxhp*f,()=>{});
 add(burst,.2);for(let i=0;i<4;i++){add(slow,.05);pressure.endCycle(slow.sim,()=>{});slow.sim.turn++;}
 assert(Math.abs(pressure.state(burst.sim).value-24)<1e-8);assert(Math.abs(pressure.state(slow.sim).value-12)<1e-8);assert(pressure.multiplier(burst.sim)>pressure.multiplier(slow.sim));
 add(burst,10);assert.equal(pressure.view(burst.sim).value,110);assert(Math.abs(pressure.multiplier(burst.sim)-1.66)<1e-12);
 const c=cold(burst);assert.deepEqual(pressure.view(c.sim),pressure.view(burst.sim));assert.equal(pressure.state(c.sim).cycleDamage,pressure.state(burst.sim).cycleDamage);
});
test('quiet-cycle decay happens once per full cycle, never while waiting, passing or reconnecting',()=>{
 let b=setup();pressure.state(b.sim).value=50;act(b,'pass',{target:1});assert.equal(pressure.view(b.sim).value,50);b=cold(b);assert.equal(pressure.view(b.sim).value,50);round(b);assert.equal(pressure.view(b.sim).value,46);b.sim.turn=1;pressure.endCycle(b.sim,()=>{});assert.equal(pressure.view(b.sim).value,46);
});
test('rage multiplies boss damage only, retaining screens, abilities, protection and corruption factors',()=>{
 const b=setup(),s=b.sim,p=s.p1.active[0],boss=b.bossPokemon,m=s.dex.getActiveMove('tackle');m.willCrit=false;s.randomizer=n=>n;
 const base=s.actions.getDamage(boss,p,m);pressure.state(s).value=100;const boosted=s.actions.getDamage(boss,p,m);assert(boosted>base*1.5&&boosted<=base*1.6+2);
 const player=s.actions.getDamage(p,boss,m);pressure.state(s).value=0;assert.equal(s.actions.getDamage(p,boss,m),player);
 pressure.state(s).value=100;s.p1.addSideCondition('reflect',p);assert(s.actions.getDamage(boss,p,m)<boosted);
 const hp=p.hp;s.actions.runMove('protect',p);s.actions.runMove('tackle',boss,1);assert.equal(p.hp,hp);
});
test('shielded HP loss alone feeds rage; no rage from shield absorption, missed damage or zero',()=>{
 const b=setup(),s=b.sim,boss=b.bossPokemon,p=s.p1.active[0];s.raid.shield={hp:1000,max:1000};const before=boss.hp;s.damage(100,boss,p,s.dex.moves.get('tackle'));assert.equal(before-boss.hp,25);const expected=40*(25/boss.maxhp)+400*(25/boss.maxhp)**2;assert(Math.abs(pressure.state(s).value-expected)<1e-10);assert(s.raid.events.some(e=>e.kind==='bossRage'));
 const value=pressure.state(s).value;pressure.received(s,boss,0,()=>{});assert.equal(pressure.state(s).value,value);
});
test('single-target hits reduce threat by actual HP fraction; AoE, immunity, miss, protection and indirect damage do not',()=>{
 for(const name of ['tackle','surf','shadowball','toxic']){
  const b=setup(undefined,undefined,[name]),s=b.sim,p=s.p1.active[2],boss=b.bossPokemon;p.hp=p.maxhp=500;p.m.aggro=80;p.m.friendUsed=true;
  const before=p.hp;s.actions.runMove(name,boss,3);const lost=before-p.hp;
  assert.equal(p.m.aggro,name==='tackle'?80-lost/500*50:80,name);
 }
 const b=setup(),s=b.sim,p=s.p1.active[0];p.hp=p.maxhp=500;p.m.aggro=80;p.m.friendUsed=true;s.damage(100,p,b.bossPokemon,s.dex.moves.get('tackle'));assert.equal(p.m.aggro,70);assert(s.raid.events.some(e=>e.kind==='aggro'&&e.reason==='bossHit'&&e.gain===-10));
 s.actions.runMove('protect',p);const protectedAggro=p.m.aggro;s.actions.runMove('tackle',b.bossPokemon,1);assert.equal(p.m.aggro,protectedAggro);s.damage(5,p,p,s.dex.conditions.get('psn'));assert.equal(p.m.aggro,protectedAggro);
});
test('multiple multi-owner requests are synchronized, cancellable and never transfer or refresh control',()=>{
 let b=setup();const token=b.token,deadline=b.deadline,pool=b.view(1).actionPool,seed=b.sim.prng.getSeed();
 for(const slot of [1,2])b.action(b.models[slot].ownerId,{token,slot,action:'requestHand'});
 assert.equal(b.view(1).currentSlot,0);assert.equal(b.view(1).handRequests.length,2);assert.equal(b.token,token);assert.equal(b.deadline,deadline);assert.equal(b.view(1).actionPool,pool);assert.deepEqual(b.sim.prng.getSeed(),seed);
 b=cold(b);assert.equal(b.view(1).handRequests.length,2);assert(b.view(2).handRequests.find(r=>r.slot===1).mine);b.action(2,{token,slot:1,action:'cancelHandRequest'});assert.deepEqual(b.view(1).handRequests.map(r=>r.slot),[2]);
 act(b,'pass',{target:2});assert.equal(b.view(1).currentSlot,2);assert.equal(b.view(1).handRequests.length,0);assert.equal(b.deadline-b.playbackUntil,30000);
});
test('requests validate owner, stale tokens, dead targets, solo, spam and end-of-turn expiry',()=>{
 const b=setup();assert.throws(()=>b.action(99,{token:b.token,slot:1,action:'requestHand'}),/contrôles/);assert.throws(()=>b.action(1,{token:b.token,slot:0,action:'requestHand'}),/Attends/);assert.throws(()=>b.action(2,{token:'stale',slot:1,action:'requestHand'}),/disponible/);
 b.action(2,{token:b.token,slot:1,action:'requestHand'});b.action(2,{token:b.token,slot:1,action:'cancelHandRequest'});assert.throws(()=>b.action(2,{token:b.token,slot:1,action:'requestHand'}),/Patiente/);
 b.action(3,{token:b.token,slot:2,action:'requestHand'});b.sim.p1.active[2].hp=0;relays.prune(b);assert.equal(b.view(1).handRequests.length,0);round(b);assert.equal(b.view(1).handRequests.length,0);
 const expiry=setup();act(expiry);expiry.action(1,{token:expiry.token,slot:0,action:'requestHand'});assert.equal(expiry.view(1).handRequests.length,1);for(let i=0;i<3;i++)act(expiry,'attack',{moveIndex:1});assert.equal(expiry.sim.turn,2);assert.equal(expiry.view(1).handRequests.length,0);
 const solo=setup([1,1,1,1]);assert.throws(()=>solo.action(1,{token:solo.token,slot:1,action:'requestHand'}),/multijoueurs/);
});
test('fresh 30-second transfer budgets survive reconnect and timeout without gifting another action',()=>{
 let time=1000,b=setup();b.now=()=>time;act(b);act(b,'pass',{target:0});const deadline=b.deadline,token=b.token,pool=b.view(1).actionPool;time=5000;b=RaidBattle.restore(codec.decode(codec.encode(b.snapshot())),()=>time);assert.equal(b.deadline,deadline);assert.equal(b.token,token);assert.equal(b.view(1).actionPool,pool);time=deadline;b.tick();assert(b.sim.p1.active[0].m.retired);assert(!b.view(1).relayTargets.includes(0));assert.equal(b.view(1).actionPool,2);assert.equal(b.sim.turn,1);
});
test('concentrated actions consume corrupt Choice HP costs per attack, but leftover counters only once per native turn',()=>{
 const b=setup();const p=b.sim.p1.active[0];p.set.rift.corrupted=true;p.setItem('corruptedchoiceband');p.baseMaxhp=p.maxhp=p.hp=1000;
 for(let i=0;i<4;i++){if(i)act(b,'pass',{target:0});act(b);}
 assert.equal(p.hp,800);assert.equal(p.moveSlots[0].pp,11);assert.equal(b.sim.turn,2);
 const c=setup(),q=c.sim.p1.active[0];q.set.rift.corrupted=true;q.setItem('corruptedleftovers');q.baseMaxhp=q.maxhp=1000;q.hp=500;
 for(let i=0;i<4;i++){if(i)act(c,'pass',{target:0});act(c);}
 assert.equal(q.m.corruptedLeftoversTurns,1);assert.equal(q.hp,570);
});
test('a K.O. recipient loses its unspent reserves and all pending requests without stalling the native turn',()=>{
 const b=setup(undefined,undefined,['Dragon Claw']);b.action(2,{token:b.token,slot:1,action:'requestHand'});b.sim.p1.active[1].hp=1;b.sim.p1.active[1].m.friendUsed=true;b.sim.actions.runMove('dragonclaw',b.bossPokemon,2);relays.prune(b);assert.equal(b.view(1).handRequests.length,0);assert(!b.view(1).relayTargets.includes(1));round(b);assert.equal(b.sim.turn,2);
});
