const test=require('node:test'),assert=require('node:assert/strict');
const {canFleeWildBattle}=require('../server/game/battle/wildEscape');
const engine=require('../server/game/battle/battleEngine');
const factory=require('../server/game/drift/pokemonFactory');
const {DriftBattle}=require('../server/game/drift/driftBattle');
function pokemon(id,level){const p=factory.create(id,level,true);p.passiveAbility=null;return p;}

test('wild escape: an enemy six levels higher bypasses trapping, without changing switching or KO rules',()=>{
 for(const delta of [-7,-6,0,5,6,7,40])for(const trap of ['Arena Trap','Shadow Tag','Magnet Pull','bind','ingrain','skyDrop']){
  const a=pokemon(81,20),b=pokemon(50,20+delta),state=engine.createBattleState();
  if(trap==='bind')engine.ensureBattleData(a).trappedTurns=4;
  else if(trap==='ingrain')engine.ensureBattleData(a).ingrain=true;
  else if(trap==='skyDrop')engine.ensureBattleData(a).skyDropBy=b.uuid;
  else b.passiveAbility=trap;
  assert.equal(canFleeWildBattle(a,b,state),delta>=6,`${trap}: ${delta}`);
  assert.equal(engine.canSwitchOut(a,b,state),false,'switching remains trapped regardless of the level gap');
  a.currentHp=0;assert.equal(canFleeWildBattle(a,b,state),false);
 }
});

test('ordinary wild escape and existing Ghost/Run Away exemptions do not gain an RNG failure',()=>{
 for(const delta of [-50,-7,0,5,6]){
  const a=pokemon(7,60+delta),b=pokemon(19,60),state=engine.createBattleState();
  assert.equal(canFleeWildBattle(a,b,state),true);
 }
 for(const [id,ability] of [[92,null],[7,'Run Away']]){
  const a=pokemon(id,5),b=pokemon(50,50),state=engine.createBattleState();a.passiveAbility=ability;b.passiveAbility='Arena Trap';
  assert.equal(canFleeWildBattle(a,b,state),true);
 }
});

for(const mode of ['rift','colosseum'])test(`${mode}: real wild battle accepts escape against a higher-level trapper and grants no XP`,()=>{
 const lead=pokemon(7,20),foe=pokemon(50,26);foe.passiveAbility='Arena Trap';
 const p={id:1,run:{mode},equipe:{pokemons:[lead]},items:{},drifts:[],equipped:[]};
 const enemy={npc:true,equipe:{pokemons:[foe]},drifts:[],equipped:[]};let outcome;
 const battle=new DriftBattle(p,enemy,{type:'wild',now:()=>100,random:()=>.5,paceMs:0,emit:()=>{},onFinish:(_battle,_winner,reason)=>outcome=reason});
 const before=lead.experience;assert(battle.action(p,{action:'flee',turnId:battle.token}));assert(battle.finished);assert.equal(outcome,'fled');assert.equal(lead.experience,before);
});
