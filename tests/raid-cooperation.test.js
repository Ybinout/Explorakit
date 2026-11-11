const test=require('node:test'),assert=require('node:assert/strict');
const {RaidBattle}=require('../server/game/raids/RaidBattle'),{make}=require('../scripts/calibrateCorruptionRaids'),codec=require('../server/game/drift/checkpointCodec');
const cooperation=require('../server/game/raids/cooperation');
function mon(id,moves,ability='Keen Eye') {const p=make(id,100,4,moves,ability);p.heldItem=null;return p;}
function setup({moves=[['Splash'],['Splash'],['Splash'],['Splash']],owners=[1,2,3,4],bossMoves=['Splash'],reactive=true,now=()=>1000}={}) {
 return new RaidBattle([135,9,143,195].map((id,i)=>({ownerId:owners[i],ownerName:'Test'+owners[i],pokemon:mon(id,moves[i])})),mon(143,bossMoves),{seed:[1,2,3,4],now,reactive});
}
function act(b,index=0,targetLoc) {const slot=b.view(1).currentSlot;return b.action(b.models[slot].ownerId,{token:b.token,slot,action:'attack',moveIndex:index,targetLoc});}
function rest(b,choice=()=>({moveIndex:0})) {const turn=b.sim.turn;let n=0;while(b.sim.turn===turn&&!b.finished){const slot=b.view(1).currentSlot;b.action(b.models[slot].ownerId,{token:b.token,slot,action:'attack',...choice(slot)});assert(++n<=4);}}
function cold(b,now) {return RaidBattle.restore(codec.decode(codec.encode(b.snapshot())),now||b.now);}
function boostDamage(b,index,move='Tackle') {b.sim.prng.setSeed('1,2,3,4');return b.sim.actions.getDamage(b.bossPokemon,b.sim.p1.active[index],b.sim.dex.moves.get(move));}

test('all four owners share one native side and every living ally is adjacent after cold restore',()=>{
 const b=cold(setup());for(const p of b.sim.p1.active){assert(p.isActive);assert.equal(p.alliesAndSelf().length,4);assert.equal(p.adjacentAllies().length,3);for(const q of b.sim.p1.active)assert(p.isAlly(q));assert(!p.isAlly(b.bossPokemon));}
 b.retreat(3);assert.equal(b.sim.p1.active[0].alliesAndSelf().length,3);assert(!b.sim.p1.active[0].isAdjacent(b.sim.p1.active[3]));
});

test('Helping Hand reaches all three eligible allies, boosts their actual attack and exposes its volatile effect',()=>{
 for(const target of [1,2,3]) {
  const b=setup({moves:[['Helping Hand'],['Dragon Claw'],['Dragon Claw'],['Dragon Claw']]});const p=b.sim.p1.active[target];
  b.sim.prng.setSeed('1,2,3,4');const normal=b.sim.actions.getDamage(p,b.bossPokemon,b.sim.dex.moves.get('dragonclaw'));
  act(b,0,-target-1);assert.equal(p.volatiles.helpinghand.multiplier,1.5);assert(b.view(1).allies[target].effects.helpingHand);assert(b.events.some(e=>e.kind==='-singleturn'&&e.slot===target));
  b.sim.prng.setSeed('1,2,3,4');assert(b.sim.actions.getDamage(p,b.bossPokemon,b.sim.dex.moves.get('dragonclaw'))>normal);
  assert.equal(b.sim.p1.active[0].m.aggro,cooperation.config.aggro.helpingHand);
 }
});

test('Helping Hand never offers self, foe or withdrawn allies; already-acted allies remain eligible',()=>{
 const b=setup({moves:[['Splash'],['Helping Hand'],['Splash'],['Splash']]});act(b);const move=b.moves(1)[0];assert.deepEqual(move.targets.map(t=>t.slot).sort(),[0,2,3]);
 const p=b.sim.p1.active[1],pp=p.moveSlots[0].pp;assert.throws(()=>act(b,0,-2),/Cible invalide/);assert.equal(p.moveSlots[0].pp,pp);
 b.retreat(3);assert.deepEqual(b.moves(1)[0].targets.map(t=>t.slot),[0,2]);
});

test('Heal Pulse works between every owner pair and only effective healing credits the caster with useful normalized threat and no overhealing credit',()=>{
 for(let source=0;source<4;source++)for(let target=0;target<4;target++)if(source!==target){
  const b=setup({moves:Array.from({length:4},()=>['Heal Pulse'])}),s=b.sim.p1.active[source],p=b.sim.p1.active[target];p.hp-=50;
  b.sim.actions.runMove('healpulse',s,-target-1);assert.equal(p.hp,p.maxhp);
  assert.equal(s.m.aggro,cooperation.healingAggro(50,p));assert.equal(p.m.aggro||0,0);
  const before=s.m.aggro;b.sim.actions.runMove('healpulse',s,-target-1);assert.equal(s.m.aggro,before,'no credit for a full-health target');
 }
});

