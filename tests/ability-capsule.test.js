const test=require('node:test'),assert=require('node:assert/strict');
const capsule=require('../server/game/items/abilityCapsule'),{getSpeciesAbilitySlots}=require('../server/game/abilities/abilityDex');
const {medicineBatch}=require('../server/game/items/medicineEffects'),factory=require('../server/game/drift/pokemonFactory');
const economy=require('../server/game/drift/economy'),codec=require('../server/game/drift/checkpointCodec');
const shop=require('../server/game/world/shopCatalog');
test('Pilule Talent: all used species roll only a distinct legal ordinary/hidden ability, uniformly among alternatives',()=>{
 for(const {id}of require('../scripts/auditPokemonAvailability').buildReport().entries){
  const names=[...new Set(getSpeciesAbilitySlots(id).filter(a=>!a.special).map(a=>a.name))];
  for(const before of names){const p=factory.create(id,30,true);p.passiveAbility=before;const snapshot=JSON.stringify(p);
   if(names.length===1){assert.throws(()=>medicineBatch(p,'ability_capsule',1,1,()=>{throw Error('Do not draw');}),/aucun autre talent/);continue;}
   const others=names.filter(n=>n!==before);assert.deepEqual(capsule.alternatives(p),others);
   for(let i=0;i<others.length;i++){let rolls=0;const result=medicineBatch(p,'ability_capsule',1,1,()=>{rolls++;return(i+.5)/others.length;});assert.equal(result.passiveAbility,others[i]);assert.notEqual(result.passiveAbility,before);assert.equal(result.consumed,1);assert.equal(rolls,1);assert.deepEqual(result.trainingChange,{kind:'ability',before,after:others[i]});assert.equal(JSON.stringify(p),snapshot);}
  }
 }
});
test('Pilule Talent rejects KO, eggs, foreign/unknown ability, bad quantity, empty stock and invalid RNG without mutating Pokémon',()=>{
 const p=factory.create(63,20,true),snapshot=JSON.stringify(p);
 for(const patch of [{currentHp:0},{isEgg:true},{passiveAbility:'Drought'}])assert.throws(()=>medicineBatch({...p,...patch},'ability_capsule',1,1));
 for(const quantity of[0,2,-1,1.5,'1'])assert.throws(()=>medicineBatch(p,'ability_capsule',quantity,9));
 assert.throws(()=>medicineBatch(p,'ability_capsule',1,0));for(const n of[-.1,1,NaN,Infinity])assert.throws(()=>medicineBatch(p,'ability_capsule',1,1,()=>n));assert.equal(JSON.stringify(p),snapshot);
});
test('Pilule Talent is 10000 at ordinary unlocked counters and the tower Training floor, isolated by progression',()=>{
 for(const mapName of['ville1_shop','ville5_shop','tour_etage1'])for(const expedition of[false,true]){const offers=shop.getShopCatalog({mapName,expedition,flags:{hoze_defeated:'true'}});assert.equal(offers.find(i=>i.key==='ability_capsule').price,10000);}
 assert(!shop.getShopCatalog({mapName:'ville1_shop'}).some(i=>i.key==='ability_capsule'));assert(shop.getShopCatalog({mapName:'tour_etage1'}).find(i=>i.key==='ability_capsule').locked);
 assert(!shop.getShopCatalog({mapName:'tour_etage2',flags:{hoze_defeated:'true'}}).some(i=>i.key==='ability_capsule'));
});
for(const mode of['rift','colosseum'])test(`${mode}: capsule consumes exactly one even with conservation bonus, works between rounds and persists through checkpoints`,()=>{
 const mon=factory.create(63,20,true);mon.passiveAbility='Synchronize';const p={alive:true,currentmap:'ville1_shop',money:20000,run:{mode,phase:'exploration'},equipe:{pokemons:[mon]},items:{},drifts:[{uuid:'conserve',definitionId:'DRF-052',rarity:'mythic'}],equipped:['conserve']};
 economy.buy(p,'ability_capsule',1);assert.equal(p.money,10000);p.run.phase='colosseum_ready';p.ready=true;
 const r=economy.usePotion(p,'ability_capsule',mon.uuid,()=>0);assert.equal(mon.passiveAbility,'Inner Focus');assert.equal(r.trainingChange.before,'Synchronize');assert.equal(p.items.ability_capsule,0);assert.equal(p.ready,false);assert.equal(codec.decode(codec.encode(p)).equipe.pokemons[0].passiveAbility,'Inner Focus');
 assert.throws(()=>economy.usePotion(p,'ability_capsule',mon.uuid));p.items.ability_capsule=1;p.inbattle=true;assert.throws(()=>economy.usePotion(p,'ability_capsule',mon.uuid));assert.equal(p.items.ability_capsule,1);p.inbattle=false;
 const single=factory.create(92,20,true);p.equipe.pokemons=[single];assert.throws(()=>economy.usePotion(p,'ability_capsule',single.uuid));assert.equal(p.items.ability_capsule,1);
});
