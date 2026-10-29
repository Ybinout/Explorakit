const test=require('node:test'),assert=require('node:assert/strict');
const engine=require('../server/game/battle/battleEngine'),held=require('../server/game/items/heldItems'),ai=require('../server/game/drift/colosseumAI');
const factory=require('../server/game/drift/pokemonFactory');
function fixture(){
 const p=factory.create(7,40,true),opponent=factory.create(19,40,true),state=engine.createBattleState();
 p.heldItem='heavy_duty_boots';p.passiveAbility=null;p.type1='Normal';p.type2=null;p.maxHp=p.currentHp=240;
 Object.assign(state.sides.player.hazards,{spikes:3,stealthRock:true,toxicSpikes:2,stickyWeb:true});
 const enter=()=>engine.applySwitchInEffects(p,state.sides.player,state.sides.enemy,state,opponent);
 return {p,opponent,state,enter};
}

test('Grosses Bottes protect from all four entry hazards without consuming, clearing traps or skipping entry abilities/heals',()=>{
 const {p,state,enter}=fixture(),before={...state.sides.player.hazards};p.currentHp=1;p.passiveAbility='Drizzle';
 enter();assert.equal(p.currentHp,1);assert.equal(p.status,'normal');assert.equal(p.__battle.statStages.speed,0);assert.equal(p.heldItem,'heavy_duty_boots');assert.deepEqual(state.sides.player.hazards,before);assert.equal(state.weather.kind,'rain');
 p.currentHp=120;state.sides.player.pendingFullHeal=true;enter();assert.equal(p.currentHp,240);assert.equal(p.heldItem,'heavy_duty_boots');
});

test('neutralized or removed boots no longer protect; Poison types still absorb Toxic Spikes with active boots',()=>{
 for(const kind of ['embargo','magicRoom','klutz','removed']){
  const {p,state,enter}=fixture();
  if(kind==='embargo')engine.ensureBattleData(p).embargoTurns=2;
  if(kind==='magicRoom')state.field.magicRoomTurns=2;
  if(kind==='klutz')p.passiveAbility='Klutz';
  if(kind==='removed')p.heldItem=null;
  enter();assert.equal(p.currentHp,150,kind);assert.equal(p.status,'badly_poison',kind);assert.equal(p.__battle.statStages.speed,-1,kind);assert.equal(ai.entryDamage(p,state.sides.player,state),90,kind);
 }
 const f=fixture();f.p.type1='Poison';f.enter();assert.equal(f.p.currentHp,240);assert.equal(f.state.sides.player.hazards.toxicSpikes,0);assert.equal(f.p.status,'normal');assert.equal(f.p.__battle.statStages.speed,0);
 const g=fixture();g.p.passiveAbility='Klutz';engine.ensureBattleData(g.p).abilitySuppressed=true;g.enter();assert.equal(g.p.currentHp,240);assert.equal(ai.entryDamage(g.p,g.state.sides.player,g.state),0);
});

test('boots can be knocked off for the battle and recover afterward; next entry then takes hazard damage',()=>{
 const {p,opponent,state,enter}=fixture();opponent.abilities=['Knock Off'];opponent.movePp=[20];p.maxHp=p.currentHp=10000;
 const outcome=engine.useattack('Knock Off',opponent,p,{battleState:state});assert(outcome.damage>0);assert.equal(p.heldItem,null);
 p.maxHp=p.currentHp=240;enter();assert.equal(p.currentHp,150);
 require('../server/game/battle/battleOutcome').clearBattleTransientState([p,opponent]);assert.equal(p.heldItem,'heavy_duty_boots');
});

test('boots use strategic shop unlock/price, unique wild loot and client labels; AI and entry visuals respect suppression',async()=>{
 const items=require('../data/game/items.json').items,boots=items.find(i=>i.key==='heavy_duty_boots'),shop=require('../server/game/world/shopCatalog'),loot=require('../server/game/items/wildLoot');
 const before=shop.getShopCatalog({mapName:'tour_etage2'}).find(i=>i.key===boots.key);assert(before.locked);assert.equal(before.price,10000);
 const unlocked=shop.getShopCatalog({mapName:'tour_etage2',flags:{hoze_defeated:'true'}}).find(i=>i.key===boots.key);assert(!unlocked.locked);
 assert(shop.getShopCatalog({mapName:'tour_etage2',expedition:true}).some(i=>i.key===boots.key&&!i.locked));
 assert.deepEqual(require('../vue-explorakit/src/data/heldItems.json')[boots.key],{name:boots.name,description:boots.description});
 const claimed=new Set(loot.uniqueKeys.filter(k=>k!==boots.key));assert.equal(loot.select(claimed,()=>.99).key,boots.key);claimed.add(boots.key);assert.notEqual(loot.select(claimed,()=>.99).key,boots.key);
 const ui=await import('../vue-explorakit/src/services/battleField.js'),{p,state}=fixture();const field=()=>ui.normalizeBattleField(require('../server/game/battle/battleEvents').serializeFieldState(state));
 assert.equal(ai.entryDamage(p,state.sides.player,state),0);assert(!ui.hazardEntryVisible(field(),'player',p));
 p.type1='Poison';assert(ui.hazardEntryVisible(field(),'player',p));p.type1='Normal';
 state.field.magicRoomTurns=3;assert(ai.entryDamage(p,state.sides.player,state)>0);assert(ui.hazardEntryVisible(field(),'player',p));
});