test('Heal Block and protection prevent healing without generating phantom aggro',()=>{
 for(const block of ['healblock','protect']) {
  const b=setup({moves:[['Heal Pulse'],['Splash'],['Splash'],['Splash']]}),p=b.sim.p1.active[3];p.hp-=100;p.addVolatile(block,p,b.sim.dex.moves.get(block));const hp=p.hp;
  act(b,0,-4);assert.equal(p.hp,hp);assert.equal(b.sim.p1.active[0].m.aggro||0,0);
 }
});

for(const [move,attack] of [['Reflect','Tackle'],['Light Screen','Psychic']])test(move+' reduces actual damage for all four allies and persists for the real duration across decisions and a checkpoint',()=>{
 let b=setup({moves:[[move,'Splash'],['Splash'],['Splash'],['Splash']]});b.sim.p1.active[0].setItem('lightclay');const before=[0,1,2,3].map(i=>boostDamage(b,i,attack));
 act(b);const start=b.events.find(e=>e.kind==='-sidestart');assert.equal(start.turns,8);for(let i=0;i<4;i++)assert(boostDamage(b,i,attack)<before[i]);assert.equal(b.view(1).sideEffects[0][0].turns,8);
 b=cold(b);assert.equal(b.view(1).sideEffects[0][0].turns,8);rest(b);assert.equal(b.view(1).sideEffects[0][0].turns,7);
 for(let n=0;n<7;n++)rest(b,slot=>({moveIndex:slot===0?1:0}));assert.equal(b.view(1).sideEffects[0].length,0);
});

test('an already-active screen cannot farm support aggro and a failed support cannot credit it',()=>{
 const b=setup({moves:[['Reflect'],['Splash'],['Splash'],['Splash']]});act(b);const rage=b.sim.p1.active[0].m.aggro;rest(b);act(b);assert.equal(b.sim.p1.active[0].m.aggro,rage);assert(b.events.some(e=>e.kind==='-fail'));
});

test('Wide Guard covers all four allies during both boss actions, expires once at the actual turn end',()=>{
 const b=setup({moves:[['Wide Guard'],['Splash'],['Splash'],['Splash']],bossMoves:['Surf']});const hp=b.sim.p1.active.map(p=>p.hp);act(b);assert(b.view(1).sideEffects[0].some(e=>e.id==='wideguard'));rest(b);assert.deepEqual(b.sim.p1.active.map(p=>p.hp),hp);assert(!b.sim.p1.sideConditions.wideguard);
});

test('team status cures, safeguard, weather and terrain apply across owner boundaries',()=>{
 const b=setup({moves:[['Aromatherapy','Safeguard','Rain Dance','Electric Terrain'],['Splash'],['Splash'],['Splash']]});
 for(const p of b.sim.p1.active)p.setStatus('psn',p,b.sim.dex.moves.get('toxic'));act(b);assert(b.sim.p1.active.every(p=>!p.status));rest(b);
 act(b,1);for(const p of b.sim.p1.active)assert(!p.trySetStatus('psn',b.bossPokemon,b.sim.dex.moves.get('toxic')));rest(b);
 act(b,2);assert.equal(b.sim.field.weather,'raindance');assert(b.events.some(e=>e.kind==='weather'&&e.effect==='raindance'));rest(b);
 act(b,3);assert(b.view(1).fieldEffects.some(e=>e.id==='electricterrain'&&e.turns===5));
});

test('Friend Guard from the fourth owner protects every other ally, without protecting its own holder',()=>{
 const b=setup(),before=[0,1,2,3].map(i=>boostDamage(b,i));b.sim.p1.active[3].setAbility('friendguard');
 for(let i=0;i<3;i++)assert(boostDamage(b,i)<before[i]);assert.equal(boostDamage(b,3),before[3]);
});

for(const move of ['U-turn','Volt Switch','Flip Turn'])test(move+' deals real damage without changing an active owner or requesting a replacement',()=>{
 const b=setup({moves:[[move],['Splash'],['Splash'],['Splash']]}),identities=b.sim.p1.active.map(p=>p.set.rift.uuid),hp=b.bossPokemon.hp;
 act(b,0,1);assert(b.bossPokemon.hp<hp);assert.deepEqual(b.sim.p1.active.map(p=>p.set.rift.uuid),identities);assert.notEqual(b.sim.requestState,'switch');rest(b);assert.equal(b.sim.turn,2);
});

