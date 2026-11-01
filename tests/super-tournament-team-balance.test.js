const test=require('node:test'),assert=require('node:assert/strict');
const content=require('../server/game/superTournament/content'),sets=require('../server/game/superTournament/teamSets'),engine=require('../server/game/battle/battleEngine'),factory=require('../server/game/drift/pokemonFactory'),resources=require('../server/game/battle/battleResources'),ability=require('../server/game/abilities/abilityDex');
const changed=[[2,0,470],[3,0,171],[5,1,254],[6,2,423],[9,0,3],[10,0,346],[12,0,479],[13,0,465],[15,0,473]],fullSets=Object.entries(sets).filter(([,s])=>s.abilities);
function mon(id,moves){const p=factory.create(id,90,true);p.passiveAbility=id===135?'Volt Absorb':'Natural Cure';p.heldItem=null;p.abilities=moves;p.movePp=moves.map(resources.getMaxMovePp);return p;}
function fixed(fn){const random=Math.random;Math.random=()=>.25;try{return fn();}finally{Math.random=random;}}
function hit(move,a,b){const field=engine.createBattleState();return fixed(()=>engine.useattack(move,a,b,{battleState:field,attackerSide:field.sides.player,defenderSide:field.sides.enemy}));}
test('nine replacements diversify the tower while keeping the authored order and signature trios',()=>{
 for(const [room,slot,id]of changed)assert.equal(content.createTeam(room).pokemons[slot].data.id,id);
 for(const [room,ids]of [[0,[19,19,20]],[1,[475,373,448]],[4,[430,472,461]],[7,[271,208,351]],[8,[253,448,445]],[11,[154,407,282]],[14,[51,257,130]]])assert.deepEqual(content.createTeam(room).pokemons.map(p=>p.data.id),ids);
});
test('every new species has four legal existing moves, an existing held item and its real available ability',()=>{
 const machines=Object.values(require('../data/game/machines.json').machines);assert.equal(fullSets.length,9);
 for(const[id,set]of fullSets){assert(+id>=1&&+id<=493);assert.equal(new Set(set.abilities).size,4);assert.equal(ability.getCanonicalSpeciesAbility(+id,set.passiveAbility),set.passiveAbility);assert(resources.getItemDefinition(set.heldItem),set.heldItem);
  for(const move of set.abilities){assert(engine.getMoveByName(move),move);assert(machines.some(m=>m.move===move&&m.species.includes(+id)),`${id}: ${move} learns in the existing catalogue`);}
 }
});
test('trained profiles retain K4, IV31, full HP/PP and consistent moves, items and EVs across repeated cycles',()=>{
 for(const[room,slot,id]of changed)for(const cycle of [0,1,3]){const p=content.createTeam(room+16*cycle).pokemons[slot],set=sets[id];assert.equal(p.level,[75,85,90][slot]+20*cycle);assert.equal(p.k,4);assert(Object.values(p.iv).every(v=>v===31));assert.equal(Object.values(p.ev).reduce((a,b)=>a+b,0),508);assert.equal(p.currentHp,p.maxHp);assert.deepEqual(p.abilities,set.abilities);assert.deepEqual(p.movePp,p.abilities.map(resources.getMaxMovePp));assert.equal(p.nature,set.nature);assert.equal(p.passiveAbility,set.passiveAbility);assert.equal(p.heldItem,set.heldItem);}
});
test('special Lucario/Porygon-Z and physical Grovyle/Azumarill invest in their actual attacking stat',()=>{
 for(const room of [1,3,5,6,8])for(const p of content.createTeam(room).pokemons){if([448,474].includes(p.data.id)){assert.equal(p.ev.specialAttack,252);assert.equal(p.ev.attack,0);}if([253,184].includes(p.data.id)){assert.equal(p.ev.attack,252);assert.equal(p.ev.specialAttack,0);}}
 const azumarill=content.createTeam(6).pokemons[0];assert.equal(azumarill.passiveAbility,'Huge Power');assert.equal(content.createTeam(2).pokemons[1].heldItem,'eviolite');
});
for(const [label,room,slot,move]of [['Volt Absorb',3,0,'Thunderbolt'],['Gastrodon Storm Drain',6,2,'Surf'],['Cradily Storm Drain',10,0,'Surf'],['Ground immunity',15,0,'Thunderbolt']])test(`${label} works in the real engine`,()=>{
 const p=content.createTeam(room).pokemons[slot],a=mon(121,[move]);p.currentHp=Math.floor(p.maxHp/2);const hp=p.currentHp,item=p.heldItem,result=hit(move,a,p);assert.equal(result.damage,0);assert.equal(p.heldItem,item);if(label==='Volt Absorb')assert(p.currentHp>hp);else assert.equal(p.currentHp,hp);if(label.includes('Storm Drain'))assert.equal(p.__battle.statStages.specialAttack,1);
});
test('each new counter retains ordinary offensive counterplay, including Grass against Gastrodon and Ground against Lanturn',()=>{
 for(const [room,slot,move]of [[2,0,'Ice Beam'],[3,0,'Earthquake'],[5,1,'Ice Beam'],[6,2,'Energy Ball'],[9,0,'Psychic'],[10,0,'Close Combat'],[12,0,'Dark Pulse'],[13,0,'Flamethrower'],[15,0,'Surf']]){const p=content.createTeam(room).pokemons[slot],a=mon(121,[move]),m=engine.getMoveByName(move);assert(engine.getMoveEffectiveness(m,a,p)>1,`${room} ${move}`);assert(hit(move,a,p).damage>0,`${p.data.name.french} must not be invulnerable`);}
});
test('Tangrowth regenerates on switch and Mamoswine Thick Fat halves incoming Fire damage',()=>{
 const p=content.createTeam(13).pokemons[0];p.currentHp=1;require('../server/game/battle/battleTeam').switchPokemonByIndex([p,mon(94,['Shadow Ball'])],1);assert.equal(p.currentHp,1+Math.floor(p.maxHp/3));
 const m=content.createTeam(15).pokemons[0],foe=mon(6,['Flamethrower']),fire=engine.getMoveByName('Flamethrower'),withFat=engine.estimateDamage(foe,m,fire);m.passiveAbility=null;assert(withFat<engine.estimateDamage(foe,m,fire)*.55);
});
test('the existing human AI uses the new immunity pivot and a Ground punish without reading the submitted action',()=>{
 const ai=require('../server/game/battle/humanTrainerAI'),team=content.createTeam(6).pokemons,foe=mon(135,['Thunderbolt','Volt Switch']),field=engine.createBattleState();team[0].currentHp=1;Object.defineProperty(field,'turnActions',{get(){throw Error('Hidden action read');}});
 const options={team,opponentTeam:[foe],field,ownSide:field.sides.enemy,enemySide:field.sides.player,memory:{},round:1};assert.deepEqual(ai.chooseAction(options),{action:'change',number:2});
 const gastro=team[2];assert.deepEqual(ai.chooseAction({...options,team:[gastro],round:2}),{action:'attack',number:1});
});
test('building and battling tower sets never mutates Adventure trainer definitions',()=>{
 const source=require('../data/game/pnj_teams.json'),before=JSON.stringify(source);for(let i=0;i<16;i++)content.createTeam(i);assert.equal(JSON.stringify(source),before);for(const p of source.pnjs.find(p=>p.name==='gwenn_route8').team)assert(![3,346,465,470,479].includes(p.pokemonId));
});
