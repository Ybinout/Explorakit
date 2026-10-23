const test=require('node:test'),assert=require('node:assert/strict');
const {hasEquippedExpShare}=require('../server/game/items/expShare');
const {rememberPartyOrder}=require('../server/game/battle/partyOrder');
const {AdventureExperience}=require('../server/game/battle/adventureExperience');
const factory=require('../server/game/drift/pokemonFactory');
test('Multi Exp requires the chosen first party member; bag, reserve and temporary switches do not change ownership',()=>{
 const first={heldItem:null},second={heldItem:'exp_share'},team={pokemons:[first,second]};
 assert(!hasEquippedExpShare(team.pokemons));rememberPartyOrder(team);team.pokemons.reverse();assert(!hasEquippedExpShare(team.pokemons));
 first.heldItem='exp_share';second.heldItem=null;assert(hasEquippedExpShare(team.pokemons));
 first.heldItem=null;assert(!hasEquippedExpShare(team.pokemons));assert(!hasEquippedExpShare([]));
});
test('Adventure sharing follows equipment at reward time, with normal participant XP when inactive',()=>{
 for(const holder of ['bag','reserve','first']){
  const lead=factory.create(7,20,true),reserve=factory.create(4,20,true),foe=factory.create(19,20,true);
  if(holder==='first')lead.heldItem='exp_share';if(holder==='reserve')reserve.heldItem='exp_share';
  const p={id:'test',items:{exp_share:1},equipe:{pokemons:[lead,reserve]}};
  const tracker=new AdventureExperience({expShare:'equipped'});
  tracker.enter(lead,foe);foe.currentHp=0;
  assert.equal(tracker.reward(p,foe,1,{to:()=>({emit(){}})}).length,holder==='first'?2:1);
 }
});
