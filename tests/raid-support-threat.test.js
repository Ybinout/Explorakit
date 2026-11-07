const test=require('node:test'),assert=require('node:assert/strict');
const {RaidBattle}=require('../server/game/raids/RaidBattle'),native=require('../server/game/raids/ruleset'),{make}=require('../scripts/calibrateCorruptionRaids'),codec=require('../server/game/drift/checkpointCodec'),{config,healingAggro}=require('../server/game/raids/cooperation');
function setup(moves=[['Splash'],['Splash'],['Splash'],['Splash']],bossMoves=['Splash'],owners=[1,2,3,4]){
 const party=[135,9,143,195].map((id,i)=>({ownerId:owners[i],ownerName:'Owner'+owners[i],pokemon:make(id,100,4,moves[i],'Keen Eye')}));for(const p of party)p.pokemon.heldItem=null;const boss=make(143,100,4,bossMoves,'Keen Eye');boss.heldItem=null;
 const b=new RaidBattle(party,boss,{seed:[1,2,3,4],now:()=>1000});for(const p of b.sim.p1.active)p.m.friendUsed=true;return b;
}
function cast(b,slot,index=0,loc){b.action(b.models[slot].ownerId,{token:b.token,slot,action:'attack',moveIndex:index,targetLoc:loc});}
function next(b,index=0,loc){cast(b,b.view(1).currentSlot,index,loc);}
function cold(b){return RaidBattle.restore(codec.decode(codec.encode(b.snapshot())),()=>1000);}
function finish(b){const turn=b.sim.turn;let count=0;while(b.sim.turn===turn&&!b.finished){next(b);assert(++count<6);}}
function actual(b,move='Psychic',target=2){const sim=b.sim,p=sim.p1.active[target],before=p.hp;const attack=sim.dex.getActiveMove(move);attack.willCrit=false;sim.actions.runMove(attack,sim.p2.active[0],target+1);return before-p.hp;}

for(const move of ['Helping Hand','Heal Pulse','Acupressure','Coaching','Aromatic Mist'])test(move+' offers all legal ally cards across four owners and executes on the fourth native slot',()=>{
 const b=setup([[move],['Splash'],['Splash'],['Splash']]),m=b.moves(0)[0],target=b.sim.p1.active[3];target.hp-=60;
 assert(!m.disabled);assert(m.targets.some(t=>t.slot===3&&t.loc===-4));assert.equal(m.targets.some(t=>t.slot===0),move==='Acupressure');
 next(b,0,-4);assert(!b.events.some(e=>e.kind==='-fail'));
 if(move==='Heal Pulse')assert.equal(target.hp,target.maxhp);else if(move==='Helping Hand')assert(target.volatiles.helpinghand);else if(move==='Coaching')assert.deepEqual([target.boosts.atk,target.boosts.def],[1,1]);else if(move==='Aromatic Mist')assert.equal(target.boosts.spd,1);else assert(Object.values(target.boosts).includes(2));
});

for(const owners of [[1,1,1,1],[1,2,3,4]])test('slow Helping Hand persists through a real turn, reconnect and status action until next attack ('+new Set(owners).size+' owners)',()=>{
 let b=setup([['Dragon Claw','Splash'],['Helping Hand','Splash'],['Splash'],['Splash']],['Splash'],owners);next(b,0,1);assert.equal(b.view(1).currentSlot,1);assert(b.moves(1)[0].targets.some(t=>t.slot===0));next(b,0,-1);assert(b.sim.p1.active[0].volatiles.helpinghand);finish(b);
 b=cold(b);assert(b.sim.p1.active[0].volatiles.helpinghand);next(b,1);assert(b.sim.p1.active[0].volatiles.helpinghand,'status action does not waste pending boost');next(b,1);finish(b);b=cold(b);
 const copy=cold(b),p=copy.sim.p1.active[0];p.removeVolatile('helpinghand');copy.sim.prng.setSeed('1,2,3,4');const normal=copy.sim.actions.getDamage(p,copy.bossPokemon,copy.sim.dex.moves.get('dragonclaw'));b.sim.prng.setSeed('1,2,3,4');assert(b.sim.actions.getDamage(b.sim.p1.active[0],b.bossPokemon,b.sim.dex.moves.get('dragonclaw'))>normal);
 next(b,0,1);assert(!b.sim.p1.active[0].volatiles.helpinghand);assert.equal(native.dex.moves.get('helpinghand').condition.duration,undefined);assert.equal(require('../server/game/doubles/ruleset').dex.moves.get('helpinghand').condition.duration,1);
});

