const test=require('node:test'),assert=require('node:assert/strict');
const shop=require('../server/game/world/shopCatalog'),{floors}=require('../data/game/department_store.json');
test('unified store is exactly the unchanged four catalogs with no duplicate SKU and correct badge locks',()=>{
 for(const flags of [{},{hoze_defeated:'true'}])for(const mapName of Object.keys(floors)){
  const all=shop.getDepartmentCatalog({mapName,flags});assert.equal(all.length,735);assert.equal(new Set(all.map(i=>i.key)).size,all.length);
  for(const [map,floor]of Object.entries(floors))assert.deepEqual(all.filter(i=>i.department===floor.number).map(({department,...item})=>item),shop.getShopCatalog({mapName:map,flags}));
  assert.equal(all.find(i=>i.key==='choice_scarf').locked,!flags.hoze_defeated);assert.equal(all.find(i=>i.key==='pokeball').price,150);assert.equal(all.find(i=>i.key==='zinc').price,800);
 }
 assert.equal(shop.getDepartmentCatalog({mapName:'ville1_shop'}),null);assert.equal(shop.getDepartmentCatalog({mapName:'route1'}),null);
});
test('cross-department requests stay inside the store and require a real numeric department',()=>{
 for(const actual of Object.keys(floors))for(const[target,floor]of Object.entries(floors))assert.equal(shop.resolvePurchaseMap(actual,floor.number),target);
 for(const actual of ['ville1_shop','route1','centre',undefined])for(const number of [1,2,3,4])assert.equal(shop.resolvePurchaseMap(actual,number),null);
 for(const invalid of [null,0,5,-1,'2',true,{},[],Infinity,NaN])assert.equal(shop.resolvePurchaseMap('tour_rdc',invalid),null);
 assert.equal(shop.resolvePurchaseMap('tour_etage2',undefined),'tour_etage2');assert.equal(shop.resolvePurchaseMap('ville1_shop',undefined),'ville1_shop');
});
test('search ignores accents/case and training goals cover every existing training family and CS',async()=>{
 const {shopSearch,TRAINING_TASKS,STORE_DEPARTMENTS}=await import('../vue-explorakit/src/services/shopBrowse.js');
 assert.equal(shopSearch('  DÉFENSE  '),'defense');assert.equal(shopSearch('Entraînement'),'entrainement');assert.equal(shopSearch(null),'');assert.equal(shopSearch('Évolution'),shopSearch('e\u0301volution'));
 const {trainingGroup}=await import('../vue-explorakit/src/services/bagPockets.js');
 const all=shop.getDepartmentCatalog({mapName:'tour_rdc'}).filter(i=>i.department===2);
 assert.equal(TRAINING_TASKS.length,7);assert.equal(new Set(TRAINING_TASKS.map(t=>t.key)).size,7);assert.deepEqual(STORE_DEPARTMENTS.map(d=>d.number),[1,2,3,4]);
 for(const task of TRAINING_TASKS)assert(all.some(item=>task.key==='machines'?item.category==='machine':item.category!=='machine'&&trainingGroup(item)===task.key),task.key);
});
