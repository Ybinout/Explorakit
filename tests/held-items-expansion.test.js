const test=require('node:test'),assert=require('node:assert/strict');
const engine=require('../server/game/battle/battleEngine'),factory=require('../server/game/drift/pokemonFactory');
const held=require('../server/game/items/heldItems'),training=require('../server/game/models/training');
const resources=require('../server/game/battle/battleResources'),loot=require('../server/game/items/wildLoot');
const keys=['macho_brace','muscle_band','wise_glasses','wide_lens','scope_lens','flame_orb'];
function mon(id=143){const p=factory.create(id,50,true);p.passiveAbility=null;p.heldItem=null;p.status='normal';return p;}
function fixed(n,fn){const old=Math.random;Math.random=()=>n;try{return fn();}finally{Math.random=old;}}
function cast(p,q,name,state=engine.createBattleState()) {p.abilities=[name];p.movePp=[resources.getMaxMovePp(name)];return engine.useattack(name,p,q,{battleState:state,attackerSide:state.sides.player,defenderSide:state.sides.enemy});}
function end(p,q,state){return engine.processEndOfRound(p,q,state.sides.player,state.sides.enemy,state);}

test('Macho Brace halves battle Speed without altering permanent stats, even with Klutz; suppression and removal restore it',()=>{
 const p=mon(65),q=mon(),s=engine.createBattleState(),speed=engine.getBattleSpeed(p,null,s,q),stats=JSON.stringify([p.speed,p.currentSpeed,p.ev,p.iv]);
 p.heldItem='macho_brace';assert.equal(engine.getBattleSpeed(p,null,s,q),Math.max(1,Math.floor(speed/2)));
 p.passiveAbility='Klutz';assert.equal(engine.getBattleSpeed(p,null,s,q),Math.max(1,Math.floor(speed/2)));
 s.field.magicRoomTurns=2;assert.equal(engine.getBattleSpeed(p,null,s,q),speed);s.field.magicRoomTurns=0;
 engine.ensureBattleData(p).embargoTurns=2;assert.equal(engine.getBattleSpeed(p,null,s,q),speed);p.__battle.embargoTurns=0;
 p.heldItem=null;assert.equal(engine.getBattleSpeed(p,null,s,q),speed);assert.equal(JSON.stringify([p.speed,p.currentSpeed,p.ev,p.iv]),stats);
});
test('Macho Brace doubles each participating holder’s EV yield, not XP or vitamins, respecting 252/510 caps and KO training',()=>{
 const a=mon(),b=mon(),bench=mon(),foe=mon(19);a.heldItem=bench.heldItem='macho_brace';const xp=a.experience;
 let gains=training.grantParticipantEffort([a,b,bench],foe,new Set([a.uuid,b.uuid]));assert.equal(gains.get(a.uuid).speed,2);assert.equal(gains.get(b.uuid).speed,1);assert.equal(bench.ev.speed,0);assert.equal(a.experience,xp);
 a.currentHp=0;training.grantParticipantEffort([a],foe,new Set([a.uuid]));assert.equal(a.ev.speed,4);assert.equal(a.currentHp,0);
 a.currentHp=1;a.ev={hp:252,attack:6,defense:0,specialAttack:0,specialDefense:0,speed:251};a.recalculateStats(true);training.grantEffort(a,foe);assert.equal(a.ev.speed,252);assert.equal(Object.values(a.ev).reduce((n,v)=>n+v),510);
 const vitamin=mon();vitamin.heldItem='macho_brace';assert.equal(require('../server/game/items/medicineEffects').medicineResult(vitamin,'protein').ev.attack,10);
});
for(const[key,boosted,other]of[['muscle_band','Tackle','Psychic'],['wise_glasses','Psychic','Tackle']])test(`${key}: boosts only the correct power class and is suppressed without mutating an AI preview`,()=>{
 const p=mon(68),q=mon(),s=engine.createBattleState(),move=engine.getMoveByName(boosted),otherMove=engine.getMoveByName(other);
 const base=engine.estimateDamage(p,q,move,{battleState:s}),otherDamage=engine.estimateDamage(p,q,otherMove,{battleState:s});p.heldItem=key;
 const before=JSON.stringify([p,q,s]);assert(engine.estimateDamage(p,q,move,{battleState:s})>base);assert.equal(engine.estimateDamage(p,q,otherMove,{battleState:s}),otherDamage);assert.equal(JSON.stringify([p,q,s]),before);
 for(const suppression of['magic','embargo','klutz']){s.field.magicRoomTurns=suppression==='magic'?2:0;engine.ensureBattleData(p).embargoTurns=suppression==='embargo'?2:0;p.passiveAbility=suppression==='klutz'?'Klutz':null;assert.equal(engine.estimateDamage(p,q,move,{battleState:s}),base);}
 p.passiveAbility=null;p.__battle.embargoTurns=0;s.field.magicRoomTurns=0;const fixedHit=fixed(.5,()=>cast(p,q,'Sonic Boom',s));assert.equal(fixedHit.damage,20,'fixed damage must not be amplified');
});
test('Wide Lens improves real and planner accuracy, never OHKO chances, guaranteed hits or unreachable targets',()=>{
 const p=mon(94),q=mon(),s=engine.createBattleState(),m=engine.getMoveByName('Hypnosis');assert.equal(engine.getMoveHitChance(m,p,q,s),.6);p.heldItem='wide_lens';assert(Math.abs(engine.getMoveHitChance(m,p,q,s)-.66)<1e-12);
 assert.equal(engine.getMoveHitChance(engine.getMoveByName('Fissure'),p,q,s),.3);assert.equal(engine.getMoveHitChance(engine.getMoveByName('Swift'),p,q,s),1);
 s.weather={kind:'rain',turns:5};assert.equal(engine.getMoveHitChance(engine.getMoveByName('Thunder'),p,q,s),1);
 const miss=fixed(.65,()=>cast(mon(94),mon(),'Hypnosis'));assert.equal(miss.success,false);
 const target=mon(),hit=fixed(.65,()=>cast(p,target,'Hypnosis',s));assert(hit.success);assert.equal(target.status,'sleep');
 p.passiveAbility='Klutz';assert.equal(engine.getMoveHitChance(m,p,q,s),.6);p.passiveAbility=null;s.field.magicRoomTurns=2;assert.equal(engine.getMoveHitChance(m,p,q,s),.6);
});
test('Scope Lens raises the actual critical tier, respecting crit immunity, Lucky Chant and item suppression',()=>{
 const run=(item,ability=null,chant=0)=>{const p=mon(68),q=mon(),s=engine.createBattleState();p.heldItem=item;q.passiveAbility=ability;s.sides.enemy.screens.luckyChantTurns=chant;return fixed(.08,()=>cast(p,q,'Tackle',s));};
 assert.equal(run(null).critical,false);assert.equal(run('scope_lens').critical,true);assert.equal(run('scope_lens','Battle Armor').critical,false);assert.equal(run('scope_lens',null,2).critical,false);
 const p=mon(),s=engine.createBattleState();p.heldItem='scope_lens';assert.equal(held.criticalStage(p,s),1);p.passiveAbility='Klutz';assert.equal(held.criticalStage(p,s),0);
});
test('Flame Orb activates late, remains equipped, and supports Guts with no first-turn burn damage',()=>{
 const p=mon(214),q=mon(),s=engine.createBattleState();p.heldItem='flame_orb';p.passiveAbility='Guts';const hp=p.currentHp,attack=engine.estimateDamage(p,q,engine.getMoveByName('Tackle'),{battleState:s});
 assert(end(p,q,s).some(m=>m.includes('Orbe Flamme')));assert.equal(p.status,'burn');assert.equal(p.currentHp,hp);assert.equal(p.heldItem,'flame_orb');assert(engine.estimateDamage(p,q,engine.getMoveByName('Tackle'),{battleState:s})>attack*1.4);
 end(p,q,s);assert.equal(p.currentHp,hp-Math.max(1,Math.floor(p.maxHp/16)));assert.equal(p.heldItem,'flame_orb');
});
test('Flame Orb respects Fire, Water Veil/Bubble, statuses, Magic Room, Embargo, Klutz, terrain and KO',()=>{
 for(const opts of[{id:6},{ability:'Water Veil'},{ability:'Water Bubble'},{ability:'Klutz'},{status:'poison'},{ko:true},{magic:true},{embargo:true},{misty:true}]){
  const p=mon(opts.id||143),q=mon(),s=engine.createBattleState();p.heldItem='flame_orb';p.passiveAbility=opts.ability||null;p.status=opts.status||'normal';if(opts.ko)p.currentHp=0;if(opts.magic)s.field.magicRoomTurns=3;if(opts.embargo)engine.ensureBattleData(p).embargoTurns=3;if(opts.misty)s.terrain={kind:'misty_terrain',turns:3};
  end(p,q,s);assert.equal(p.status,opts.status||'normal',JSON.stringify(opts));assert.equal(p.heldItem,'flame_orb');
 }
 const p=mon(),q=mon(),s=engine.createBattleState();p.heldItem='flame_orb';p.passiveAbility='Synchronize';engine.ensureBattleData(p).substituteHp=20;s.sides.player.screens.safeguardTurns=3;end(p,q,s);assert.equal(p.status,'burn');assert.equal(q.status,'normal');
});
test('Flame Orb and its AI projection use the same immunity and end-turn rules on private copies',()=>{
 const model=require('../server/game/battle/humanTrainerModel');
 for(const ability of[null,'Guts','Magic Guard','Water Veil','Klutz']){const p=mon(214),q=mon(),s=engine.createBattleState();p.heldItem='flame_orb';p.passiveAbility=ability;engine.ensureBattleData(p);engine.ensureBattleData(q);const copy=structuredClone(p),field=structuredClone(s),source=JSON.stringify([p,q,s]);model.endTurn(copy,structuredClone(q),field);assert.equal(JSON.stringify([p,q,s]),source);end(p,q,s);assert.equal(copy.status,p.status);assert.equal(copy.currentHp,p.currentHp);assert.equal(copy.heldItem,p.heldItem);}
});
test('Fling consumes the thrown item and the Flame Orb burns its target rather than the thrower',()=>{
 for(const key of keys){const p=mon(68),q=mon(),s=engine.createBattleState();p.heldItem=key;const r=fixed(.5,()=>cast(p,q,'Fling',s));assert(r.damage>0,key);assert.equal(p.heldItem,null);assert.equal(q.status,key==='flame_orb'?'burn':'normal');}
});
test('six stackable equipment drops, post-Hoze 10000 strategy offers and mirrored descriptions stay coherent',async()=>{
 const shops=require('../server/game/world/shopCatalog'),catalog=require('../data/game/items.json').items,client=require('../vue-explorakit/src/data/heldItems.json'),{BAG_ITEM_DESIGNS}=await import('../vue-explorakit/src/services/bagItemPresentation.js');
 for(const key of keys){const item=catalog.find(i=>i.key===key);assert(!item.unique);assert.equal(item.buy_price,10000);assert.deepEqual(item.wildLoot,{group:'equipment',weight:1});
  const locked=shops.getShopCatalog({mapName:'tour_etage2'}).find(i=>i.key===key),open=shops.getShopCatalog({mapName:'tour_etage2',flags:{hoze_defeated:'true'}}).find(i=>i.key===key);assert(locked.locked);assert.equal(open.locked,false);assert.equal(open.price,10000);assert.equal(open.category,'held');assert.deepEqual(client[key],{name:item.name,description:item.description});assert.equal(BAG_ITEM_DESIGNS[key].kind,key);
  const equipment=catalog.filter(i=>i.wildLoot?.group==='equipment'),claimed=new Set([...loot.uniqueKeys,key]);assert(!loot.uniqueKeys.includes(key));for(let n=0;n<2;n++){const draws=[.85,(equipment.findIndex(i=>i.key===key)+.5)/equipment.length];assert.equal(loot.select(claimed,()=>draws.shift()).key,key);}
 }
});
