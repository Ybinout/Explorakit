const test=require('node:test'),assert=require('node:assert/strict');
const engine=require('../server/game/battle/battleEngine'),factory=require('../server/game/drift/pokemonFactory');
const resources=require('../server/game/battle/battleResources'),held=require('../server/game/items/heldItems');
const model=require('../server/game/battle/humanTrainerModel'),outcome=require('../server/game/battle/battleOutcome');
const items=require('../data/game/items.json').items,newItems=items.filter(i=>['type_power','black_sludge','light_clay','big_root','shed_shell','white_herb','mental_herb','power_herb','air_balloon','weakness_policy','protective_pads','weather_rock'].includes(i.battle_effect));
function mon(id=143,item=null){const p=factory.create(id,50,true);Object.assign(p,{currentHp:400,maxHp:400,attack:100,defense:100,specialAttack:100,specialDefense:100,speed:100,currentAttack:100,currentDefense:100,currentSpecialAttack:100,currentSpecialDefense:100,currentSpeed:100,passiveAbility:null,heldItem:item,status:'normal'});engine.ensureBattleData(p);return p;}
function fixed(fn,n=.5){const old=Math.random;Math.random=()=>n;try{return fn();}finally{Math.random=old;}}
function cast(a,b,name,s=engine.createBattleState(),reverse=false,random=.5){a.abilities=[name];a.movePp=[resources.getMaxMovePp(name)];return fixed(()=>engine.useattack(name,a,b,{battleState:s,attackerSide:s.sides[reverse?'enemy':'player'],defenderSide:s.sides[reverse?'player':'enemy'],attackerTeam:[a],defenderTeam:[b]}),random);}
function end(a,b,s){return engine.processEndOfRound(a,b,s.sides.player,s.sides.enemy,s);}
const moves={Normal:'Pound',Fire:'Flamethrower',Water:'Surf',Electric:'Thunderbolt',Grass:'Energy Ball',Ice:'Ice Beam',Fighting:'Brick Break',Poison:'Sludge Bomb',Ground:'Earthquake',Flying:'Air Slash',Psychic:'Psychic',Bug:'Bug Buzz',Rock:'Rock Slide',Ghost:'Shadow Ball',Dragon:'Dragon Pulse',Dark:'Dark Pulse',Steel:'Flash Cannon',Fairy:'Moonblast'};
for(const item of newItems.filter(i=>i.battle_effect==='type_power'))test(item.name+': matching type only, +20% power, suppressed and read-only in previews',()=>{
 const a=mon(151),b=mon(151),s=engine.createBattleState(),move=engine.getMoveByName(moves[item.boost_type]),other=engine.getMoveByName(item.boost_type==='Normal'?'Surf':'Pound');assert(move,item.boost_type);
 const damage=engine.estimateDamage(a,b,move,{battleState:s}),unboosted=engine.estimateDamage(a,b,other,{battleState:s});a.heldItem=item.key;
 assert.equal(held.powerMultiplier(a,move,s),1.2);assert.equal(held.powerMultiplier(a,other,s),1);
 const before=JSON.stringify([a,b,s]);assert(engine.estimateDamage(a,b,move,{battleState:s})>damage);assert.equal(engine.estimateDamage(a,b,other,{battleState:s}),unboosted);assert.equal(JSON.stringify([a,b,s]),before);
 for(const cause of ['klutz','embargo','magic']){a.passiveAbility=cause==='klutz'?'Klutz':null;a.__battle.embargoTurns=cause==='embargo'?2:0;s.field.magicRoomTurns=cause==='magic'?2:0;assert.equal(engine.estimateDamage(a,b,move,{battleState:s}),damage);}
});
test('type boost does not disable Technician at exactly 60 base power, nor change fixed damage',()=>{
 const a=mon(151,'sea_incense'),b=mon(),s=engine.createBattleState();a.passiveAbility='Technician';const move=engine.getMoveByName('Water Pulse');const boosted=engine.estimateDamage(a,b,move,{battleState:s});a.passiveAbility=null;assert(boosted>engine.estimateDamage(a,b,move,{battleState:s})*1.4);
 a.heldItem='silk_scarf';assert.equal(cast(a,b,'Sonic Boom',s).damage,20);
});
for(const [type,ability,blocked,expected] of [['Poison',null,false,25],['Normal',null,false,-50],['Normal','Magic Guard',false,0],['Poison',null,true,0],['Normal',null,true,-50],['Poison','Klutz',false,0]])test('Vase Noire '+[type,ability,blocked].join('/'),()=>{
 const a=mon(143,'black_sludge'),b=mon(),s=engine.createBattleState();a.type1=type;a.type2=null;a.passiveAbility=ability;a.currentHp=200;if(blocked)a.__battle.healBlockTurns=3;end(a,b,s);assert.equal(a.currentHp,200+expected);assert.equal(a.heldItem,'black_sludge');
});
for(const [move,item,field]of [['Reflect','light_clay','reflectTurns'],['Light Screen','light_clay','lightScreenTurns'],['Aurora Veil','light_clay','auroraVeilTurns']])test(item+' extends '+move+' to eight turns',()=>{
 const a=mon(151,item),b=mon(),s=engine.createBattleState();if(move==='Aurora Veil')s.weather={kind:'hail',turns:9};cast(a,b,move,s);assert.equal(s.sides.player.screens[field],8);end(a,b,s);assert.equal(s.sides.player.screens[field],7);
});
for(const [item,weather,move,ability]of [['damp_rock','rain','Rain Dance','Drizzle'],['heat_rock','sun','Sunny Day','Drought'],['smooth_rock','sandstorm','Sandstorm','Sand Stream'],['icy_rock','hail','Hail','Snow Warning']])test(item+' extends matching move and entry ability, not persistent map weather',()=>{
 const a=mon(151,item),b=mon(),s=engine.createBattleState();cast(a,b,move,s);assert.deepEqual(s.weather,{kind:weather,turns:8});
 const entry=engine.createBattleState();a.passiveAbility=ability;engine.applySwitchInEffects(a,entry.sides.player,entry.sides.enemy,entry,b);assert.equal(entry.weather.turns,8);
 const permanent=engine.createBattleState();permanent.weather={kind:weather,turns:0,persistent:true};a.passiveAbility=null;cast(a,b,'Splash',permanent);end(a,b,permanent);assert.equal(permanent.weather.turns,0);assert(permanent.weather.persistent);
 a.passiveAbility='Klutz';assert.equal(held.fieldDuration(a,weather,s),5);assert.equal(held.fieldDuration(mon(151,item),'trick_room',s),5);
});
test('Grosse Racine boosts drain, not damage or ordinary recovery; reverse Liquid Ooze follows boosted drain',()=>{
 const run=(item,ability)=>{const a=mon(151,item),b=mon();a.currentHp=100;b.passiveAbility=ability;const r=cast(a,b,'Drain Punch');return {r,gain:a.currentHp-100};};
 const plain=run(null),root=run('big_root');assert.equal(root.r.damage,plain.r.damage);assert.equal(root.gain,Math.floor(plain.gain*1.3));assert.equal(run('big_root','Liquid Ooze').gain,-root.gain);
 const a=mon(151,'big_root'),b=mon();a.currentHp=100;cast(a,b,'Recover');assert.equal(a.currentHp,300);
});
test('Grosse Racine boosts Seed, Ingrain, Aqua Ring and Strength Sap, preserving Heal Block',()=>{
 for(const effect of ['seed','ingrain','aquaRing','strength']){const a=mon(151,'big_root'),b=mon(),s=engine.createBattleState();a.currentHp=100;
  if(effect==='seed'){b.__battle.leechSeedSource=a;end(a,b,s);assert.equal(b.currentHp,350);assert.equal(a.currentHp,165);}
  else if(effect==='strength'){cast(a,b,'Strength Sap',s);assert.equal(a.currentHp,230);}
  else{a.__battle[effect]=true;end(a,b,s);assert.equal(a.currentHp,132);}
 }
 const a=mon(151,'big_root'),b=mon(),s=engine.createBattleState();a.currentHp=100;a.__battle.aquaRing=true;a.__battle.healBlockTurns=3;end(a,b,s);assert.equal(a.currentHp,100);
});
test('Carapace Mue allows switching out of traps, including Fairy Lock, but not forbidden fleeing or a charge',()=>{
 const a=mon(208,'shed_shell'),b=mon(51),s=engine.createBattleState();for(const ability of ['Arena Trap','Shadow Tag','Magnet Pull']){b.passiveAbility=ability;assert(engine.canSwitchOut(a,b,s));a.heldItem=null;assert(!engine.canSwitchOut(a,b,s));a.heldItem='shed_shell';}
 b.passiveAbility=null;a.__battle.trappedTurns=3;a.__battle.ingrain=true;assert(engine.canSwitchOut(a,b,s));assert(!engine.canSwitchOut(a,b,s,{escape:true}));s.escapeForbidden=true;assert(!engine.canSwitchOut(a,b,s,{escape:true}));
 a.__battle.chargeMove='Dig';a.__battle.chargeTurns=1;assert(!engine.canSwitchOut(a,b,s));a.__battle.chargeMove=null;s.field.fairyLockTurns=2;assert(engine.canSwitchOut(a,b,s));a.heldItem=null;assert(!engine.canSwitchOut(a,b,s));
});
test('Herbe Blanche restores all negative stages once, preserves bonuses, including self drops and Intimidate',()=>{
 const a=mon(68,'white_herb'),b=mon(),s=engine.createBattleState();a.__battle.statStages.speed=2;cast(a,b,'Close Combat',s);assert.equal(a.__battle.statStages.defense,0);assert.equal(a.__battle.statStages.specialDefense,0);assert.equal(a.__battle.statStages.speed,2);assert.equal(a.heldItem,null);cast(a,b,'Close Combat',s);assert.equal(a.__battle.statStages.defense,-1);outcome.clearBattleTransientState([a]);assert.equal(a.heldItem,'white_herb');
 const q=mon(68,'white_herb'),r=mon();r.passiveAbility='Intimidate';const f=engine.createBattleState();engine.applySwitchInEffects(r,f.sides.enemy,f.sides.player,f,q);assert.equal(q.__battle.statStages.attack,0);assert.equal(q.heldItem,null);
});
for(const key of ['infatuationTurns','tauntTurns','encoreTurns','disableTurns','healBlockTurns','tormented'])test('Herbe Mental immediately cures '+key+' once',()=>{
 const a=mon(151,'mental_herb'),b=mon(),s=engine.createBattleState();a.__battle[key]=key==='tormented'?true:3;a.__battle.encoreMove='Splash';a.__battle.disabledMove='Splash';
 cast(b,a,'Splash',s,true);assert.equal(a.heldItem,null);assert(!a.__battle[key]);assert.equal(a.__battle.encoreMove,null);assert.equal(a.__battle.disabledMove,null);outcome.clearBattleTransientState([a]);assert.equal(a.heldItem,'mental_herb');
});
test('Herbe Mental cures a real incoming Taunt before the next turn',()=>{const a=mon(151,'mental_herb'),b=mon();cast(b,a,'Taunt');assert.equal(a.__battle.tauntTurns,0);assert.equal(a.heldItem,null);assert(!cast(a,b,'Swords Dance').blocked);});
for(const move of ['Solar Beam','Skull Bash','Fly','Dig','Dive','Sky Attack','Bounce','Razor Wind','Freeze Shock','Ice Burn','Phantom Force','Shadow Force','Geomancy'])test('Herbe Pouvoir skips preparation for '+move+', consumes one PP and restores ownership',()=>{
 const a=mon(151,'power_herb'),b=mon(151),s=engine.createBattleState();assert.equal(engine.movePhase(a,move,s,b),null);const r=cast(a,b,move,s);assert.notEqual(r.phase,'prepare');assert.equal(a.heldItem,null);assert.equal(a.movePp[0],resources.getMaxMovePp(move)-1);assert(!a.__battle.chargeMove);assert(r.damage>0||move==='Geomancy');if(move==='Skull Bash')assert.equal(a.__battle.statStages.defense,1);if(move==='Geomancy')assert.equal(a.__battle.statStages.speed,2);outcome.clearBattleTransientState([a]);assert.equal(a.heldItem,'power_herb');
});
test('Herbe Pouvoir remains for sunlight Solar Beam, blocked moves, Sky Drop and recharge',()=>{
 for(const condition of ['sun','sleep','sky','recharge','magic']){const a=mon(151,'power_herb'),b=mon(),s=engine.createBattleState();let move='Solar Beam';if(condition==='sun')s.weather={kind:'sun',turns:3};if(condition==='sleep'){a.status='sleep';a.__battle.sleepTurns=3;}if(condition==='sky')move='Sky Drop';if(condition==='recharge')move='Hyper Beam';if(condition==='magic')s.field.magicRoomTurns=3;cast(a,b,move,s);assert.equal(a.heldItem,'power_herb',condition);}
});
test('Ballon grants Ground and hazard immunity even against Mold Breaker; gravity and suppression override it',()=>{
 const a=mon(151),b=mon(25,'air_balloon'),s=engine.createBattleState();a.passiveAbility='Mold Breaker';assert.equal(cast(a,b,'Earthquake',s).damage,0);assert.equal(b.heldItem,'air_balloon');s.sides.enemy.hazards.spikes=3;engine.applySwitchInEffects(b,s.sides.enemy,s.sides.player,s,a);assert.equal(b.currentHp,400);
 s.field.gravityTurns=3;assert(cast(a,b,'Earthquake',s).damage>0);assert.equal(b.heldItem,null);
 for(const suppress of ['klutz','magic','embargo']){const q=mon(25,'air_balloon'),f=engine.createBattleState();q.passiveAbility=suppress==='klutz'?'Klutz':null;q.__battle.embargoTurns=suppress==='embargo'?3:0;f.field.magicRoomTurns=suppress==='magic'?3:0;assert(cast(mon(151),q,'Earthquake',f).damage>0);assert.equal(q.heldItem,'air_balloon');}
});
test('Ballon pops on hit or substitute damage, not status or immunity, and Thousand Arrows grounds its holder',()=>{
 for(const move of ['Pound','Surf']){const a=mon(151),b=mon(151,'air_balloon');assert(cast(a,b,move).damage>0);assert.equal(b.heldItem,null);outcome.clearBattleTransientState([b]);assert.equal(b.heldItem,'air_balloon');}
 const a=mon(151),b=mon(151,'air_balloon');b.__battle.substituteHp=100;assert(cast(a,b,'Pound').substituteDamage>0);assert.equal(b.heldItem,null);
 const arrows={...engine.getMoveByName('Earthquake'),ename:'Thousand Arrows'};assert(engine.getMoveEffectiveness(arrows,a,mon(151,'air_balloon'))>0);
 const q=mon(94,'air_balloon');cast(a,q,'Pound');assert.equal(q.heldItem,'air_balloon');cast(a,q,'Growl');assert.equal(q.heldItem,'air_balloon');
});
test('Vulné-Assurance activates only for surviving super effective HP damage and only once',()=>{
 const a=mon(151),b=mon(6,'weakness_policy'),s=engine.createBattleState();assert(cast(a,b,'Surf',s).damage>0);assert.equal(b.__battle.statStages.attack,2);assert.equal(b.__battle.statStages.specialAttack,2);assert.equal(b.heldItem,null);cast(a,b,'Surf',s);assert.equal(b.__battle.statStages.attack,2);outcome.clearBattleTransientState([b]);assert.equal(b.heldItem,'weakness_policy');
 for(const condition of ['neutral','fixed','clone','ko','klutz']){const q=mon(6,'weakness_policy');let move='Surf';if(condition==='neutral')move='Pound';if(condition==='fixed')move='Dragon Rage';if(condition==='clone')q.__battle.substituteHp=300;if(condition==='ko')q.currentHp=1;if(condition==='klutz')q.passiveAbility='Klutz';cast(mon(151),q,move);assert.equal(q.heldItem,'weakness_policy',condition);assert.equal(q.__battle.statStages.attack||0,0);}
});
test('Pare-Effet blocks adverse contact reactions but retains contact for own Tough Claws, Poison Touch and Fluffy',()=>{
 for(const ability of ['Rough Skin','Iron Barbs','Aftermath','Gooey','Static','Flame Body','Poison Point','Mummy','Cute Charm']){const a=mon(68,'protective_pads'),b=mon();b.passiveAbility=ability;a.gender='male';b.gender='female';if(ability==='Aftermath')b.currentHp=1;cast(a,b,'Pound',engine.createBattleState(),false,.1);assert.equal(a.currentHp,400,ability);assert.equal(a.status,'normal',ability);assert.equal(a.__battle.statStages.speed||0,0);assert.equal(a.passiveAbility,null);}
 const a=mon(68,'protective_pads'),b=mon();b.heldItem='rocky_helmet';cast(a,b,'Pound');assert.equal(a.currentHp,400);a.passiveAbility='Poison Touch';fixed(()=>{const old=Math.random;Math.random=()=>.1;try{engine.useattack('Pound',a,b,{battleState:engine.createBattleState(),consumePp:false});}finally{Math.random=old;}});assert.equal(b.status,'poison');
 a.passiveAbility='Tough Claws';const move=engine.getMoveByName('Pound'),f=engine.createBattleState(),high=engine.estimateDamage(a,b,move,{battleState:f});a.passiveAbility=null;assert(high>engine.estimateDamage(a,b,move,{battleState:f}));b.passiveAbility='Fluffy';assert(engine.estimateDamage(a,b,move,{battleState:f})<high*.6);
});
test('Pare-Effet blocks Spiky Shield and Pickpocket, not Cursed Body or move recoil',()=>{
 const a=mon(68,'protective_pads'),b=mon(),s=engine.createBattleState();cast(b,a,'Spiky Shield',s,true);cast(a,b,'Pound',s);assert.equal(a.currentHp,400);
 const q=mon(215);q.passiveAbility='Pickpocket';cast(a,q,'Pound');assert.equal(a.heldItem,'protective_pads');assert(!q.heldItem);
 const cursed=mon(94);cursed.type1='Normal';cursed.passiveAbility='Cursed Body';fixed(()=>engine.useattack('Pound',a,cursed,{consumePp:false}),.1);assert(a.__battle.disableTurns>0);
 const x=mon(68,'protective_pads');cast(x,mon(),'Double-Edge');assert(x.currentHp<400);
});
test('all 32 additions have post-Hoze 10000 offers, unique equipment loot, mirrored texts and distinct colored art',async()=>{
 const legacyItems=newItems.filter(i=>!i.abilityPlate);assert.equal(legacyItems.length,32);assert.equal(new Set(newItems.filter(i=>i.boost_type).map(i=>i.boost_type)).size,18);const shops=require('../server/game/world/shopCatalog'),loot=require('../server/game/items/wildLoot'),client=require('../vue-explorakit/src/data/heldItems.json'),{BAG_ITEM_DESIGNS,BAG_STRATEGY_SHAPES}=await import('../vue-explorakit/src/services/bagItemPresentation.js');
 for(const item of legacyItems){const key=item.key;assert.equal(item.buy_price,10000);assert(item.unique);assert.deepEqual(item.wildLoot,{group:'equipment',weight:1});assert.equal(shops.getShopCatalog({mapName:'tour_etage2'}).find(i=>i.key===key).locked,true);const open=shops.getShopCatalog({mapName:'tour_etage2',flags:{hoze_defeated:'true'}}).find(i=>i.key===key);assert.equal(open.locked,false);assert.equal(open.price,10000);assert.deepEqual(client[key],{name:item.name,description:item.description});assert.equal(BAG_ITEM_DESIGNS[key].kind,key);assert(BAG_STRATEGY_SHAPES[key]);assert(loot.uniqueKeys.includes(key));
  const claimed=new Set(loot.uniqueKeys.filter(k=>k!==key)),draws=[.85,.5];assert.equal(loot.select(claimed,()=>draws.shift()).key,key);claimed.add(key);assert.notEqual(loot.select(claimed,()=>.99).key,key);
 }
});
test('delayed attacks pop Balloon and activate Weakness Policy only when the hit actually lands',()=>{
 for(const item of ['air_balloon','weakness_policy']){const a=mon(65),b=mon(68,item),s=engine.createBattleState();cast(a,b,'Future Sight',s);assert.equal(b.heldItem,item);end(a,b,s);end(a,b,s);assert.equal(b.heldItem,item);fixed(()=>end(a,b,s));assert.equal(b.heldItem,null);if(item==='weakness_policy')assert.equal(b.__battle.statStages.specialAttack,2);outcome.clearBattleTransientState([b]);assert.equal(b.heldItem,item);}
});
test('AI sees publicly announced Balloon, but cannot inspect an unrevealed opposing item',()=>{
 const ai=require('../server/game/battle/humanTrainerAI'),a=mon(),b=mon(25,'air_balloon'),s=engine.createBattleState();assert(!ai.publicPokemon(b).heldItem);assert(engine.applySwitchInEffects(b,s.sides.enemy,s.sides.player,s,a).some(m=>m.includes('flotte')));assert.equal(ai.publicPokemon(b).heldItem,'air_balloon');cast(a,b,'Pound',s);assert(!ai.publicPokemon(b).heldItem);b.heldItem='weakness_policy';assert(!ai.publicPokemon(b).heldItem);
});
test('Fling applies Poison Barb and both Herbs to the recipient, never through its Substitute',()=>{
 for(const [key,clone]of [['poison_barb',false],['white_herb',false],['mental_herb',false],['white_herb',true],['mental_herb',true]]){const a=mon(151,key),b=mon(151);b.__battle.statStages.defense=-2;b.__battle.statStages.speed=2;b.__battle.tauntTurns=3;if(clone)b.__battle.substituteHp=200;const r=cast(a,b,'Fling');assert(r.damage+r.substituteDamage>0);assert(!a.heldItem);if(key==='poison_barb')assert.equal(b.status,'poison');if(key==='white_herb')assert.equal(b.__battle.statStages.defense,clone?-2:0);if(key==='mental_herb')assert.equal(b.__battle.tauntTurns,clone?3:0);assert.equal(b.__battle.statStages.speed,2);}
});
test('a stolen Herb returns to its true owner rather than the temporary holder after consumption',()=>{
 const a=mon(151,'white_herb'),b=mon(68,'leftovers'),s=engine.createBattleState();cast(a,b,'Trick',s);assert.equal(b.heldItem,'white_herb');cast(b,a,'Close Combat',s,true);assert(!b.heldItem);outcome.clearBattleTransientState([a,b]);assert.equal(a.heldItem,'white_herb');assert.equal(b.heldItem,'leftovers');
});
