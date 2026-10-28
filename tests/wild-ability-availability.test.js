const test=require('node:test'),assert=require('node:assert/strict');
const {getSpeciesAbilitySlots,chooseSpeciesAbility,normalizeSpeciesAbility,evolveSpeciesAbility,HIDDEN_ABILITY_CHANCE}=require('../server/game/abilities/abilityDex');
const {buildReport,wildSpecies,availablePokemon}=require('../scripts/auditWildAbilities');
const wildFactory=require('../server/game/world/wildPokemonFactory'),factory=require('../server/game/drift/pokemonFactory');
const pc=require('../server/persistence/pokemonStorageRepository'),codec=require('../server/game/drift/checkpointCodec');
const slots=id=>getSpeciesAbilitySlots(id).filter(a=>!a.special);
const rollFor=(id,slot)=>slot.hidden?0:slots(id).filter(a=>!a.hidden).findIndex(a=>a.slot===slot.slot)===0 ? .1 : .99;
async function fixed(roll,work){const previous=Math.random;Math.random=()=>roll;try{return await work();}finally{Math.random=previous;}}

test('only the 493 species actually obtainable in RiftMon expose every ordinary and hidden slot, with exact independent 5% hidden probabilities and descriptions',()=>{
 const report=buildReport();assert.equal(report.speciesChecked,493);assert.equal(report.hiddenAbilityChance,.05);assert.deepEqual(report.errors,[]);assert.equal(report.wildSpecies,326);assert.equal(report.evolutionOnly,167);assert(report.species.every(p=>p.id<=493));
 assert(report.species.filter(p=>p.id<=493&&p.abilities.some(a=>a.hidden)).length===444);
 for(const p of report.species)for(const a of p.abilities)assert.equal(normalizeSpeciesAbility(p.id,a.name,()=>{throw Error('A saved valid ability must never reroll');}),a.name);
});
test('hidden threshold and separate normal-slot draw remain reachable for the species used in the game',()=>{
 assert.equal(HIDDEN_ABILITY_CHANCE,.05);
 const sequence=(...draws)=>()=>{assert(draws.length);return draws.shift();};
 assert.equal(chooseSpeciesAbility(37,sequence(.05-Number.EPSILON,0)),'Drought');
 assert.equal(chooseSpeciesAbility(37,sequence(.05,0)),'Flash Fire');
 assert.equal(chooseSpeciesAbility(63,sequence(.5,0)),'Synchronize');
 assert.equal(chooseSpeciesAbility(63,sequence(.5,.999)),'Inner Focus');
 assert.equal(chooseSpeciesAbility(63,sequence(0,0)),'Magic Guard');
});
test('evolution never rerolls an ordinary ability into a hidden one when the second ordinary slot disappears',()=>{
 const never=()=>{throw Error('A legal evolved slot must not reroll');};
 for(const [id,name]of[[134,'Water Absorb'],[135,'Volt Absorb'],[136,'Flash Fire'],[196,'Synchronize'],[197,'Synchronize'],[470,'Leaf Guard'],[471,'Snow Cloak']])assert.equal(evolveSpeciesAbility(133,id,'Adaptability',never),name);
 assert.equal(evolveSpeciesAbility(281,475,'Trace',never),'Steadfast');
 assert.equal(evolveSpeciesAbility(133,134,'Anticipation',never),'Hydration');
 assert.equal(evolveSpeciesAbility(281,475,'Telepathy',never),'Justified');
 assert.equal(evolveSpeciesAbility(290,292,'Run Away',never),'Wonder Guard');
});
test('all implemented evolutions of usable species preserve their normal/hidden slot whenever the evolved species has one',async()=>{
 const rules=[...require('../data/game/evolutions.json').rules,...require('../data/game/stone_evolutions.json').rules],used=new Set(availablePokemon().entries.map(p=>p.id));
 for(const rule of rules.filter(r=>used.has(r.from)&&used.has(r.to)))for(const source of slots(rule.from))await fixed(rollFor(rule.from,source),async()=>{
  const p=await wildFactory.createAtLevel(rule.from,40);assert.equal(p.passiveAbility,source.name);
  // Use the opposite hidden branch during evolution, rather than reusing the
  // creation roll. An accidental second encounter roll must become observable.
  const previous=Math.random;Math.random=()=>source.hidden ? .99 : 0;try{p.updatePokemon(rule.to);}finally{Math.random=previous;}
  const candidates=slots(rule.to),chosen=candidates.find(a=>a.name===p.passiveAbility);assert(chosen,`${rule.from}->${rule.to}: ${p.passiveAbility}`);
  if(candidates.some(a=>a.hidden===source.hidden))assert.equal(chosen.hidden,source.hidden,`${rule.from}->${rule.to}: hidden status`);
 });
});
test('every natural species actually generates with each legal ability in Adventure, fishing/guaranteed encounters, and expeditions, then survives party/PC/checkpoint serialization',async()=>{
 const {maps}=require('../data/game/nextMap.json'),rarity=require('../data/game/drift_encounters.json'),legendary=require('../server/game/world/legendaryEncounters');
 for(const id of wildSpecies())for(const slot of slots(id))await fixed(rollFor(id,slot),async()=>{
  const direct=await wildFactory.createAtLevel(id,30),drift=factory.create(id,30,false);
  for(const p of[direct,drift]){
   assert.equal(p.passiveAbility,slot.name,`#${id} ${slot.name}`);assert.equal(pc.decodePokemon(pc.encodePokemon(p)).passiveAbility,slot.name);assert.equal(codec.decode(codec.encode(p)).passiveAbility,slot.name);
  }
  const zone=maps.find(m=>availablePokemon().zones.includes(m.mapName)&&m.wildpokemon?.includes(id));
  if(zone){
   const index=zone.wildpokemon.indexOf(id),legendIndex=legendary.species.indexOf(id),draws=legendIndex<0?[.5,(index+.5)/zone.wildpokemon.length,.5]:[0,(legendIndex+.5)/legendary.species.length,.5];
   const p=await wildFactory(zone.mapName,()=>draws.shift()??.5);assert.equal(p.data.id,id);assert.equal(p.passiveAbility,slot.name);
   const weights=zone.wildpokemon.map(species=>rarity.rareSpecies.includes(species)?rarity.rareWeight:rarity.commonWeight),sum=weights.reduce((a,b)=>a+b,0),before=weights.slice(0,index).reduce((a,b)=>a+b,0);
   const r=legendIndex<0?[.5,(before+weights[index]/2)/sum,.5]:[0,(legendIndex+.5)/legendary.species.length,.5];
   const expedition=factory.wild(zone.mapName,{drifts:[],equipped:[]},()=>r.shift()??.5);assert.equal(expedition.data.id,id);assert.equal(expedition.passiveAbility,slot.name);
  }else if(legendary.isLegendary(id)){
   const index=legendary.species.indexOf(id),draws=[0,(index+.5)/legendary.species.length,.5];assert.equal((await wildFactory('start',()=>draws.shift())).passiveAbility,slot.name);
   const r=[0,(index+.5)/legendary.species.length,.5];assert.equal(factory.wild('start',{drifts:[],equipped:[]},()=>r.shift()).passiveAbility,slot.name);
  }
 });
});
for(const mode of['rift','colosseum'])test(`${mode}: each naturally available ability survives real capture, full-party PC storage and checkpoint recovery, including Trace and Imposter`,async()=>{
 const {DriftBattle}=require('../server/game/drift/driftBattle'),representatives=new Map();
 for(const id of wildSpecies())for(const slot of slots(id))if(!representatives.has(slot.name))representatives.set(slot.name,{id,slot});
 for(const [name,{id,slot}]of representatives)await fixed(rollFor(id,slot),async()=>{
  const target=await wildFactory.createAtLevel(id,20),team=Array.from({length:6},()=>factory.create(129,30,true));
  const p={userId:1,alive:true,run:{mode,phase:'exploration'},currentmap:'start',equipe:{pokemons:team},items:{pokeball:1},storage:[],drifts:[],equipped:[],defeated:new Set(),money:0};
  const battle=new DriftBattle(p,{npc:true,equipe:{pokemons:[target]},drifts:[],equipped:[]},{random:()=>0,paceMs:0,emit(){}});
  assert(battle.action(p,{action:'bag',itemKey:'pokeball',turnId:battle.token}),name);assert(battle.finished,name);assert.equal(p.storage.length,1,name);assert.equal(p.storage[0].pokemon.passiveAbility,name);
  const restored=codec.decode(codec.encode(p));assert.equal(restored.storage[0].pokemon.passiveAbility,name);assert.equal(pc.decodePokemon(pc.encodePokemon(target)).passiveAbility,name);
 });
});
