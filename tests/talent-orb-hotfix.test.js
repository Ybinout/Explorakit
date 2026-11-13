const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const rules=require('../server/game/talents/rules'),fx=require('../server/game/talents/effects'),catalog=rules.catalog;
function add(nodes,prefix,count,choice){for(let i=1;i<=count;i++)nodes=rules.buy(nodes,prefix+i,choice);return nodes;}
function fullTree(){
 let n=add({},'capture_water_',15);n=add(n,'capture_fire_',14);n=add(n,'capture_ice_',1);n=rules.buy(n,'capture_ultimate','shiny');
 n=add(n,'combat_fire_',7,'offense');n=add(n,'combat_water_',7,'defense');n=add(n,'combat_ice_',1,'offense');n=rules.buy(n,'combat_ultimate');
 for(let lane=1;lane<=4;lane++)n=add(n,`experience_${lane}_`,7);for(let i=1;i<=2;i++)n=rules.buy(n,'experience_large_'+i);n=rules.buy(n,'experience_ultimate');
 for(const source of ['wild','raid','tower'])n=add(n,'money_'+source+'_',10);return rules.buy(n,'money_ultimate');
}
test('all four branches can coexist at 31 points each; the former shared 41-point cap is gone',()=>{
 const n=fullTree(),state=rules.validate(n);assert.equal(catalog.maxPoints,124);assert.equal(state.used,124);assert.deepEqual(state.branches,{capture:31,experience:31,money:31,combat:31});
 assert.equal(rules.bonuses(n).capture.Water,49);assert.equal(rules.bonuses(n).offense.Fire,22);assert.equal(rules.bonuses(n).defense.Water,22);assert.equal(rules.bonuses(n).globalDamage,6);
 let onlyCapture=Object.fromEntries(Object.entries(n).filter(([id])=>rules.byId.get(id).branch==='capture'));
 assert.throws(()=>rules.buy(onlyCapture,'capture_rock_1'),/31 points/);assert.equal(rules.points(rules.buy(onlyCapture,'experience_1_1')).used,32);
});
test('each of the 18 combat paths doubles bonuses while halving only its last node type plates',()=>{
 for(const type of Object.keys(catalog.types)){
  const nodes=catalog.nodes.filter(n=>n.branch==='combat'&&n.type===type);assert.deepEqual(nodes.map(n=>n.bonus),[2,2,2,2,4,4,6]);assert.deepEqual(nodes.map(n=>n.cost['dark_plate_'+type.toLowerCase()]),[4,4,4,4,10,10,20]);
  assert.deepEqual(Object.fromEntries(Object.entries(nodes[6].cost).filter(([key])=>!key.startsWith('dark_plate_'))),{crystal_shard:800,clear_crystal:400,aurora_prism:160});
 }
 assert.equal(rules.byId.get('combat_ultimate').bonus,6);assert.equal(rules.byId.get('combat_ultimate').mixedPlates,200);
 assert.equal(rules.byId.get('experience_ultimate').cost.money,5000000);assert.equal(rules.byId.get('money_ultimate').cost.money,5000000);
 assert.equal(rules.byId.get('experience_ultimate').bonus,10);assert.equal(rules.byId.get('money_ultimate').bonus,15);assert.equal(catalog.moduleCost.money,10000000);
});
test('capture branch nodes, costs, positions, descriptions and bonus values remain byte-for-byte equivalent',()=>{
 const data={branch:catalog.branches.capture,types:catalog.types,nodes:catalog.nodes.filter(n=>n.branch==='capture')};
 assert.equal(createHash('sha256').update(JSON.stringify(data)).digest('hex'),'422e6b8607788898196ef6bb72ac0c79cf986c60935c5eb1f7ce374d572856dc');
});
test('saved version 1 raid/Tower profiles receive the doubled combat bonus exactly once',()=>{
 const old={version:1,offense:{Fire:11},defense:{Water:11},globalDamage:3},current={version:2,offense:{Fire:22},defense:{Water:22},globalDamage:6};
 const wrap=b=>({__trainerTalents:b}),before=structuredClone(old);
 for(const scope of ['wild','raid','tower']){
  assert.equal(fx.damage(wrap(old),wrap(old),'Fire',scope),fx.damage(wrap(current),wrap(current),'Fire',scope));
  assert.equal(fx.damage(wrap(old),wrap(old),'Water',scope),fx.damage(wrap(current),wrap(current),'Water',scope));
 }
 assert.deepEqual(old,before);assert.equal(fx.damage(wrap(old),wrap(old),'Fire','pvp'),1);assert.equal(fx.damage(wrap(current),wrap(current),'Fire','trainer'),1);
 assert.equal(rules.bonuses(fullTree()).version,3);
});
