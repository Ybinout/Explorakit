const test=require('node:test'),assert=require('node:assert/strict');
const engine=require('../server/game/battle/battleEngine'),factory=require('../server/game/drift/pokemonFactory');
function fixture(move='Tackle',mapName='route3'){
 const a=factory.create(143,100,true),b=factory.create(143,100,true);for(const p of[a,b]){p.passiveAbility=null;p.heldItem=null;p.maxHp=p.currentHp=503;}
 a.heldItem='life_orb';a.abilities=[move];a.movePp=[engine.getMoveByName(move).pp];const state=engine.createBattleState({mapName,battleType:'wild'});
 return{a,b,state,cast(rng=.5){const previous=Math.random;Math.random=()=>rng;try{return engine.useattack(move,a,b,{battleState:state,attackerSide:state.sides.player,defenderSide:state.sides.enemy,attackerTeam:[a],defenderTeam:[b]});}finally{Math.random=previous;}}};
}
for(const map of['route3','jungle1','jungle9'])for(const move of['Tackle','Thunderbolt','Bullet Seed','Seismic Toss'])test(`Life Orb ${map}/${move}: one rounded 10% cost after damage, also on the final KO`,()=>{
 const f=fixture(move,map);f.b.currentHp=1;const r=f.cast();assert(r.damage>0);assert.equal(f.a.currentHp,453);assert.equal(f.a.heldItem,'life_orb');assert.equal(r.messages.filter(m=>m.includes('Orbe Vie')).length,1);
});
test('Life Orb: hits on a substitute still cause one recoil for the whole move',()=>{const f=fixture('Bullet Seed');engine.ensureBattleData(f.b).substituteHp=1000;const r=f.cast();assert(r.substituteDamage>0);assert.equal(f.a.currentHp,453);});
for(const effect of['status','miss','protect','immune','absorbed'])test(`Life Orb: no recoil when ${effect} deals no damage`,()=>{
 const f=fixture(effect==='status'?'Swords Dance':effect==='immune'?'Shadow Ball':effect==='absorbed'?'Surf':'Tackle');if(effect==='miss')engine.ensureBattleData(f.a).statStages.accuracy=-6;if(effect==='protect')engine.ensureBattleData(f.b).protect=true;if(effect==='absorbed')f.b.passiveAbility='Water Absorb';const r=f.cast(effect==='miss'?.999:.5);assert.equal(r.damage+r.substituteDamage,0);assert.equal(f.a.currentHp,503);
});
for(const ability of['Magic Guard','Sheer Force'])test(`Life Orb: ${ability} prevents recoil on Thunderbolt, without removing damage`,()=>{const f=fixture('Thunderbolt');f.a.passiveAbility=ability;const r=f.cast();assert(r.damage>0);assert.equal(f.a.currentHp,503);assert.equal(f.a.heldItem,'life_orb');});
test('Life Orb: Sheer Force does not prevent recoil on a move with no secondary effect',()=>{const f=fixture();f.a.passiveAbility='Sheer Force';f.cast();assert.equal(f.a.currentHp,453);});
for(const suppression of['Klutz','Magic Room','Embargo'])test(`Life Orb: ${suppression} suppresses both the boost and its recoil`,()=>{
 const f=fixture();if(suppression==='Klutz')f.a.passiveAbility='Klutz';if(suppression==='Magic Room')f.state.field.magicRoomTurns=3;if(suppression==='Embargo')engine.ensureBattleData(f.a).embargoTurns=3;const withItem=engine.estimateDamage(f.a,f.b,engine.getMoveByName('Tackle'),{battleState:f.state});f.a.heldItem=null;const withoutItem=engine.estimateDamage(f.a,f.b,engine.getMoveByName('Tackle'),{battleState:f.state});assert.equal(withItem,withoutItem);f.a.heldItem='life_orb';f.cast();assert.equal(f.a.currentHp,503);
});
test('Life Orb: 1 remaining HP can faint from recoil; damage preview never spends HP',()=>{const f=fixture();f.a.currentHp=1;engine.estimateDamage(f.a,f.b,engine.getMoveByName('Tackle'),{battleState:f.state});assert.equal(f.a.currentHp,1);f.cast();assert.equal(f.a.currentHp,0);});
for(const actor of['player','enemy'])for(const [move,recoil]of[['Thunderbolt',0],['Ice Beam',0],['Earth Power',0],['Sludge Wave',0],['Superpower',50],['Earthquake',50]])test(`Nidoking Sans Limite ${actor}/${move}: symmetric damage bonus and correct Life Orb exception`,()=>{
 const f=fixture(move);const nidoking=factory.create(34,100,true);Object.assign(nidoking,{heldItem:'life_orb',passiveAbility:'Sheer Force',maxHp:503,currentHp:503,abilities:[move],movePp:[engine.getMoveByName(move).pp]});
 const old=Math.random;Math.random=()=>.5;try{const r=engine.useattack(move,nidoking,f.b,{battleState:f.state,attackerSide:f.state.sides[actor],defenderSide:f.state.sides[actor==='player'?'enemy':'player'],attackerTeam:[nidoking],defenderTeam:[f.b]});assert(r.damage>0);assert.equal(nidoking.currentHp,503-recoil);assert.equal(r.messages.some(m=>m.includes('Orbe Vie')),Boolean(recoil));const boost=engine.estimateDamage(nidoking,f.b,engine.getMoveByName(move),{battleState:f.state});nidoking.heldItem=null;assert(boost>engine.estimateDamage(nidoking,f.b,engine.getMoveByName(move),{battleState:f.state}));}finally{Math.random=old;}
});
