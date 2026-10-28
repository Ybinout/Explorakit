const test=require('node:test'),assert=require('node:assert/strict');
const factory=require('../server/game/drift/pokemonFactory'),{medicineBatch}=require('../server/game/items/medicineEffects');
const economy=require('../server/game/drift/economy'),codec=require('../server/game/drift/checkpointCodec'),shop=require('../server/game/world/shopCatalog');
const names=['Adamant','Bashful','Bold','Brave','Calm','Careful','Docile','Gentle','Hardy','Hasty','Impish','Jolly','Lax','Lonely','Mild','Modest','Naive','Naughty','Quiet','Quirky','Rash','Relaxed','Sassy','Serious','Timid'];
test('Pilule Nature: all 25 natures are equiprobable, including the current nature; item validation leaves the source untouched',()=>{
 const p=factory.create(63,40,true),before=JSON.stringify(p),counts=new Map();
 for(let i=0;i<625;i++){let rolls=0;const r=medicineBatch(p,'nature_capsule',1,1,()=>{rolls++;return(i+.5)/625;});assert(names.includes(r.nature));assert.equal(r.consumed,1);assert.equal(rolls,1);assert.deepEqual(r.trainingChange,{kind:'nature',before:'Bashful',after:r.nature});counts.set(r.nature,(counts.get(r.nature)||0)+1);assert.equal(r.currentHp,p.currentHp);}
 assert.equal(counts.size,25);for(const count of counts.values())assert.equal(count,25);assert.equal(JSON.stringify(p),before);
 const same=medicineBatch(p,'nature_capsule',1,1,()=>1.5/25);assert.equal(same.nature,'Bashful');assert.equal(same.consumed,1);
});
test('nature changes immediately recalculate actual permanent/current stats without healing or changing IV/EV/K/ability/moves',()=>{
 const p=factory.create(63,40,true);p.currentHp-=7;p.heldItem='leftovers';const before=structuredClone(p);
 for(const [name,up,down]of[['Adamant','attack','specialAttack'],['Modest','specialAttack','attack'],['Timid','speed','attack']]){
  const r=medicineBatch(p,'nature_capsule',1,1,()=>(names.indexOf(name)+.5)/25);
  assert.equal(r.nature,name);assert.equal(r[up],Math.floor(before[up]*1.1));assert.equal(r[down],Math.floor(before[down]*.9));assert.equal(r.currentHp,before.currentHp);assert.equal(r.maxHp,before.maxHp);assert.equal(r.currentAttack,r.attack);assert.equal(r.currentSpeed,r.speed);
  const updated={...p,...r};for(const key of['iv','ev','k','level','experience','passiveAbility','abilities','movePp','heldItem'])assert.deepEqual(updated[key],before[key]);
 }
});
test('nature capsule refuses KO, eggs, invalid quantity, empty stock and invalid RNG without mutation',()=>{
 const p=factory.create(63,20,true),before=JSON.stringify(p);
 for(const patch of[{currentHp:0},{isEgg:true}])assert.throws(()=>medicineBatch({...p,...patch},'nature_capsule',1,1,()=>{throw Error('No draw');}),/apte/);
 for(const n of[0,-1,2,1.1,'1'])assert.throws(()=>medicineBatch(p,'nature_capsule',n,5));assert.throws(()=>medicineBatch(p,'nature_capsule',1,0));for(const n of[-1,1,Infinity,NaN])assert.throws(()=>medicineBatch(p,'nature_capsule',1,1,()=>n));assert.equal(JSON.stringify(p),before);
});
test('nature capsule costs 800, with the same shop progression and Training floor as the talent capsule',()=>{
 for(const mapName of['ville1_shop','ville5_shop','tour_etage1'])for(const expedition of[false,true])assert.equal(shop.getShopCatalog({mapName,expedition,flags:{hoze_defeated:'true'}}).find(i=>i.key==='nature_capsule').price,800);
 assert(!shop.getShopCatalog({mapName:'ville1_shop'}).some(i=>i.key==='nature_capsule'));
});
for(const mode of['rift','colosseum'])test(`${mode}: nature capsule consumes one, changes live stats, works between rounds, persists after checkpoint and cannot be used in battle`,()=>{
 const mon=factory.create(63,40,true),p={alive:true,currentmap:'ville1_shop',money:1600,run:{mode,phase:'exploration'},equipe:{pokemons:[mon]},items:{},drifts:[{uuid:'conserve',definitionId:'DRF-052',rarity:'mythic'}],equipped:['conserve']};
 economy.buy(p,'nature_capsule',1);assert.equal(p.money,800);p.run.phase='colosseum_ready';const attack=mon.attack;economy.usePotion(p,'nature_capsule',mon.uuid,()=>0);assert.equal(p.items.nature_capsule,0);assert.equal(mon.nature,'Adamant');assert.equal(mon.attack,Math.floor(attack*1.1));const saved=codec.decode(codec.encode(p)).equipe.pokemons[0];assert.equal(saved.nature,'Adamant');assert.equal(saved.currentAttack,mon.attack);
 p.items.nature_capsule=1;p.inbattle=true;assert.throws(()=>economy.usePotion(p,'nature_capsule',mon.uuid));assert.equal(p.items.nature_capsule,1);
});
