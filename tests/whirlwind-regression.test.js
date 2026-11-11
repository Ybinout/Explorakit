const test=require('node:test'),assert=require('node:assert/strict');
const e=require('../server/game/battle/battleEngine'),f=require('../server/game/drift/pokemonFactory');
const {resolveMoveSwitches}=require('../server/game/battle/battleTeam');
function mon(move='Splash',ability='No Ability'){const p=f.create(143,50,true);p.passiveAbility=ability;p.heldItem=null;p.abilities=[move];p.movePp=[e.getMoveByName(move).pp];p.maxHp=p.currentHp=500;return p;}
function setup(type='trainer'){const a=mon('Whirlwind'),b=mon(),r=mon(),dead=mon();dead.currentHp=0;const at=[a,mon()],bt=[b,dead,r,mon()],s=e.createBattleState({battleType:type});return {a,b,r,at,bt,s};}
function cast(x,name='Whirlwind'){return e.useattack(name,x.a,x.b,{battleState:x.s,attackerSide:x.s.sides.player,defenderSide:x.s.sides.enemy,attackerTeam:x.at,defenderTeam:x.bt});}
function rng(value,fn){const old=Math.random;Math.random=()=>value;try{return fn();}finally{Math.random=old;}}
test('Cyclone ignores accuracy/evasion, Protect and Substitute but not Crafty Shield',()=>{
 for(const condition of ['accuracy','protect','substitute','crafty']){const x=setup(),d=e.ensureBattleData(x.b);if(condition==='accuracy'){e.ensureBattleData(x.a).statStages.accuracy=-6;d.statStages.evasion=6;}if(condition==='protect')d.protect=true;if(condition==='substitute')d.substituteHp=100;if(condition==='crafty')x.s.sides.enemy.protectTeam.craftyShieldTurns=1;const r=rng(.99,()=>cast(x));assert.equal(r.forceSwitch,condition!=='crafty',condition);assert.equal(x.a.movePp[0],19);assert.equal(r.damage,0);}
});
test('Cyclone fails honestly without a living reserve, under Ingrain or Suction Cups',()=>{
 for(const condition of ['last','dead','ingrain','cups']){const x=setup();if(condition==='last')x.bt=[x.b];if(condition==='dead')x.bt.slice(1).forEach(p=>p.currentHp=0);if(condition==='ingrain')e.ensureBattleData(x.b).ingrain=true;if(condition==='cups')x.b.passiveAbility='Suction Cups';const r=cast(x);assert(!r.forceSwitch,condition);assert.equal(r.success,false,condition);assert(r.messages.length>0);}
 const x=setup();x.a.passiveAbility='Mold Breaker';x.b.passiveAbility='Suction Cups';assert(cast(x).forceSwitch);const y=setup();y.a.passiveAbility='Mold Breaker';e.ensureBattleData(y.b).ingrain=true;assert(!cast(y).forceSwitch);
});
test('Cyclone selects a random living reserve, clears boosts and never chooses KO/active',()=>{
 for(const value of [0,.49,.5,.99]){const x=setup(),expected=x.bt[value<.5?2:3];e.ensureBattleData(x.b).statStages.attack=3;const r=cast(x),out=resolveMoveSwitches(r,x.at,x.bt,{random:()=>value});assert.equal(out.defender.incoming,expected);assert.equal(x.b.__battle,undefined);assert.equal(x.bt[0],expected);}
});
test('Magic Bounce and Magic Coat really expel the original user without spending reflector PP',()=>{
 for(const condition of ['bounce','coat','noReserve']){const x=setup();if(condition==='coat')e.ensureBattleData(x.b).magicCoat=true;else x.b.passiveAbility='Magic Bounce';if(condition==='noReserve')x.at=[x.a];const expected=x.at[1],r=cast(x),out=resolveMoveSwitches(r,x.at,x.bt);assert.equal(out.defender,null);assert.equal(out.attacker?.incoming,expected);assert.equal(x.a.movePp[0],19);assert.equal(x.b.movePp[0],40);assert.equal(r.success,condition!=='noReserve');}
});
test('Cyclone cannot hit Fly/Dig, does hit Ghosts, and is not sound-based',()=>{
 for(const condition of ['fly','dig','ghost','soundproof']){const x=setup();if(condition==='fly'||condition==='dig'){const d=e.ensureBattleData(x.b);d.chargeMove=condition==='fly'?'Fly':'Dig';d.semiInvulnerable=true;}if(condition==='ghost'){x.b.type1='Ghost';x.b.type2=null;}if(condition==='soundproof')x.b.passiveAbility='Soundproof';assert.equal(cast(x).forceSwitch,['ghost','soundproof'].includes(condition),condition);}
});
test('Cyclone ends allowed single-wild encounters, respects levels and the Dark escape restriction',()=>{
 for(const condition of ['allowed','lower','dark']){const x=setup('wild');x.bt=[x.b];if(condition==='lower')x.a.level=49;if(condition==='dark')x.s.escapeForbidden=true;const r=cast(x);assert.equal(r.escape,condition==='allowed',condition);assert(!r.forceSwitch);assert.equal(r.success,condition==='allowed');}
});
test('Cyclone acts after normal moves, but before Trick Room even under Trick Room',()=>{
 for(const trick of [0,3]){const x=setup();x.a.currentSpeed=999;x.b.currentSpeed=1;x.s.field.trickRoomTurns=trick;assert.equal(e.orderBattleActions([{pokemon:x.a,moveName:'Whirlwind'},{pokemon:x.b,moveName:'Splash'}],x.s)[0].pokemon,x.b);assert.equal(e.orderBattleActions([{pokemon:x.a,moveName:'Whirlwind'},{pokemon:x.b,moveName:'Trick Room'}],x.s)[0].pokemon,x.a);}
});
for(const type of ['trainer','arena','pvp'])test(`${type}: forced replacement loses its queued action; entry hazards and next turn still run`,()=>{
 const {DriftBattle}=require('../server/game/drift/driftBattle');
 const a={userId:1,socketId:'a',alive:true,currentmap:'route1',run:{mode:'colosseum'},equipe:{pokemons:[mon('Whirlwind'),mon()]},items:{},money:0,drifts:[],equipped:[],defeated:new Set()};
 const b={...a,userId:2,socketId:'b',npc:true,equipe:{pokemons:[mon('Trick Room'),mon(),mon()]},defeated:new Set()},events=[];
 const battle=new DriftBattle(a,b,{type,emit:(p,event,data)=>events.push({event,data}),random:()=>.99,now:()=>0,paceMs:0,rules:{rewards:false,report:false,permanentDeaths:false}}),out=b.equipe.pokemons[0],incoming=b.equipe.pokemons[2];
 battle.sides[1].hazards.stealthRock=true;battle.pending.set(b,{action:'attack',number:0});
 assert(battle.action(a,{action:'attack',number:0,turnId:battle.token}));assert.equal(battle.active(1),incoming);assert.equal(out.movePp[0],5);assert.equal(incoming.movePp[0],40);assert(incoming.currentHp<500);assert.equal(battle.state.field.trickRoomTurns,0);assert.equal(battle.state.turn,2);assert(!battle.replacementPhase);battle.finish(null,'closed');
});
test('Doubles: real simulator expels only the chosen target and preserves its active ally',()=>{
 const {DoublesBattle}=require('../server/game/doubles/doublesBattle');const players=[{id:'a',username:'A',equipe:{pokemons:[mon('Whirlwind'),mon()]}},{id:'b',username:'B',equipe:{pokemons:[mon(),mon(),mon()]}}];
 const b=new DoublesBattle(...players,{emit:()=>{}}),target=b.sim.p2.active[0],ally=b.sim.p2.active[1],reserve=b.sim.p2.pokemon[2];
 b.sim.choose('p1','move Whirlwind 1, move Splash');b.sim.choose('p2','move Splash, move Splash');
 assert.equal(b.sim.p2.active[0],reserve);assert.equal(b.sim.p2.active[1],ally);assert(b.sim.log.some(s=>s.includes('|drag|')));assert(!target.isActive);assert.equal(b.sim.turn,2);b.sim.destroy();
});
for(const reactive of [false,true])test(`Raid (reactive=${reactive}): boss cannot be expelled, attack spends PP without blocking the encounter`,()=>{
 const {RaidBattle}=require('../server/game/raids/RaidBattle');const b=new RaidBattle([0,1,2,3].map(i=>({ownerId:1,ownerName:'A',pokemon:mon(i===0?'Whirlwind':'Splash')})),mon(),{reactive,seed:[1,2,3,4],now:()=>0}),boss=b.bossPokemon,hp=boss.hp;
 if(reactive){let limit=0;while(b.sim.turn<2&&!b.finished&&limit++<10){const slot=b.view(1).currentSlot;assert(b.action(1,{token:b.token,slot,action:'attack',moveIndex:0,targetLoc:1}));}}
 else for(let slot=0;slot<4;slot++)b.action(1,{token:b.token,slot,action:'attack',moveIndex:0,targetLoc:1});
 assert.equal(b.bossPokemon,boss);assert.equal(boss.hp,hp);assert(!b.finished);assert.equal(b.sim.p1.active[0].moveSlots[0].pp,19);assert.equal(b.sim.turn,2);b.sim.destroy();
});
test('Sleep Talk preserves Cyclone phazing and reflected direction without consuming Cyclone PP',()=>{
 for(const reflected of [false,true]){const x=setup();x.a.abilities=['Sleep Talk','Whirlwind'];x.a.movePp=[10,20];x.a.status='sleep';e.ensureBattleData(x.a).sleepTurns=3;if(reflected)x.b.passiveAbility='Magic Bounce';const r=rng(.5,()=>cast(x,'Sleep Talk')),out=resolveMoveSwitches(r,x.at,x.bt,{random:()=>.99});assert(r.calledMoveResolved);assert(r.randomForcedSwitch);assert.equal(Boolean(out.attacker),reflected);assert.equal(Boolean(out.defender),!reflected);assert.deepEqual(x.a.movePp,[9,20]);}
});
