const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../server/game/battle/battleEngine');
const resources = require('../server/game/battle/battleResources');
const moves = require('../data/game/moves.json');
const factory = require('../server/game/drift/pokemonFactory');
function fixture(name, random = .5) {
 const a=factory.create(1,50,true),d=factory.create(7,50,true),state=engine.createBattleState();
 for(const p of [a,d]) {p.data={...p.data};p.passiveAbility=null;p.heldItem=null;p.type1='Normal';p.type2=null;p.currentHp=p.maxHp=2000;}
 a.abilities=[name];a.movePp=[resources.getMaxMovePp(name)];
 const run=(move=name,source=a,target=d)=>{const old=Math.random;Math.random=()=>random;try{return engine.useattack(move,source,target,{battleState:state,attackerSide:state.sides.player,defenderSide:state.sides.enemy,attackerTeam:[source],defenderTeam:[target]});}finally{Math.random=old;}};
 return {a,d,state,run};
}
const drops={'Close Combat':{defense:-1,specialDefense:-1},'Superpower':{attack:-1,defense:-1},'Overheat':{specialAttack:-2},'Leaf Storm':{specialAttack:-2},'Draco Meteor':{specialAttack:-2},'Psycho Boost':{specialAttack:-2},'Hammer Arm':{speed:-1},'V-create':{speed:-1,defense:-1,specialDefense:-1}};
for(const [move,stats]of Object.entries(drops))test(`${move}: primary self drops on hit, KO and substitute, never on immunity`,()=>{
 for(const target of ['normal','ko','substitute','immune']){
  const {a,d,run}=fixture(move);if(target==='ko')d.currentHp=1;if(target==='substitute')engine.ensureBattleData(d).substituteHp=1900;
  if(target==='immune') {if(['Close Combat','Superpower','Hammer Arm'].includes(move))d.type1='Ghost';else if(move==='Draco Meteor')d.type1='Fairy';else if(move==='Psycho Boost')d.type1='Dark';else d.passiveAbility=move==='Leaf Storm'?'Sap Sipper':'Flash Fire';}
  run();for(const [stat,value]of Object.entries(stats))assert.equal(a.__battle.statStages[stat],target==='immune'?0:value,target+':'+stat);
 }
});
test('primary drops obey Contrary and are not removed by Sheer Force',()=>{
 for(const ability of ['Contrary','Sheer Force']){const {a,run}=fixture('Overheat');a.passiveAbility=ability;run();assert.equal(a.__battle.statStages.specialAttack,ability==='Contrary'?2:-2);}
});
for(const move of ['Hyper Beam','Giga Impact','Blast Burn','Hydro Cannon','Frenzy Plant','Rock Wrecker','Roar of Time'])test(`${move}: one forced recharge, including KO/clone, no second PP cost`,()=>{
 for(const defense of ['normal','ko','substitute','protect','miss','immune']){
  const {a,d,state,run}=fixture(move,defense==='miss'?.999:.5);
  if(defense==='ko')d.currentHp=1;if(defense==='substitute')engine.ensureBattleData(d).substituteHp=1900;
  if(defense==='protect')engine.ensureBattleData(d).protect=true;
  if(defense==='immune')d.passiveAbility='Wonder Guard';
  const pp=a.movePp[0];run();const expected=['normal','ko','substitute'].includes(defense);
  assert.equal(Boolean(resources.getForcedMove?.(a)),expected,defense);
  if(expected){assert.equal(engine.canSwitchOut(a,d,state),false);state.turn++;d.currentHp=2000;const r=run();assert.equal(r.damage,0);assert(r.messages.some(m=>/recharg/i.test(m)));assert.equal(a.movePp[0],pp-1);assert.equal(resources.getForcedMove(a),null);assert(engine.canSwitchOut(a,d,state));}
 }
});
for(const move of ['Low Kick','Grass Knot'])test(`${move}: target weight only, with Light/Heavy Metal`,()=>{
 const {a,d}=fixture(move),m=moves.find(m=>m.ename===move);
 for(const [id,power]of [[92,20],[4,20],[7,20],[25,20],[1,20],[8,40],[3,100],[143,120]]){
  d.data.id=id;assert.equal(engine.getSpecialMoveResolution(m,a,d).power,power,`species ${id}`);
 }
 d.data.id=3;d.passiveAbility='Light Metal';assert.equal(engine.getSpecialMoveResolution(m,a,d).power,80);
 d.passiveAbility='Heavy Metal';assert.equal(engine.getSpecialMoveResolution(m,a,d).power,120);
});
for(const name of ['Flail','Reversal'])test(`${name}: all HP brackets`,()=>{
 const {a,d}=fixture(name);a.maxHp=480;const m=moves.find(m=>m.ename===name);
 for(const [hp,power]of [[1,200],[19,200],[20,150],[49,150],[50,100],[99,100],[100,80],[169,80],[170,40],[329,40],[330,20],[480,20]]){a.currentHp=hp;assert.equal(engine.getSpecialMoveResolution(m,a,d).power,power,`hp ${hp}`);}
});
test('Trump Card scales with PP left after spending the current PP',()=>{
 const damages=[];for(const pp of [5,4,3,2,1]){const {a,run}=fixture('Trump Card');a.movePp=[pp];damages.push(run().damage);assert.equal(a.movePp[0],pp-1);}
 for(let i=1;i<damages.length;i++)assert(damages[i]>damages[i-1],JSON.stringify(damages));
});
test('Final Gambit does not sacrifice into Ghost; does sacrifice into Substitute',()=>{
 for(const defense of ['ghost','substitute']){const {a,d,run}=fixture('Final Gambit');a.currentHp=100;if(defense==='ghost')d.type1='Ghost';else engine.ensureBattleData(d).substituteHp=200;const r=run();assert.equal(a.currentHp,defense==='ghost'?100:0);assert.equal(d.currentHp,2000);assert.equal(r.substituteDamage,defense==='ghost'?0:100);}
});
for(const [move,incoming]of [['Counter','Tackle'],['Mirror Coat','Water Gun'],['Metal Burst','Tackle']])test(`${move}: cannot reflect damage from a previous turn`,()=>{
 const {a,d,state,run}=fixture(move);const hit=run(incoming,d,a);assert(hit.damage>0);assert(run().damage>0);state.turn++;assert.equal(run().damage,0);
});
test('Substitute: drain, recoil, fixed damage and pivot account for clone damage',()=>{
 for(const move of ['Absorb','Double-Edge','Seismic Toss','U-turn','Volt Switch']){
  const {a,d,run}=fixture(move);engine.ensureBattleData(d).substituteHp=1000;a.currentHp=1000;
  const r=run();assert.equal(r.damage,0);assert(r.substituteDamage>0,move);
  if(move==='Absorb')assert(a.currentHp>1000);if(move==='Double-Edge')assert(a.currentHp<1000);
  if(['U-turn','Volt Switch'].includes(move))assert(r.switchSelf,move);
 }
});
test('Power-Up Punch self boost works after KO or against a clone',()=>{
 for(const target of ['ko','substitute']){const {a,d,run}=fixture('Power-Up Punch');if(target==='ko')d.currentHp=1;else engine.ensureBattleData(d).substituteHp=1000;run();assert.equal(a.__battle.statStages.attack,1,target);}
});
test('Rest cures old status, heals and sleeps exactly two future turns; Insomnia prevents healing',()=>{
 for(const ability of [null,'Insomnia','Vital Spirit']){const {a,state,run}=fixture('Rest');a.currentHp=100;a.status='poison';a.passiveAbility=ability;run();assert.equal(a.currentHp,ability?100:2000);assert.equal(a.status,ability?'poison':'sleep');if(!ability){for(let i=0;i<2;i++){state.turn++;assert.equal(run('Tackle').damage,0);}state.turn++;assert(run('Tackle').damage>0);}}
});
test('Beat Up hits once per fit teammate, with species base attack; fainted/statused reserves excluded',()=>{
 const {a,d,state}=fixture('Beat Up'),bench=[factory.create(4,50,true),factory.create(7,50,true),factory.create(25,50,true)];bench[1].currentHp=0;bench[2].status='poison';
 const old=Math.random;Math.random=()=>.5;try{const r=engine.useattack('Beat Up',a,d,{battleState:state,attackerTeam:[a,...bench]});assert.equal(r.hits,2);assert(r.damage>0);}finally{Math.random=old;}
 const m=moves.find(m=>m.ename==='Beat Up');assert.deepEqual(engine.getSpecialMoveResolution(m,a,d,{attackerTeam:[a,...bench]}).hitPowers,[9,10]);
});
test('Bide stores two turns of direct damage, releases double even on Ghost, consumes only one PP',()=>{
 const {a,d,state,run}=fixture('Bide');d.type1='Ghost';assert.equal(run().damage,0);assert.equal(resources.getForcedMove(a),'Bide');
 const first=run('Water Gun',d,a).damage;state.turn++;assert.equal(run().damage,0);const second=run('Water Gun',d,a).damage;state.turn++;
 assert.equal(run().damage,2*(first+second));assert.equal(a.movePp[0],9);assert.equal(resources.getForcedMove(a),null);
});
test('Bide is interrupted by inability to act and cannot return old damage',()=>{
 const {a,d,state,run}=fixture('Bide');run();run('Tackle',d,a);state.turn++;engine.ensureBattleData(a).flinch=true;run();assert.equal(resources.getForcedMove(a),null);state.turn++;assert.equal(run().damage,0);assert.equal(a.__battle.bideDamage,0);
});
test('Rest activates a held Chesto Berry after falling asleep',()=>{
 const {a,run}=fixture('Rest');a.currentHp=100;a.heldItem='chesto_berry';run();assert.equal(a.currentHp,2000);assert.equal(a.status,'normal');assert.equal(a.heldItem,null);
});
test('Protect/Endure share diminishing success on consecutive turns; reset after failure or another move',()=>{
 for(const second of ['Protect','Detect','Endure']){
  const {a,d,state,run}=fixture('Protect');run();assert(a.__battle.protect);state.turn++;a.__battle.protect=false;const r=run(second);assert.equal(r.success,false);assert(!a.__battle.protect);assert(!a.__battle.endure);
  state.turn++;assert(run().success);state.turn++;run('Splash');state.turn++;assert(run().success);
 }
});
test('Fling keeps its item on type immunity and consumes on a clone hit',()=>{
 for(const defense of ['immune','substitute']){const {a,d,run}=fixture('Fling');a.heldItem='leftovers';if(defense==='immune'){a.passiveAbility='Normalize';d.type1='Ghost';}else engine.ensureBattleData(d).substituteHp=1000;run();assert.equal(a.heldItem,defense==='immune'?'leftovers':null);}
});
const {DriftBattle}=require('../server/game/drift/driftBattle');
for(const mode of ['rift','colosseum'])test(`${mode}: real battle automatically resolves recharge then returns controls`,()=>{
 const {a:lead,d:enemy}=fixture('Hyper Beam'),events=[];lead.currentSpeed=999;enemy.currentSpeed=1;enemy.abilities=['Splash'];enemy.movePp=[40];
 const player={userId:1,run:{mode},equipe:{pokemons:[lead]},items:{},money:0,drifts:[],equipped:[],defeated:new Set()};
 const npc={npc:true,equipe:{pokemons:[enemy]},drifts:[],equipped:[]};
 const battle=new DriftBattle(player,npc,{type:'wild',paceMs:0,random:()=>.5,emit:(_,name,payload)=>events.push({name,payload:JSON.parse(JSON.stringify(payload))})});
 const old=Math.random;Math.random=()=>.5;try{
  assert(battle.action(player,{action:'attack',number:0,turnId:battle.token}));
  const hp=enemy.currentHp;battle.tick();assert.equal(enemy.currentHp,hp);assert.equal(lead.movePp[0],4);battle.tick();assert(battle.awaiting);assert(!battle.pending.has(player));
  assert(events.some(e=>JSON.stringify(e.payload).includes('recharger son énergie')));battle.finish(null,'fled');
 }finally{Math.random=old;}
});
test('called moves pay Life Orb only once and preserve substitute damage',()=>{
 const {a,d,run}=fixture('Nature Power');a.heldItem='life_orb';a.currentHp=1000;engine.ensureBattleData(d).substituteHp=1000;
 const r=run();assert.equal(a.currentHp,800);assert(r.substituteDamage>0);assert.equal(a.movePp[0],19);
});
test('Sleep Talk/Snore require sleep, allow attacking while asleep, and do not prevent waking',()=>{
 for(const move of ['Sleep Talk','Snore']){
  const {a,state,run}=fixture(move);a.abilities=[move,'Tackle'];a.movePp=[10,35];assert.equal(run().damage,0);
  a.status='sleep';engine.ensureBattleData(a).sleepTurns=3;
  for(let i=0;i<2;i++){state.turn++;assert(run().damage>0,move);assert.equal(a.status,'sleep');}
  state.turn++;assert.equal(run().damage,0);assert.equal(a.status,'normal');assert.equal(a.movePp[1],35);
 }
});
