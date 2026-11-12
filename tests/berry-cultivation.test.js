const test=require('node:test'),assert=require('node:assert/strict');
const rules=require('../server/game/berries/rules'),items=require('../data/game/items.json').items;
const Pokemon=require('../server/game/models/Pokemon'),engine=require('../server/game/battle/battleEngine'),berry=require('../server/game/berries/combat');
const make=(id=25)=>{const p=new Pokemon(id,'Test',50,125000,{hp:31,attack:31,defense:31,specialAttack:31,specialDefense:31,speed:31},'Hardy',1);p.passiveAbility='Pressure';p.abilities=['Tackle'];return p;};
const enter=(p,q=make(1),state=engine.createBattleState())=>{engine.applySwitchInEffects(p,state.sides.player,state.sides.enemy,state,q);return state;};
test('39 classic berries retained; all ingredients and all 42 effect families are available',()=>{
 assert.equal(rules.base.size,39);assert.equal(items.filter(i=>i.berryKind==='ingredient').length,39);assert.equal(items.filter(i=>i.berryKind==='mutation').length,126);
 assert.equal(new Set(rules.catalog.families.map(f=>f.ingredients.join('|'))).size,42);
 assert.equal(new Set(rules.catalog.families.flatMap(f=>f.ingredients)).size,39);
 for(const family of rules.catalog.families){assert.equal(rules.recipe(family.ingredients).family,family.id);for(const rarity of ['common','rare','legendary']){const i=items.find(i=>i.key===family.results[rarity]);assert(i);assert.equal(i.mutationBerry.rarity,rarity);assert.equal(i.permanentConsumption,true);if(rarity==='common')assert.equal(i.mutationBerry.penalty,undefined);if(rarity==='legendary')assert(i.mutationBerry.entryStage&&i.mutationBerry.penalty);}}
});
test('every unordered mix has stable results, order-independent, with exact rarity boundaries',()=>{
 const keys=[...rules.ingredients],counts={};
 for(let i=0;i<keys.length;i++)for(let j=i;j<keys.length;j++)for(let k=j;k<keys.length;k++){const a=rules.recipe([keys[i],keys[j],keys[k]]),b=rules.recipe([keys[k],keys[i],keys[j]]);assert.deepEqual(a,b);}
 for(let roll=0;roll<100;roll++){const r=rules.mutate(keys.slice(0,3),roll);counts[r.rarity]=(counts[r.rarity]||0)+1;}
 assert.deepEqual(counts,{failed:20,common:50,rare:25,legendary:5});
 assert.throws(()=>rules.recipe(keys.slice(0,2)));assert.throws(()=>rules.recipe(['oran_berry',...keys.slice(0,2)]));
});
test('offline growth has independent slots and exact timestamp boundaries',()=>{
 assert.equal(rules.growth(null).stage,'empty');const c={plantedAt:1000};assert.equal(rules.growth(c,300999).stage,'seed');assert.equal(rules.growth(c,301000).stage,'sprout');assert.equal(rules.growth(c,900999).stage,'sprout');assert.equal(rules.growth(c,901000).stage,'mature');assert.equal(rules.growth(c,901000).remainingMs,0);assert.equal(rules.growth(c,0).remainingMs,900000);
});
test('all 126 native berries consume once on entry, never refund, and clean up on switch',()=>{
 for(const item of items.filter(i=>i.mutationBerry)){
  const p=make(),baseHp=p.maxHp;p.heldItem=item.key;const state=engine.createBattleState();state.restoreBerries=true;enter(p,make(1),state);
  assert.equal(p.heldItem,null,item.key);assert(p.__battle.mutationBerry,item.key);assert.equal(p.__berrySpent.length,1);
  assert.equal(p.__berrySpent[0].itemKey,item.key);assert.equal(Object.hasOwn(p,'__heldItemConsumedForBattle'),false);
  if(item.mutationBerry.entryStage)assert.equal(p.__battle.statStages[item.mutationBerry.entryStage.stat],1);
  require('../server/game/battle/battleTeam').clearSwitchOutState(p);assert.equal(p.maxHp,baseHp);assert.equal(p.__battle?.mutationBerry,undefined);
  enter(p,make(1),state);assert.equal(p.__battle.mutationBerry,undefined);assert.equal(p.__berrySpent.length,1);
  require('../server/game/battle/battleOutcome').clearBattleTransientState([p]);assert.equal(p.heldItem,null);assert.equal(p.maxHp,baseHp);
 }
});
test('typed damage and every stat bonus/penalty have the fixed documented multipliers',()=>{
 for(const f of rules.catalog.families){const p=make(),q=make(1),i=items.find(i=>i.key===f.results.legendary);p.heldItem=i.key;enter(p,q);const b=i.mutationBerry;
  if(b.bonus.kind==='stat')assert.equal(berry.statMultiplier(p,b.bonus.stat),1.3);
  if(b.bonus.kind==='offense')assert.equal(berry.damageMultiplier(p,q,b.bonus.type),1.3);
  if(b.bonus.kind==='defense')assert.equal(berry.damageMultiplier(q,p,b.bonus.type),.7);
  assert.equal(berry.statMultiplier(p,b.penalty.stat),.75);
 }
});
test('held policy permits mutations on both normal and corrupted Pokémon; failed berries cannot be held',()=>{
 const policy=require('../server/game/items/heldItemPolicy');
 for(const item of items.filter(i=>i.berryKind==='mutation')){
  assert(policy.canHold(make(),item.key),item.key+' normal');
  assert(policy.canHold({corruption:{permanent:true}},item.key),item.key+' corrupted');
 }
 assert.equal(items.find(i=>i.key==='failed_mutation_berry').category,'treasure');
 for(const item of items.filter(i=>['ingredient','failed'].includes(i.berryKind))){
  assert.equal(policy.canHold(make(),item.key),false,item.key+' normal');
  assert.equal(policy.canHold({corruption:{permanent:true}},item.key),false,item.key+' corrupted');
 }
});
test('Unnerve and Klutz do not consume blocked berries; ordinary berries still follow native effects',()=>{
 const p=make(),q=make(1);p.heldItem='mutant_stat_attack_common_berry';q.passiveAbility='Unnerve';enter(p,q);assert.equal(p.heldItem,'mutant_stat_attack_common_berry');assert.equal(p.__berrySpent,undefined);
 p.passiveAbility='Klutz';q.passiveAbility='Pressure';enter(p,q);assert(p.heldItem);
 const oran=make();oran.heldItem='oran_berry';oran.currentHp=1;const state=engine.createBattleState();state.restoreBerries=true;enter(oran,q,state);assert.equal(oran.currentHp,11);require('../server/game/battle/battleOutcome').clearBattleTransientState([oran]);assert.equal(oran.heldItem,'oran_berry');
});
test('temporary HP remains temporary through permanent stat recalculation and cannot heal by repeated switching',()=>{
 const p=make();p.heldItem='mutant_stat_maxhp_common_berry';enter(p);p.currentHp=Math.floor(p.maxHp/2);const before=berry.savedHp(p);p.ev.hp=252;p.recalculateStats(true);const trained=p.__berryBaseMaxHp;assert(trained);const saved=berry.savedHp(p);assert(saved>=before);require('../server/game/battle/battleTeam').clearSwitchOutState(p);assert.equal(p.maxHp,trained);assert.equal(p.currentHp,saved);const hp=p.currentHp;enter(p);assert.equal(p.currentHp,hp);
});
