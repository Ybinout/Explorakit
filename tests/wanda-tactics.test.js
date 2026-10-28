const test=require('node:test'),assert=require('node:assert/strict');
const {getPnjTeam}=require('../server/game/world/pnjTeamFactory'),tactics=require('../server/game/battle/trainerTactics');
const engine=require('../server/game/battle/battleEngine'),factory=require('../server/game/drift/pokemonFactory');
const codec=require('../server/game/drift/checkpointCodec'),{DriftBattle}=require('../server/game/drift/driftBattle');
const learnsets=require('../data/game/pokemonData.json'),{getCanonicalSpeciesAbility}=require('../server/game/abilities/abilityDex'),{getMaxMovePp}=require('../server/game/battle/battleResources');
test('Wanda: six arena-level partners, three K3/three K4, good imperfect IVs except Metagross, legal trained sets and no reserved ace',()=>{
 const team=getPnjTeam('wanda'),other=getPnjTeam('wanda'),items=new Set(require('../data/game/items.json').items.map(i=>i.key));
 assert.deepEqual(team.pokemons.map(p=>[p.data.id,p.level,p.k]),[[373,52,3],[68,52,3],[121,53,3],[65,53,4],[6,54,4],[376,54,4]]);
 for(const [i,p]of team.pokemons.entries()){
  const ivs=Object.values(p.iv);assert(ivs.every(n=>i===5?n===31:n>=24&&n<=30));if(i<5)assert(new Set(ivs).size>=3);
  assert.equal(Object.values(p.ev).reduce((s,n)=>s+n,0),508);assert(Object.values(p.ev).every(n=>n>=0&&n<=252));
  assert.equal(getCanonicalSpeciesAbility(p.data.id,p.passiveAbility),p.passiveAbility);assert.equal(p.abilities.length,4);
  for(const name of p.abilities){const slug=name.toLowerCase().replace(/[^a-z0-9]+/g,'-');
   // Egg moves learned by Machop remain available after evolving into Machamp.
   assert(learnsets[p.data.id].includes(slug)||(p.data.id===68&&learnsets[66].includes(slug)),p.name+': '+name);assert(engine.getMoveByName(name));}
  assert.deepEqual(p.movePp,p.abilities.map(getMaxMovePp));assert(items.has(p.heldItem));
 }
 assert.equal(team.__trainerPlan.ai,'expert');assert.equal(team.__trainerPlan.aceUuid,undefined);assert(!JSON.stringify(team).includes('__trainerPlan'));
 assert.deepEqual(team.pokemons.map(p=>p.heldItem),['lum_berry','assault_vest','leftovers','focus_sash','life_orb','shuca_berry']);
 assert.equal(team.pokemons[1].passiveAbility,'No Guard');assert.equal(team.pokemons[3].passiveAbility,'Magic Guard');assert.equal(team.pokemons[5].passiveAbility,'Clear Body');
 team.pokemons[0].currentHp=0;team.pokemons[0].movePp[0]=0;assert(other.pokemons[0].currentHp>0);assert(other.pokemons[0].movePp[0]>0);
 for(let i=1;i<6;i++){const t=getPnjTeam('wanda');[t.pokemons[1],t.pokemons[i]]=[t.pokemons[i],t.pokemons[1]];t.pokemons[0].currentHp=0;assert.equal(tactics.replacementIndex(t),1,'every member is immediately eligible, including Metagross');}
});
test('Wanda can immediately send her last slot against a bad matchup, with four others alive and no reading of hidden moves/items',()=>{
 const team=getPnjTeam('wanda');for(let i=1;i<5;i++)team.pokemons[i].currentHp=1;
 const enemy=factory.create(468,49,true),field=engine.createBattleState(),memory=tactics.createMemory();
 assert.deepEqual(tactics.chooseAction(team,enemy,field,memory,1),{action:'change',number:5});assert.equal(team.pokemons[5].data.id,376);
 const hidden={...enemy,movePp:[0],heldItem:'focus_sash',iv:{},ev:{},passiveAbility:'Wonder Guard'};
 assert.deepEqual(tactics.chooseAction(team,enemy,field,memory,1),tactics.chooseAction(team,hidden,field,memory,1));
});
for(const mode of ['rift','colosseum'])test(`${mode}: real Wanda team, individual IVs and unrestricted expert plan survive a checkpoint`,()=>{
 const p={userId:1,currentmap:'ville4_arene',run:{mode},equipe:{pokemons:[factory.create(9,49,true)]},drifts:[],equipped:[],chain:0,items:{},defeated:new Set(),money:0};
 const b=new DriftBattle(p,{npc:true,equipe:getPnjTeam('wanda'),drifts:[],equipped:[],chain:0},{type:'arena',npcKey:'champion_wanda',paceMs:0,emit(){}});
 assert.equal(b.active(1).data.id,373);assert(b.defaultAction(b.b));const restored=codec.decode(codec.encode(b));assert.equal(restored.b.equipe.__trainerPlan.ai,'expert');assert.equal(restored.b.equipe.__trainerPlan.aceUuid,undefined);assert.deepEqual(restored.b.equipe.pokemons.map(p=>p.iv),b.b.equipe.pokemons.map(p=>p.iv));
 const encountered=new Set([373]);while(b.active(1)){b.active(1).currentHp=0;b.prune();if(b.active(1))encountered.add(b.active(1).data.id);}
 assert.deepEqual([...encountered].sort((a,b)=>a-b),[6,65,68,121,373,376]);b.finished=restored.finished=true;
});

test('Wanda protects her team from rocks with Staross and uses Encore against a completed recovery move',()=>{
 const ai=require('../server/game/battle/humanTrainerAI'),team=getPnjTeam('wanda').pokemons,star=team[2],foe=factory.create(143,53,true);
 foe.abilities=['Splash'];foe.movePp=[40];foe.currentHp=foe.maxHp=2000;engine.ensureBattleData(foe);
 const field=engine.createBattleState(),options={team:[star,...team.filter(p=>p!==star)],opponentTeam:[foe],field,
  ownSide:field.sides.enemy,enemySide:field.sides.player,memory:{},round:1};
 assert.notEqual(ai.chooseAction(options).number,3,'do not waste a turn spinning a clear field');
 field.sides.enemy.hazards.stealthRock=true;const before=JSON.stringify(options);
 assert.deepEqual(ai.chooseAction(options),{action:'attack',number:3});assert.equal(JSON.stringify(options),before);
 foe.abilities=['Recover','Body Slam'];foe.movePp=foe.abilities.map(getMaxMovePp);foe.__battle.lastMoveUsed='Recover';foe.currentHp=1500;
 const clear=engine.createBattleState(),encore={...options,team:[team[3]],field:clear,ownSide:clear.sides.enemy,enemySide:clear.sides.player};
 assert.deepEqual(ai.chooseAction(encore),{action:'attack',number:3});
 Object.defineProperty(clear,'turnActions',{get(){throw Error('must not read the selected player action');}});
 assert.deepEqual(ai.chooseAction(encore),{action:'attack',number:3});
});
