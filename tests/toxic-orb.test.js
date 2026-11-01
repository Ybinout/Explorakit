const test=require('node:test'),assert=require('node:assert/strict');
const engine=require('../server/game/battle/battleEngine'),factory=require('../server/game/drift/pokemonFactory'),codec=require('../server/game/drift/checkpointCodec');
function fixture({id=472,ability=null,status='normal',hp=.5}={}){
 const p=factory.create(id,50,true),e=factory.create(143,50,true),state=engine.createBattleState();p.passiveAbility=ability;p.heldItem='toxic_orb';p.status=status;p.currentHp=Math.floor(p.maxHp*hp);e.passiveAbility=null;e.heldItem=null;
 return {p,e,state,end:()=>engine.processEndOfRound(p,e,state.sides.player,state.sides.enemy,state)};
}
test('Toxic Orb activates late, without consumption or poison damage that turn; later poison escalates normally',()=>{
 const f=fixture(),{p}=f,hp=p.currentHp;const first=f.end();assert.equal(p.status,'badly_poison');assert.equal(p.currentHp,hp);assert.equal(p.heldItem,'toxic_orb');assert.equal(p.__battle.toxicCounter,1);assert(first.some(s=>s.includes('Orbe Poison')));
 assert(!f.end().some(s=>s.includes('Orbe Poison')));assert.equal(p.currentHp,hp-Math.max(1,Math.floor(p.maxHp/16)));assert.equal(p.__battle.toxicCounter,2);
 f.end();assert.equal(p.currentHp,hp-Math.max(1,Math.floor(p.maxHp/16))-Math.max(1,Math.floor(p.maxHp*2/16)));assert.equal(p.heldItem,'toxic_orb');
});
test('Poison Heal starts on the following turn; Heal Block does not prevent the orb from applying poison',()=>{
 const f=fixture({ability:'Poison Heal'}),hp=f.p.currentHp;f.end();assert.equal(f.p.currentHp,hp);assert.equal(f.p.status,'badly_poison');const messages=f.end();assert.equal(f.p.currentHp,hp+Math.max(1,Math.floor(f.p.maxHp/8)));assert(messages.some(m=>m.includes('Soin Poison')));
 const blocked=fixture({ability:'Poison Heal'}),data=engine.ensureBattleData(blocked.p),before=blocked.p.currentHp;data.healBlockTurns=3;blocked.end();assert.equal(blocked.p.status,'badly_poison');blocked.end();assert.equal(blocked.p.currentHp,before);
});
test('existing statuses, KO, Poison/Steel types, Immunity, and item suppression prevent activation',()=>{
 for(const status of ['burn','paralyze','sleep','poison','badly_poison']){const f=fixture({status,ability:'Magic Guard'});f.end();assert.equal(f.p.status,status);assert.equal(f.p.heldItem,'toxic_orb');}
 for(const options of [{id:94},{id:208},{id:335,ability:'Immunity'},{ability:'Klutz'},{hp:0}]){const f=fixture(options);assert(!f.end().some(m=>m.includes('Orbe Poison')));assert.equal(f.p.status,'normal');assert.equal(f.p.heldItem,'toxic_orb');}
 const embargo=fixture();engine.ensureBattleData(embargo.p).embargoTurns=3;embargo.end();assert.equal(embargo.p.status,'normal');
 const room=fixture();room.state.field.magicRoomTurns=2;room.end();assert.equal(room.p.status,'normal');room.state.field.magicRoomTurns=0;room.end();assert.equal(room.p.status,'badly_poison');
});
test('self-inflicted orb poison ignores Substitute and Safeguard, respects grounded Misty Terrain, and does not synchronize',()=>{
 const f=fixture({ability:'Synchronize'});f.state.sides.player.screens.safeguardTurns=3;engine.ensureBattleData(f.p).substituteHp=10;f.end();assert.equal(f.p.status,'badly_poison');assert.equal(f.e.status,'normal');assert.equal(f.p.__battle.substituteHp,10);
 const grounded=fixture({id:335});grounded.state.terrain={kind:'misty_terrain',turns:3};grounded.end();assert.equal(grounded.p.status,'normal');
 const airborne=fixture();airborne.state.terrain={kind:'misty_terrain',turns:3};airborne.end();assert.equal(airborne.p.status,'badly_poison');
});
test('Magic Guard prevents residual damage, Toxic Boost benefits from the status, and recovery/save preserve the orb',()=>{
 const f=fixture({ability:'Magic Guard'}),hp=f.p.currentHp;f.end();f.end();assert.equal(f.p.status,'badly_poison');assert.equal(f.p.currentHp,hp);
 const boost=fixture({id:335,ability:'Toxic Boost'}),move=engine.getMoveByName('Tackle'),before=engine.estimateDamage(boost.p,boost.e,move,{battleState:boost.state});boost.end();const after=engine.estimateDamage(boost.p,boost.e,move,{battleState:boost.state});assert(after>before*1.4);
 const saved=codec.decode(codec.encode(boost.p));assert.equal(saved.heldItem,'toxic_orb');assert.equal(saved.status,'badly_poison');require('../server/game/battle/battleOutcome').clearBattleTransientState([saved]);assert.equal(saved.heldItem,'toxic_orb');
});
test('Fling uses the Toxic Orb to poison the damaged target; substitutes and status immunities still work',()=>{
 const old=Math.random;Math.random=()=>.5;try{
  for(const target of ['normal','substitute','steel']){
   const f=fixture({id:335});f.p.abilities=['Fling'];f.p.movePp=[10];if(target==='substitute')engine.ensureBattleData(f.e).substituteHp=f.e.maxHp;if(target==='steel'){f.e.type1='Steel';f.e.type2=null;}
   const result=engine.useattack('Fling',f.p,f.e,{battleState:f.state,attackerSide:f.state.sides.player,defenderSide:f.state.sides.enemy});assert(result.damage+result.substituteDamage>0);assert.equal(f.p.heldItem,null);assert.equal(f.e.status,target==='normal'?'badly_poison':'normal');
  }
 }finally{Math.random=old;}
});
test('Toxic Orb is a unique equipment drop and a 10000 ₽ strategy purchase after Hoze; mirrored text is identical',()=>{
 const item=require('../data/game/items.json').items.find(i=>i.key==='toxic_orb'),shops=require('../server/game/world/shopCatalog');assert.equal(item.category,'held');assert.equal(item.unique,true);assert.deepEqual(item.wildLoot,{group:'equipment',weight:1});assert.equal(item.buy_price,10000);
 const locked=shops.getShopCatalog({mapName:'tour_etage2'}).find(i=>i.key===item.key);assert(locked.locked);assert.equal(locked.price,10000);
 const flags=Object.fromEntries(require('../data/game/shop_offers.json').tiers.slice(0,3).filter(t=>t.flag).map(t=>[t.flag,'true']));assert.equal(shops.getShopCatalog({mapName:'tour_etage2',flags}).find(i=>i.key===item.key).locked,false);
 assert.deepEqual(require('../vue-explorakit/src/data/heldItems.json').toxic_orb,{name:item.name,description:item.description});
});