test('mandatory switches and position swaps are explicitly unavailable even through a called move; ordinary Doubles are unchanged',()=>{
 for(const move of ['Baton Pass','Teleport','Parting Shot','Healing Wish','Lunar Dance','Ally Switch']){
  const b=setup({moves:[[move,'Splash'],['Splash'],['Splash'],['Splash']]}),p=b.sim.p1.active[0],before=p.moveSlots[0].pp;assert(b.moves(0)[0].disabled);assert(b.moves(0)[0].disabledReason);assert.throws(()=>act(b),/indisponible/);assert.equal(p.moveSlots[0].pp,before);
  const identities=b.sim.p1.active.map(p=>p.set.rift.uuid);b.sim.actions.runMove(b.sim.dex.moves.get(move).id,p,0);assert.deepEqual(b.sim.p1.active.map(p=>p.set.rift.uuid),identities);assert(p.hp>0);assert.notEqual(b.sim.requestState,'switch');
 }
 assert.equal(require('../server/game/doubles/ruleset').dex.moves.get('Baton Pass').selfSwitch,'copyvolatile');assert.equal(require('../server/game/doubles/ruleset').dex.moves.get('U-turn').selfSwitch,true);
});

for(const owners of [[1,1,1,1],[1,2,3,4]])test('relay grants a fresh30 seconds, consumes one action, preserves that deadline on reconnect, and cannot replay a used ally ('+new Set(owners).size+' owners)',()=>{
 let time=1000,b=setup({owners,now:()=>time});time=b.deadline-1000;b.action(owners[0],{token:b.token,slot:0,action:'pass',target:3});assert.equal(b.view(owners[3]).currentSlot,3);assert.equal(b.deadline-Math.max(time,b.playbackUntil),30000);
 const deadline=b.deadline;b=cold(b,()=>time);assert.equal(b.deadline,deadline);b.action(owners[3],{token:b.token,slot:3,action:'presented'});assert.equal(b.deadline-time,30000);
 const same=b.deadline;time+=5000;b.action(owners[3],{token:b.token,slot:3,action:'presented'});assert.equal(b.deadline,same);assert.throws(()=>b.action(owners[3],{token:b.token,slot:3,action:'pass',target:0}),/allié/);act(b);rest(b);assert.equal(b.sim.turn,2);assert.equal(b.sim.p1.active[0].moveSlots[0].pp,b.sim.p1.active[0].moveSlots[0].maxpp);
});

test('legacy solo and multiplayer relay reset the receiver window without clearing anyone else’s choice',()=>{
 for(const owners of [[1,1,1,1],[1,2,3,4]]){let time=1000;const b=setup({owners,reactive:false,now:()=>time});time=25000;
  if(b.soloClock)b.action(1,{token:b.token,slot:3,action:'focus'});time=30000;b.action(owners[0],{token:b.token,slot:0,action:'pass',target:3});assert.equal(b.deadline-time,30000);assert.equal(b.pending[0].action,'pass');if(b.soloClock)assert.equal(b.soloClock.slot,3);
 }
});

test('display adapter retains native screens, winds, team guards and global terrain without depending on a selected Pokémon',async()=>{
 const {raidFieldModel}=await import('../vue-explorakit/src/services/raidField.js');const frame={sideEffects:[[{id:'reflect',turns:5},{id:'lightscreen',turns:4},{id:'tailwind',turns:3},{id:'wideguard',turns:1}],[]],fieldEffects:[{id:'trickroom',turns:5},{id:'electricterrain',turns:4}]};
 const state=raidFieldModel(frame);assert.equal(state.sides.player.screens.reflectTurns,5);assert.equal(state.sides.player.screens.lightScreenTurns,4);assert.equal(state.sides.player.screens.tailwindTurns,3);assert.equal(state.sides.player.screens.wideGuardTurns,1);assert.equal(state.field.trickRoomTurns,5);assert.equal(state.terrain.kind,'electric_terrain');
 assert.deepEqual(raidFieldModel({...frame,currentSlot:3}),state);assert.equal(raidFieldModel().sides.player.screens.reflectTurns,0);
});

for(const reactive of [true,false])test('only allies may fall back to native Struggle; an unavailable boss waits without locking the raid ('+reactive+')',()=>{
 const b=setup({moves:[['Baton Pass'],['Splash'],['Splash'],['Splash']],bossMoves:['Baton Pass'],reactive});assert.equal(b.moves(0)[0].id,'struggle');assert.deepEqual(b.bossPlan,[]);
 if(reactive)act(b);else for(let slot=0;slot<4;slot++)b.action(b.models[slot].ownerId,{token:b.token,slot,action:'attack',moveIndex:0});
 assert(b.events.some(e=>e.kind==='move'&&e.moveName==='Struggle'));assert.notEqual(b.sim.requestState,'switch');
});

test('old raid checkpoints mask newly unavailable moves immediately without resetting their deadline',()=>{
 const b=setup({moves:[['Baton Pass'],['Splash'],['Splash'],['Splash']]});b.sim.p1.active[0].moveSlots[0].disabled=false;const deadline=b.deadline,r=cold(b);assert.equal(r.deadline,deadline);assert.equal(r.moves(0)[0].id,'struggle');assert.equal(r.view(1).aggroRules.healingRatio,.7);
});
