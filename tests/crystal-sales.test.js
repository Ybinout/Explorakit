const test=require('node:test'),assert=require('node:assert/strict');
const {crystals,roll,awardExpedition}=require('../server/game/items/wildCrystals');
const {getSellPrice}=require('../server/game/items/itemSales');
const economy=require('../server/game/drift/economy'),codec=require('../server/game/drift/checkpointCodec');
const {SHOP_MAPS,getShopCatalog}=require('../server/game/world/shopCatalog');
const sequence=(...values)=>()=>values.shift()??.99;
const fixture=mode=>({alive:true,inbattle:false,currentmap:'ville1_shop',money:1000,run:{mode,phase:'exploration'},items:{},equipe:{pokemons:[]},storage:[],drifts:[],equipped:[]});
test('three repeatable treasures have exact independent thresholds, including simultaneous and absent drops',()=>{
 assert.deepEqual(crystals.map(i=>[i.key,i.wildCrystalChance,getSellPrice(i.key)]),[['crystal_shard',.25,150],['clear_crystal',.1,450],['aurora_prism',.05,3000]]);
 assert.equal(roll(sequence(.25,.1,.05)).length,0);assert.equal(roll(sequence(.25-1e-8,.1-1e-8,.05-1e-8)).length,3);
 assert.deepEqual(roll(sequence(.9,0,.01)).map(i=>i.key),['clear_crystal','aurora_prism']);assert.deepEqual(roll(sequence(0,.9,.9)).map(i=>i.key),['crystal_shard']);
 const count=[0,0,0];for(let n=0;n<10000;n++)for(const i of roll(()=> (n+.5)/10000))count[crystals.indexOf(i)]++;
 assert.deepEqual(count,[2500,1000,500]);
 for(const i of crystals){assert(i.dropOnly&&!i.unique&&!i.wildLoot);assert(!i.fieldUse);}
});
test('crystals stay outside all purchase catalogs and cannot replace ordinary item rewards',()=>{
 for(const mapName of SHOP_MAPS)for(const expedition of[false,true]){
  const catalog=getShopCatalog({mapName,expedition,flags:{wanda_defeated:'true'}});
  assert(!catalog.some(i=>crystals.some(c=>c.key===i.key)));
  for(const item of catalog)assert(getSellPrice(item.key)<=item.price/2,'no buy/resell profit loop');
 }
 const loot=require('../server/game/items/wildLoot');assert.equal(loot.CHANCE,1/6);
 for(let n=0;n<100;n++)assert(!crystals.includes(loot.select(new Set(),()=>n/100)));
});
test('key items, unique rod, unknown keys and explicitly unsellable objects have no sale price',()=>{
 for(const key of['void_teleporter','fly_module','gwenn_house_key','fishing_rod','exp_share','cs_surf','__proto__','missing',null])assert.equal(getSellPrice(key),0);
 assert.equal(getSellPrice('pokeball'),75);assert.equal(getSellPrice('drift_potion'),50);assert.equal(getSellPrice('life_orb'),5000);
});
for(const mode of['rift','colosseum'])test(`${mode}: repeatable loot, ordinary item coexistence, sale and checkpoint stock/money`,()=>{
 const p=fixture(mode);awardExpedition(p,()=>0);awardExpedition(p,()=>0);
 assert.deepEqual(crystals.map(i=>p.items[i.key]),[2,2,2]);
 const result=economy.sell(p,'aurora_prism',2);assert.equal(result.totalPrice,6000);assert.equal(p.money,7000);assert.equal(p.items.aurora_prism,0);assert(!result.items.some(i=>i.key==='aurora_prism'));
 const saved=codec.decode(codec.encode(p));assert.equal(saved.money,7000);assert.equal(saved.items.crystal_shard,2);assert.throws(()=>economy.sell(p,'aurora_prism',1),/assez/);
 const fresh=fixture(mode),loot=economy.drop(fresh,'wild',()=>0);assert(crystals.every(i=>loot.includes(i.name)));assert(loot.includes('Baie Oran'));
 for(const source of['capture','wild']){const q=fixture(mode);economy.drop(q,source,()=>0);assert(crystals.every(i=>q.items[i.key]===1));}
 for(const source of['trainer','arena','unknown']){const q=fixture(mode);economy.drop(q,source,()=>0);assert(crystals.every(i=>!q.items[i.key]));}
});
test('expedition sales enforce real stock, quantities, shop, phase and battle without mutation on refusal',()=>{
 const p=fixture('colosseum');p.items.crystal_shard=2;
 for(const quantity of[0,-1,1.5,100,'1',NaN,Infinity,3]){const before=JSON.stringify(p);assert.throws(()=>economy.sell(p,'crystal_shard',quantity));assert.equal(JSON.stringify(p),before);}
 for(const key of['void_teleporter','unknown'])assert.throws(()=>economy.sell(p,key,1));
 for(const [field,value]of[['currentmap','route1'],['inbattle',true],['alive',false]]){const before=p[field];p[field]=value;assert.throws(()=>economy.sell(p,'crystal_shard',1));p[field]=before;}
 p.run.phase='colosseum_ready';assert.throws(()=>economy.sell(p,'crystal_shard',1));assert.equal(p.items.crystal_shard,2);assert.equal(p.money,1000);
});
