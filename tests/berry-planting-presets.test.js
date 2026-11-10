const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const garden=require('../server/persistence/berryGardenRepository');
const empty=()=>({stage:'empty'}),growing=berryKey=>({stage:'seed',berryKey});
let ui;test.before(async()=>{ui=await import('data:text/javascript;base64,'+fs.readFileSync(require('node:path').resolve(__dirname,'../vue-explorakit/src/services/berryPlantings.js')).toString('base64'));});
test('planting favorites preserve slot order, trim only trailing blanks and fit the existing flag column',()=>{
 const a=garden.plantingProfile(['oran_berry','sitrus_berry',null]),b=garden.plantingProfile(['oran_berry','sitrus_berry']);assert.deepEqual(a,b);assert.notEqual(a.key,garden.plantingProfile(['sitrus_berry','oran_berry']).key);
 assert.deepEqual(garden.plantingProfile([null,'oran_berry']).berries,[null,'oran_berry']);
 for(const key of require('../server/game/berries/rules').base){const p=garden.plantingProfile([key,key,key]);assert.equal(p.key.length,64);assert(JSON.stringify(p.berries).length<=255);}
 for(const p of [null,[],[null],[null,null,null],['oran_berry',null,null,null],['corrupted_oran_berry'],['mutant_stat_attack_common_berry'],['unknown'],[{}]])assert.throws(()=>garden.plantingProfile(p),/invalide/);
});
test('a single favorite plants the selected free hole, or the first free one, with optional fill-all',()=>{
 const crops=[growing('sitrus_berry'),empty(),empty()];assert.deepEqual(ui.favoritePlantings(['oran_berry'],crops,2),[{slot:2,berryKey:'oran_berry'}]);assert.deepEqual(ui.favoritePlantings(['oran_berry'],crops,0),[{slot:1,berryKey:'oran_berry'}]);assert.deepEqual(ui.favoritePlantings(['oran_berry'],crops,0,true),[{slot:1,berryKey:'oran_berry'},{slot:2,berryKey:'oran_berry'}]);assert.deepEqual(ui.favoritePlantings(['oran_berry'],[growing('oran_berry')],0),[]);
});
test('a saved mixed composition only fills its free intended slots and never replaces existing growth',()=>{
 assert.deepEqual(ui.favoritePlantings(['oran_berry','sitrus_berry','cheri_berry'],[empty(),growing('oran_berry'),empty()],1),[{slot:0,berryKey:'oran_berry'},{slot:2,berryKey:'cheri_berry'}]);assert.deepEqual(ui.favoritePlantings([null,'oran_berry'],[empty(),empty(),empty()],0),[{slot:1,berryKey:'oran_berry'}]);assert(ui.samePlanting(['oran_berry',null,null],['oran_berry']));assert(!ui.samePlanting([null,'oran_berry'],['oran_berry']));
});
test('cost preview counts repeated berries and the complete crystal cost, ignoring uncommitted selected ingredients',()=>{
 const plans=[{slot:0,berryKey:'oran_berry'},{slot:2,berryKey:'oran_berry'}];
 for(const [berries,shards,ok]of[[2,20,true],[1,20,false],[2,19,false],[3,30,true]])assert.equal(ui.canAffordPlanting(plans,[{key:'oran_berry',quantity:berries},{key:'crystal_shard',quantity:shards}],10),ok);
 assert(!ui.canAffordPlanting([],[],10));assert(!ui.canAffordPlanting(plans,[],10));
});