test('one helper cannot stack or farm the same pending boost; different helpers retain native stacking',()=>{
 const b=setup([['Helping Hand'],['Helping Hand'],['Helping Hand'],['Splash']]),target=b.sim.p1.active[3];b.sim.actions.runMove('helpinghand',b.sim.p1.active[0],-4);const aggro=b.sim.p1.active[0].m.aggro;
 b.sim.actions.runMove('helpinghand',b.sim.p1.active[0],-4);assert.equal(target.volatiles.helpinghand.multiplier,1.5);assert.equal(b.sim.p1.active[0].m.aggro,aggro);assert(!b.moves(0)[0].targets.some(t=>t.slot===3));b.sim.actions.runMove('helpinghand',b.sim.p1.active[1],-4);assert.equal(target.volatiles.helpinghand.multiplier,2.25);
});

for(const [screen,move] of [['Reflect','Tackle'],['Light Screen','Psychic'],['Aurora Veil','Psychic']])test(screen+' gives activation threat and credits actual avoided HP to its original caster, including after cold restore',()=>{
 let b=setup([[screen],['Splash'],['Splash'],['Splash']],[move]);if(screen==='Aurora Veil')b.sim.field.setWeather('hail',b.sim.p1.active[0]);b.sim.actions.runMove(native.toID(screen),b.sim.p1.active[0]);const activation=b.sim.p1.active[0].m.aggro;assert.equal(activation,config.aggro.screens);b=cold(b);
 const plain=cold(b);plain.sim.p1.removeSideCondition(native.toID(screen));const seed='1,2,3,4';b.sim.prng.setSeed(seed);plain.sim.prng.setSeed(seed);const noScreen=actual(plain,move),withScreen=actual(b,move);assert(noScreen>withScreen);
 const expected=(noScreen-withScreen)/b.sim.p1.active[2].maxhp*config.aggro.preventionScale*config.aggro.preventionRatio;assert(Math.abs(b.sim.p1.active[0].m.aggro-activation-expected)<1e-8);assert.equal(b.sim.p1.active[2].m.aggro||0,0);assert(b.sim.raid.events.some(e=>e.kind==='aggro'&&e.reason==='prevented'&&e.slot===0));
});

test('critical hits, Infiltrator, immunity, fixed damage and overkill never invent screen prevention credit',()=>{
 for(const mode of ['critical','infiltrator','immune','fixed','overkill']){
  const move=mode==='fixed'?'Seismic Toss':mode==='immune'?'Shadow Ball':'Tackle',b=setup([['Reflect'],['Splash'],['Splash'],['Splash']],[move]);b.sim.actions.runMove('reflect',b.sim.p1.active[0]);const rage=b.sim.p1.active[0].m.aggro;
  const attack=b.sim.dex.getActiveMove(move);if(mode==='critical')attack.willCrit=true;if(mode==='infiltrator'){b.bossPokemon.setAbility('infiltrator');attack.infiltrates=true;}if(mode==='overkill')b.sim.p1.active[2].hp=1;
  b.sim.actions.runMove(attack,b.bossPokemon,3);assert.equal(b.sim.p1.active[0].m.aggro,rage,mode);
 }
});

test('overlapping screens plus Friend Guard share one avoided-damage budget; Aurora Veil is not counted twice',()=>{
 const b=setup(undefined,['Tackle']),sim=b.sim;sim.field.setWeather('hail',sim.p1.active[0]);sim.p1.addSideCondition('reflect',sim.p1.active[0]);sim.p1.addSideCondition('auroraveil',sim.p1.active[1]);sim.p1.active[3].setAbility('friendguard');const plain=cold(b);plain.sim.p1.removeSideCondition('reflect');plain.sim.p1.removeSideCondition('auroraveil');plain.sim.p1.active[3].setAbility('keeneye');
 b.sim.prng.setSeed('1,2,3,4');plain.sim.prng.setSeed('1,2,3,4');const avoided=actual(plain,'Tackle')-actual(b,'Tackle'),expected=avoided/sim.p1.active[2].maxhp*config.aggro.preventionScale*config.aggro.preventionRatio;
 const total=sim.p1.active.reduce((n,p)=>n+(p.m.aggro||0),0);assert(Math.abs(total-expected)<1e-8);assert.equal(sim.p1.active[1].m.aggro||0,0,'overridden Aurora Veil gets no credit');assert(sim.p1.active[0].m.aggro>0&&sim.p1.active[3].m.aggro>0);
});

