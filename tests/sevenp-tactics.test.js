const test=require('node:test'),assert=require('node:assert/strict');
const {getPnjTeam}=require('../server/game/world/pnjTeamFactory'),tactics=require('../server/game/battle/trainerTactics');
const engine=require('../server/game/battle/battleEngine'),factory=require('../server/game/drift/pokemonFactory');
const codec=require('../server/game/drift/checkpointCodec'),{DriftBattle}=require('../server/game/drift/driftBattle');
const learnsets=require('../data/game/pokemonData.json'),{getCanonicalSpeciesAbility}=require('../server/game/abilities/abilityDex');
test('7p: six maximally trained legal K4 partners, coherent items, full expert policy and no reserved ace',()=>{
 const team=getPnjTeam('sevenp'),other=getPnjTeam('sevenp');
 assert.deepEqual(team.pokemons.map(p=>[p.data.id,p.level]),[[51,60],[257,61],[94,61],[80,61],[135,62],[130,63]]);
 assert.deepEqual(team.pokemons.map(p=>p.heldItem),['focus_sash','life_orb','life_orb','leftovers','choice_specs','lum_berry']);
 assert.equal(team.__trainerPlan.ai,'expert');assert.equal(team.__trainerPlan.aceUuid,undefined);
 for(const p of team.pokemons){assert.equal(p.k,4);assert(Object.values(p.iv).every(v=>v===31));assert.equal(Object.values(p.ev).reduce((s,n)=>s+n,0),508);assert(Object.values(p.ev).every(v=>v<=252));assert.equal(getCanonicalSpeciesAbility(p.data.id,p.passiveAbility),p.passiveAbility);assert.equal(p.abilities.length,4);assert(p.movePp.every(v=>v>0));for(const n of p.abilities){assert(learnsets[p.data.id].includes(n.toLowerCase().replace(/[^a-z0-9]+/g,'-')));assert(engine.getMoveByName(n));}}
 assert.equal(team.pokemons[0].passiveAbility,'Arena Trap');assert.equal(team.pokemons[1].passiveAbility,'Speed Boost');
 team.pokemons[0].currentHp=0;team.pokemons[0].movePp[0]=0;assert(other.pokemons[0].currentHp>0);assert(other.pokemons[0].movePp[0]>0);
 for(let i=1;i<6;i++){const t=getPnjTeam('sevenp');[t.pokemons[1],t.pokemons[i]]=[t.pokemons[i],t.pokemons[1]];t.pokemons[0].currentHp=0;assert.equal(tactics.replacementIndex(t),1,'every partner is eligible immediately');}
});
test('7p: Arena Trap respects grounded/airborne/Ghost exceptions; Turbo raises speed and expert AI avoids immunities honestly',()=>{
 const team=getPnjTeam('sevenp'),field=engine.createBattleState({mapName:'ville5_arene'}),foe=factory.create(25,55,true);
 assert.equal(engine.canSwitchOut(foe,team.pokemons[0],field),false);
 for(const id of [130,94])assert.equal(engine.canSwitchOut(factory.create(id,55,true),team.pokemons[0],field),true);
 const blaze=team.pokemons[1];engine.ensureBattleData(blaze);const speed=engine.getBattleSpeed(blaze,field.sides.enemy,field);engine.processEndOfRound(blaze,foe,field.sides.enemy,field.sides.player,field);assert(engine.getBattleSpeed(blaze,field.sides.enemy,field)>speed);
 const flying=factory.create(468,55,true),memory=tactics.createMemory();const d=tactics.chooseAction(team,flying,field,memory,1);assert(d);if(d.action==='attack')assert.notEqual(team.pokemons[0].abilities[d.number],'Earthquake');
 const hidden={...flying,heldItem:'focus_sash',iv:{},ev:{}};assert.deepEqual(d,tactics.chooseAction(team,hidden,field,memory,1));
 assert.equal(JSON.stringify(team).includes('__trainerPlan'),false);
});
test('7p can immediately switch to his final slot when its matchup is best, even with four other partners alive',()=>{
 const team=getPnjTeam('sevenp');[team.pokemons[0],team.pokemons[4]]=[team.pokemons[4],team.pokemons[0]];for(let i=1;i<5;i++)team.pokemons[i].currentHp=1;
 const enemy=factory.create(445,56,true),field=engine.createBattleState(),memory=tactics.createMemory();tactics.observe(team,memory,enemy,'Earthquake');
 assert.deepEqual(tactics.chooseAction(team,enemy,field,memory,1),{action:'change',number:5});assert.equal(team.pokemons[5].data.id,130);
});
for(const mode of ['rift','colosseum'])test(`${mode}: 7p team and unrestricted expert policy survive the real battle/checkpoint path`,()=>{
 const p={userId:1,currentmap:'ville5_arene',run:{mode},equipe:{pokemons:[factory.create(9,55,true)]},drifts:[],equipped:[],chain:0,items:{},defeated:new Set(),money:0};
 const b=new DriftBattle(p,{npc:true,equipe:getPnjTeam('sevenp'),drifts:[],equipped:[],chain:0},{type:'arena',npcKey:'champion_7p',paceMs:0,emit(){}});
 assert.equal(b.active(1).data.id,51);assert(b.defaultAction(b.b));const restored=codec.decode(codec.encode(b));assert.equal(restored.b.equipe.__trainerPlan.ai,'expert');assert.equal(restored.b.equipe.__trainerPlan.aceUuid,undefined);assert(restored.b.equipe.pokemons.every(p=>p.k===4));b.finished=restored.finished=true;
});
test('Route2 house uses a reachable painted door, safe bidirectional arrivals and a permanent victory gate',()=>{
 const maps=require('../server/game/world/mapRepository'),{transitionBlock,deriveStoryQuest}=require('../server/game/world/storyProgression'),catalog=require('../data/game/progression.json');
 const next=maps.getNextMap('route2',18,7);assert.equal(maps.changeMapData('route2')[7][18],1);assert.equal(maps.loadCollisionData('route2')[7][18],0);assert(transitionBlock(next));assert.equal(transitionBlock(next,{sevenp_defeated:'true'}),null);assert.equal(next.nextMap,'route2_maison');
 assert.deepEqual([next.nextX,next.nextY],[432,528]);assert.equal(maps.loadCollisionData(next.nextMap)[16][13],0);assert.equal(maps.changeMapData(next.nextMap)[16][13],0);
 const back=maps.getNextMap('route2_maison',13,17);assert.deepEqual([back.nextMap,back.nextX,back.nextY],['route2',592,272]);assert.equal(maps.changeMapData('route2')[8][18],0);
 const flags=Object.fromEntries(catalog.storySteps.slice(0,7).map(s=>[s.flag,'true']));flags.gwenn_rochebrume_defeated='true';assert.equal(deriveStoryQuest({flags}).map,'ville5_arene');flags.sevenp_defeated='true';assert.equal(deriveStoryQuest({flags}).map,'route2_maison');flags.lucie_reunited='true';assert.equal(deriveStoryQuest({flags}).status,'active');flags.lucie_freed='true';assert.equal(deriveStoryQuest({flags}).map,'route2');assert.equal(deriveStoryQuest({flags}).status,'active');assert.equal(catalog.storyEvents.ch2_clara.enabled,false);
});
