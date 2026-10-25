const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const rare=require('../server/game/world/legendaryEncounters'),wild=require('../server/game/world/wildPokemonFactory'),factory=require('../server/game/drift/pokemonFactory');
const {fishingEncounter,profiles}=require('../server/game/world/fishingEncounters'),{maps}=require('../data/game/nextMap.json');
const {getMoveDefinition}=require('../server/game/battle/battleResources');
const sequence=(...values)=>()=>{assert(values.length,'Unexpected extra encounter roll');return values.shift();};
test('one legendary category success per 3000 equiprobable bins; exact threshold fails without drawing a species',()=>{
 assert.equal(rare.oneIn,3000);let successes=0;for(let i=0;i<3000;i++)if(rare.rollLegendary(()=>((i+.5)/3000))!==null)successes++;assert.equal(successes,1);
 assert.equal(rare.rollLegendary(sequence(1/3000)),null);assert.equal(rare.rollLegendary(sequence(1/3000*(1-Number.EPSILON),.999)),493);
 assert.equal(rare.rollLegendary(sequence(.5)),null);
});
test('the second draw is uniform among exactly the 35 Gen I–IV legendaries and mythicals, all renderable',()=>{
 assert.deepEqual(rare.species,[...factory.legendary].filter(id=>id<=493));assert.equal(new Set(rare.species).size,35);
 for(const[id,index]of rare.species.map((id,index)=>[id,index])){
  assert.equal(rare.rollLegendary(sequence(0,(index+.5)/35)),id);
  for(const dir of ['dp2','back']){const bytes=fs.readFileSync(path.join(__dirname,'../vue-explorakit/src/assets',dir,id+'.png'));assert.equal(bytes.toString('ascii',1,4),'PNG');}
 }
});
test('Adventure and expeditions can roll every legendary at early, cave and late zone levels, with valid moves',async()=>{
 for(const name of ['start','cave1','route14'])for(let i=0;i<rare.species.length;i++){
  const zone=maps.find(m=>m.mapName===name),pick=(i+.5)/rare.species.length;
  const a=await wild(name,sequence(0,pick,.999)),b=factory.wild(name,{drifts:[],equipped:[]},sequence(0,pick,.999));
  assert.equal(a.data.id,rare.species[i]);assert.equal(b.data.id,a.data.id);assert.equal(a.level,zone.level.max);assert.equal(b.level,(require('../server/game/drift/openingBalance').levels[name]||zone.level).max);
  for(const p of[a,b]){assert(p.currentHp>0);assert(p.abilities.length>0&&p.abilities.length<=4);assert(p.abilities.every(getMoveDefinition));}
 }
});
test('legendary encounters retain every active zone’s level cap and cannot appear in encounter-free interiors',async()=>{
 for(const name of require('../scripts/auditPokemonAvailability').buildReport().zones){const zone=maps.find(m=>m.mapName===name),p=await wild(name,sequence(0,.999,0));assert.equal(p.data.id,493);assert.equal(p.level,zone.level.min);}
 const never=()=>{throw Error('Roll on an ineligible map');};
 for(const name of ['centre','route2_maison','tour_etage3']){assert.equal(await wild(name,never),null);assert.equal(factory.wild(name,{},never),null);assert.equal(fishingEncounter(name,never),null);}
});
test('fishing rolls the same legendary category and species, then uses the lake level; ordinary fish keep their pool',()=>{
 for(const name of Object.keys(profiles)){
  const zone=maps.find(m=>m.mapName===name);for(let i=0;i<rare.species.length;i++){const e=fishingEncounter(name,sequence(0,(i+.5)/35,.999));assert.equal(e.id,rare.species[i]);assert.equal(e.level,zone.level.max);}
  assert.equal(fishingEncounter(name,sequence(.5,.999,0)).id,349);
 }
});
test('Rift rarity bonuses do not alter legendary selection, and random starters remain non-legendary',()=>{
 const p={drifts:[{uuid:'rare',definitionId:'DRF-054',rarity:'mythic'}],equipped:[]};
 for(const equipped of[[],['rare']]){p.equipped=equipped;const result=factory.wild('start',p,sequence(0,.999,.5));assert.equal(result.data.id,493);}
 assert(factory.starterChoices(()=>0).every(p=>!factory.legendary.has(p.data.id)));
});
for(const mode of['rift','colosseum'])test(`${mode}: captured legendary keeps identity and stats through PC storage and checkpoint restoration`,()=>{
 const {DriftBattle}=require('../server/game/drift/driftBattle'),codec=require('../server/game/drift/checkpointCodec');
 const p={userId:1,alive:true,run:{mode,phase:'exploration'},currentmap:'start',equipe:{pokemons:Array.from({length:6},()=>factory.create(7,20,true))},items:{pokeball:1},storage:[],drifts:[],equipped:[],defeated:new Set(),money:0};
 const target=factory.wild('start',p,sequence(0,.999,.5));assert.equal(target.data.id,493);
 const battle=new DriftBattle(p,{npc:true,equipe:{pokemons:[target]},drifts:[],equipped:[]},{random:()=>0,paceMs:0,emit(){}});
 assert(battle.action(p,{action:'bag',itemKey:'pokeball',turnId:battle.token}));assert(battle.finished);assert.equal(p.storage.length,1);assert.equal(p.equipe.pokemons.length,6);assert.equal(p.items.pokeball,0);
 const saved=codec.decode(codec.encode(p)).storage[0].pokemon;assert.equal(saved.data.id,493);assert.equal(saved.level,target.level);assert.deepEqual(saved.iv,target.iv);assert.equal(saved.k,target.k);assert.equal(saved.maxHp,target.maxHp);
});