for(const move of ['Wide Guard','Protect'])test(move+' credits a fully blocked native attack without changing live HP, PP, RNG or item state beyond native resolution',()=>{
 const attack=move==='Wide Guard'?'Surf':'Tackle',b=setup([[move],['Splash'],['Splash'],['Splash']],[attack]),sim=b.sim,slot=move==='Wide Guard'?2:0;sim.actions.runMove(native.toID(move),sim.p1.active[0]);const before=sim.p1.active.map(p=>p.hp),rng=sim.prng.getSeed();const unobserved=cold(b);unobserved.sim.raid.threatProjection=true;
 sim.actions.runMove(native.toID(attack),b.bossPokemon,slot+1);unobserved.sim.actions.runMove(native.toID(attack),unobserved.bossPokemon,slot+1);
 assert.deepEqual(sim.p1.active.map(p=>p.hp),before);assert.deepEqual(sim.prng.getSeed(),unobserved.sim.prng.getSeed());assert.deepEqual(sim.log,unobserved.sim.log);assert.deepEqual(sim.getAllActive().map(p=>[p.item,p.moveSlots.map(m=>m.pp)]),unobserved.sim.getAllActive().map(p=>[p.item,p.moveSlots.map(m=>m.pp)]));assert.equal(typeof rng,'string');assert(sim.raid.events.some(e=>e.reason==='prevented'));
});

test('fully blocked immunity or status does not generate prevention aggro',()=>{
 for(const attack of ['Thunder Wave','Shadow Ball']){const b=setup([['Protect'],['Splash'],['Splash'],['Splash']],[attack]),p=b.sim.p1.active[0];p.setType('Normal');b.sim.actions.runMove('protect',p);const rage=p.m.aggro;b.sim.actions.runMove(native.toID(attack),b.bossPokemon,1);assert.equal(p.m.aggro,rage);}
});

test('prevention caps apply once to an AoE and persist across reconnects; heals cap per successful cast, not per target',()=>{
 let b=setup([['Wide Guard'],['Splash'],['Splash'],['Splash']],['Surf']);b.bossPokemon.level=1000;b.bossPokemon.storedStats.spa=9999;b.sim.actions.runMove('wideguard',b.sim.p1.active[0]);const start=b.sim.p1.active[0].m.aggro;b.sim.actions.runMove('surf',b.bossPokemon,3);assert(b.sim.p1.active[0].m.aggro-start<=config.aggro.preventionPerMoveCap);b=cold(b);const used=b.sim.raid.preventionUsed;b.sim.actions.runMove('surf',b.bossPokemon,3);assert(b.sim.raid.preventionUsed<=config.aggro.preventionPerTurnCap);assert(b.sim.raid.preventionUsed>=used);
 const heal=setup([['Life Dew'],['Splash'],['Splash'],['Splash']]);for(const p of heal.sim.p1.active)p.hp=1;heal.sim.actions.runMove('lifedew',heal.sim.p1.active[0]);assert(heal.sim.p1.active[0].m.aggro<=config.aggro.healingPerMoveCap);assert(healingAggro(300,heal.sim.p1.active[0])>0);
});

test('observing protection preserves the exact native damage, rolls and held items on connected multi-hit attacks',()=>{
 const b=setup([['Reflect'],['Splash'],['Splash'],['Splash']],['Double Hit']);b.sim.p1.addSideCondition('reflect',b.sim.p1.active[0]);b.sim.p1.active[3].setAbility('friendguard');const reference=cold(b);reference.sim.raid.threatProjection=true;
 actual(b,'Double Hit');actual(reference,'Double Hit');assert.deepEqual(b.sim.p1.active.map(p=>[p.hp,p.status,p.item]),reference.sim.p1.active.map(p=>[p.hp,p.status,p.item]));assert.deepEqual(b.sim.prng.getSeed(),reference.sim.prng.getSeed());
});

test('an older one-turn Helping Hand checkpoint migrates to next attack without changing the deadline or PRNG',()=>{
 const b=setup([['Helping Hand'],['Splash'],['Splash'],['Splash']]);b.sim.actions.runMove('helpinghand',b.sim.p1.active[0],-4);const state=b.sim.p1.active[3].volatiles.helpinghand;state.duration=1;delete state.raidHelpers;const seed=b.sim.prng.getSeed(),deadline=b.deadline,r=cold(b),effect=r.sim.p1.active[3].volatiles.helpinghand;assert.equal(effect.duration,undefined);assert.deepEqual(effect.raidHelpers,[b.models[0].pokemon.uuid]);assert.equal(r.deadline,deadline);assert.equal(r.sim.prng.getSeed(),seed);
});

test('one fully guarded AoE uses one isolated native projection for all four targets',()=>{
 const b=setup([['Wide Guard'],['Splash'],['Splash'],['Splash']],['Surf']);b.sim.actions.runMove('wideguard',b.sim.p1.active[0]);const restore=native.restore;let count=0;native.restore=function(...args){count++;return restore(...args);};try{b.sim.actions.runMove('surf',b.bossPokemon,1);assert.equal(count,1);}finally{native.restore=restore;}
});
