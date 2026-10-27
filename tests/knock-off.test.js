const test=require('node:test'),assert=require('node:assert/strict');
const engine=require('../server/game/battle/battleEngine'),factory=require('../server/game/drift/pokemonFactory');
const {clearBattleTransientState,recoverLostKnockedOffItems}=require('../server/game/battle/battleOutcome');
const {DriftBattle}=require('../server/game/drift/driftBattle'),codec=require('../server/game/drift/checkpointCodec');
function mon(id=197,moves=['Knock Off']){const p=factory.create(id,50,true);p.passiveAbility=null;p.abilities=moves;p.movePp=moves.map(require('../server/game/battle/battleResources').getMaxMovePp);p.maxHp=p.currentHp=5000;return p;}
function fixed(fn){const random=Math.random;Math.random=()=>.5;try{return fn();}finally{Math.random=random;}}
function strike(a,b,field=engine.createBattleState()){return fixed(()=>engine.useattack('Knock Off',a,b,{battleState:field}));}
test('Knock Off removes the active item, disables its effects, boosts the first hit only and restores it at battle end',()=>{
 const a=mon(),b=mon(143,['Splash']);b.heldItem='leftovers';const first=strike(a,b);assert(first.damage>0);assert.equal(b.heldItem,null);assert.equal(b.__heldItemKnockedOff,'leftovers');assert(first.messages.some(m=>m.includes('Sabotage fait tomber Restes')));
 const second=strike(a,b);assert(first.damage>second.damage*1.4&&first.damage<second.damage*1.6);assert(!second.messages.some(m=>m.includes('fait tomber')));
 clearBattleTransientState([b]);assert.equal(b.heldItem,'leftovers');assert(!Object.hasOwn(b,'__heldItemKnockedOff'));assert(!Object.hasOwn(b,'__heldItemBeforeExchange'));
});
for(const prevention of['protect','miss','immune','substitute'])test(`Knock Off ${prevention}: item retained, including a broken substitute`,()=>{
 const a=mon(),b=mon(143,['Splash']);b.heldItem='leftovers';const field=engine.createBattleState();
 if(prevention==='protect')engine.ensureBattleData(b).protect=true;
 if(prevention==='immune')b.passiveAbility='Wonder Guard';
 if(prevention==='substitute')engine.ensureBattleData(b).substituteHp=1;
 let result;if(prevention==='miss'){engine.ensureBattleData(a).statStages.accuracy=-6;const random=Math.random;Math.random=()=>.99;try{result=engine.useattack('Knock Off',a,b,{battleState:field});}finally{Math.random=random;}}else result=strike(a,b,field);
 assert.equal(result.damage,0);assert.equal(b.heldItem,'leftovers');assert(!Object.hasOwn(b,'__heldItemKnockedOff'));
});
test('Sticky Hold prevents removal while alive; Mold Breaker and a KO permit it; protected talisman stays protected',()=>{
 for(const kind of['sticky','mold','ko','talisman']){const a=mon(),b=mon(143,['Splash']);b.heldItem=kind==='talisman'?'rift_talisman':'leftovers';b.passiveAbility='Sticky Hold';if(kind==='mold')a.passiveAbility='Mold Breaker';if(kind==='ko')b.currentHp=1;
  strike(a,b);assert.equal(b.heldItem,['sticky','talisman'].includes(kind)?kind==='talisman'?'rift_talisman':'leftovers':null);
 }
});
test('Unburden activates immediately and a knocked berry cannot be Recycled during battle',()=>{
 const a=mon(),b=mon(143,['Recycle']);b.passiveAbility='Unburden';b.heldItem='oran_berry';const field=engine.createBattleState(),before=engine.getBattleSpeed(b,field.sides.enemy,field);strike(a,b,field);assert.equal(engine.getBattleSpeed(b,field.sides.enemy,field),before*2);
 fixed(()=>engine.useattack('Recycle',b,a,{battleState:field}));assert.equal(b.heldItem,null);clearBattleTransientState([b]);assert.equal(b.heldItem,'oran_berry');
});
test('a berry or Focus Sash actually consumed by the hit is not refunded as a knocked item',()=>{
 for(const key of['oran_berry','focus_sash']){const a=mon(),b=mon(143,['Splash']);b.heldItem=key;if(key==='oran_berry')b.currentHp=1000;else{a.currentAttack=99999;b.currentHp=b.maxHp;}
  strike(a,b);assert.equal(b.heldItem,null);assert(!Object.hasOwn(b,'__heldItemKnockedOff'));clearBattleTransientState([b]);assert.equal(b.heldItem,null);
 }
});
test('Trick ownership: the original player recovers its item, including in the bag after permanent loss',()=>{
 const a=mon(197,['Trick','Knock Off']),b=mon(143,['Splash']);a.heldItem='leftovers';b.heldItem='life_orb';const field=engine.createBattleState();fixed(()=>engine.useattack('Trick',a,b,{battleState:field}));assert.equal(b.heldItem,'leftovers');
 strike(a,b,field);assert.equal(b.heldItem,null);assert.equal(a.__heldItemKnockedOff,'leftovers');
 const player={items:{},equipe:{pokemons:[]}};assert.deepEqual(recoverLostKnockedOffItems(player,[a]),['leftovers']);assert.deepEqual(recoverLostKnockedOffItems(player,[a]),[]);assert.equal(player.items.leftovers,1);
 clearBattleTransientState([a,b]);assert.equal(b.heldItem,'life_orb');
});
test('damage estimates remain read-only and include the held-item power bonus',()=>{
 const a=mon(),b=mon(143,['Splash']);b.heldItem='leftovers';const before=JSON.stringify([a,b]),move=engine.getMoveByName('Knock Off');const boosted=engine.estimateDamage(a,b,move);assert.equal(JSON.stringify([a,b]),before);b.heldItem=null;assert(boosted>engine.estimateDamage(a,b,move));
});
function fixture(mode,type='wild'){
 const a={userId:1,socketId:'owner',alive:true,currentmap:'route1',run:{mode,phase:'exploration'},equipe:{pokemons:[mon(143,['Splash'])]},money:1000,items:{},drifts:[],equipped:[],defeated:new Set()};a.equipe.pokemons[0].heldItem='leftovers';
 const b={npc:true,equipe:{pokemons:[mon()]},drifts:[],equipped:[]},events=[];
 const battle=new DriftBattle(a,b,{type,emit:(_p,event,data)=>events.push({event,data}),random:()=>.5,paceMs:0});return{a,b,battle,events};
}
for(const mode of['rift','colosseum'])for(const ending of['fled','timer','finished'])test(`${mode} ${ending}: a surviving player's item is re-equipped, never duplicated in the bag`,()=>{
 const {a,b,battle}=fixture(mode);fixed(()=>battle.action(a,{action:'attack',number:0,turnId:battle.token}));assert.equal(a.equipe.pokemons[0].heldItem,null);battle.finish(ending==='finished'?a:null,ending);assert.equal(a.equipe.pokemons[0].heldItem,'leftovers');assert(!a.items.leftovers);assert(!b.equipe.pokemons[0]?.heldItem);
});
for(const mode of['rift','colosseum'])test(`${mode}: Knock Off KO returns exactly one item to the bag even though the Pokémon is permanently removed`,()=>{
 const {a,battle,events}=fixture(mode);a.equipe.pokemons[0].currentHp=1;fixed(()=>battle.action(a,{action:'attack',number:0,turnId:battle.token}));assert(battle.finished);assert.equal(a.equipe.pokemons.length,0);assert.equal(a.items.leftovers,1);battle.finish(null,'finished');assert.equal(a.items.leftovers,1);assert(events.some(e=>e.event==='bagUpdated'&&e.data.items.some(i=>i.key==='leftovers'&&i.quantity===1)));
});
test('checkpoint mid-battle preserves the temporary removal and restores once after resume',()=>{
 const {a,battle}=fixture('colosseum');fixed(()=>battle.action(a,{action:'attack',number:0,turnId:battle.token}));const restored=codec.decode(codec.encode(battle));restored.emit=()=>{};assert.equal(restored.a.equipe.pokemons[0].heldItem,null);restored.finish(null,'closed');assert.equal(restored.a.equipe.pokemons[0].heldItem,'leftovers');assert(!restored.a.items.leftovers);
});
test('Rift PvP restores both owners on forfeit without transferring the removed item to the attacker',()=>{
 const player=(id,move,item)=>({userId:id,socketId:'p'+id,alive:true,currentmap:'route1',run:{mode:'rift',phase:'exploration'},equipe:{pokemons:[mon(143,[move])]},money:1000,items:{},drifts:[],equipped:[],defeated:new Set()});
 const a=player(1,'Knock Off'),b=player(2,'Splash');a.equipe.pokemons[0].heldItem='leftovers';b.equipe.pokemons[0].heldItem='life_orb';
 const battle=new DriftBattle(a,b,{type:'pvp',emit(){},random:()=>.5,paceMs:0});fixed(()=>{battle.action(a,{action:'attack',number:0,turnId:battle.token});battle.action(b,{action:'attack',number:0,turnId:battle.token});});assert.equal(b.equipe.pokemons[0].heldItem,null);assert(!JSON.stringify(b.equipe.pokemons[0]).includes('__heldItemBeforeExchange'));
 battle.finish(a,'forfeit');assert.equal(a.equipe.pokemons[0].heldItem,'leftovers');assert.equal(b.equipe.pokemons[0].heldItem,'life_orb');assert(!a.items.life_orb&&!b.items.life_orb);
});
