const test=require('node:test'),assert=require('node:assert/strict');
const {getPnjTeam}=require('../server/game/world/pnjTeamFactory'),tactics=require('../server/game/battle/trainerTactics');
const engine=require('../server/game/battle/battleEngine'),factory=require('../server/game/drift/pokemonFactory');
const {getItemDefinition}=require('../server/game/battle/battleResources');
const codec=require('../server/game/drift/checkpointCodec'),{DriftBattle}=require('../server/game/drift/driftBattle');
const learnsets=require('../data/game/pokemonData.json'),{getCanonicalSpeciesAbility}=require('../server/game/abilities/abilityDex');
const catalog=require('../data/game/progression.json'),dialogues=require('../server/game/world/interactionRepository');
test('Lucie has six legal level 80 K4 optimized sets and unrestricted expert AI',()=>{
 const team=getPnjTeam('lucie_corrupted');
 assert.deepEqual(team.pokemons.map(p=>p.data.id),[395,65,68,196,398,350]);
 assert.deepEqual(team.pokemons.map(p=>p.heldItem),['leftovers','focus_sash','assault_vest','life_orb','choice_scarf','leftovers']);
 assert.equal(team.__trainerPlan.ai,'expert');assert.equal(team.__trainerPlan.aceUuid,undefined);
 for(const p of team.pokemons){
  assert.equal(p.level,80);assert.equal(p.k,4);assert(Object.values(p.iv).every(v=>v===31));
  assert.equal(Object.values(p.ev).reduce((s,n)=>s+n,0),508);assert(Object.values(p.ev).every(v=>v<=252));
  assert.equal(getCanonicalSpeciesAbility(p.data.id,p.passiveAbility),p.passiveAbility);
  assert(getItemDefinition(p.heldItem).battle_effect);assert.equal(p.abilities.length,4);assert(p.movePp.every(v=>v>0));
  for(const name of p.abilities){assert(learnsets[p.data.id].includes(name.toLowerCase().replace(/[^a-z0-9]+/g,'-')),name);assert(engine.getMoveByName(name));}
 }
 assert(team.pokemons[2].abilities.every(n=>engine.getMoveByName(n).combat.damage_class!=='status'));
 for(let i=1;i<6;i++){const copy=getPnjTeam('lucie_corrupted');[copy.pokemons[1],copy.pokemons[i]]=[copy.pokemons[i],copy.pokemons[1]];copy.pokemons[0].currentHp=0;assert.equal(tactics.replacementIndex(copy),1);}
 team.pokemons[0].currentHp=0;assert(getPnjTeam('lucie_corrupted').pokemons[0].currentHp>0);
});
test('Lucie expert choices are legal, independent of private opponent IVs and items',()=>{
 const team=getPnjTeam('lucie_corrupted'),foe=factory.create(445,80,true),field=engine.createBattleState(),memory=tactics.createMemory();
 tactics.observe(team,memory,foe,'Earthquake');
 const choice=tactics.chooseAction(team,foe,field,memory,1);assert(choice);
 assert.deepEqual(choice,tactics.chooseAction(team,{...foe,heldItem:'focus_sash',iv:{},ev:{},passiveAbility:'Wonder Guard'},field,memory,1));
 assert(choice.action==='attack'?team.pokemons[0].abilities[choice.number]:team.pokemons[choice.number]);
});
test('Lucie needs 7p then a new victory; the old reunion flag cannot skip her battle',()=>{
 const{deriveStoryQuest}=require('../server/game/world/storyProgression');
 assert.equal(dialogues.getSentenceForName('lucie_route2',{flags:{}})[1],'lucie_route2_locked');
 const beforeLucie=catalog.storySteps.findIndex(s=>s.flag==='lucie_freed');assert(beforeLucie>0);
 const flags=Object.fromEntries(catalog.storySteps.slice(0,beforeLucie).map(s=>[s.flag,'true']));flags.lucie_reunited='true';
 assert.equal(dialogues.getSentenceForName('lucie_route2',{flags})[1],'lucie_route2');
 assert.equal(dialogues.getEndSentenceInformation('lucie_route2'),'battle');assert.equal(deriveStoryQuest({flags}).status,'active');
 assert.equal(catalog.storyEvents.lucie_route2,undefined);
 assert(catalog.npcBattles.lucie_route2.once&&catalog.npcBattles.lucie_route2.uniqueExperience);
 flags.lucie_freed='true';assert.equal(deriveStoryQuest({flags}).status,'active');
 assert.equal(dialogues.getSentenceForName('lucie_route2',{flags})[1],'lucie_route2_after');
 assert.notEqual(dialogues.getEndSentenceInformation('lucie_route2_after'),'battle');
 for(const step of catalog.storySteps.slice(beforeLucie+1))flags[step.flag]='true';
 assert.equal(deriveStoryQuest({flags}).status,'completed');
});
for(const mode of ['rift','colosseum'])test(`${mode}: Lucie expert team survives the shared encounter/checkpoint path`,()=>{
 const p={userId:1,currentmap:'route2_maison',run:{mode},equipe:{pokemons:[factory.create(9,80,true)]},drifts:[],equipped:[],chain:0,items:{},defeated:new Set(),money:0};
 const b=new DriftBattle(p,{npc:true,equipe:getPnjTeam('lucie_corrupted'),drifts:[],equipped:[],chain:0},{type:'trainer',npcKey:'lucie_route2',paceMs:0,emit(){}});
 assert(b.defaultAction(b.b));const restored=codec.decode(codec.encode(b));assert.equal(restored.b.equipe.__trainerPlan.ai,'expert');assert.equal(restored.b.equipe.__trainerPlan.aceUuid,undefined);assert(restored.b.equipe.pokemons.every(p=>p.level===80&&p.k===4));b.finished=restored.finished=true;
});
