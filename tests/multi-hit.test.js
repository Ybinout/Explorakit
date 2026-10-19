const test=require('node:test'),assert=require('node:assert/strict');
const engine=require('../server/game/battle/battleEngine');
const traits=require('../data/game/ability_move_traits.gen7.json');
const {serializeMoveResult}=require('../server/game/battle/battleEvents');
function mon(ability=null,extra={}) {return Object.assign({uuid:Math.random().toString(),name:'Test',level:50,type1:'Normal',maxHp:10000,currentHp:10000,currentAttack:100,currentDefense:100,currentSpecialAttack:100,currentSpecialDefense:100,currentSpeed:100,status:'normal',passiveAbility:ability,abilities:[],movePp:[],data:{base:{HP:80,Attack:80,Defense:80,'Sp. Attack':80,'Sp. Defense':80,Speed:80}}},extra);}
function random(value,fn){const old=Math.random;Math.random=typeof value==='function'?value:()=>value;try{return fn();}finally{Math.random=old;}}
function attack(name,a=mon(),b=mon()){a.abilities=[name];a.movePp=[engine.getMoveByName(name).pp];return engine.useattack(name,a,b);}
for(const [name,rule]of Object.entries(traits.moves).filter(([,t])=>t.multihit))test(`${name}: real multiple hits, one PP, public count`,()=>random(.7,()=>{
 const a=mon('Skill Link'),b=mon(),r=attack(name,a,b),expected=Array.isArray(rule.multihit)?5:rule.multihit;
 assert.equal(r.hits,expected);assert(r.damage>0);assert.equal(a.movePp[0],engine.getMoveByName(name).pp-1);assert.equal(serializeMoveResult('player',r).hits,expected);
}));
test('2–5 hits use the Gen 7 35/35/15/15 distribution',()=>{
 for(const [roll,hits]of [[0,2],[.349,2],[.35,3],[.699,3],[.7,4],[.849,4],[.85,5],[.999,5]])random(roll,()=>assert.equal(attack('Bullet Seed',mon('No Guard')).hits,hits));
});
test('multi-hit stops on target KO, contact KO and immunity; Sturdy only saves the first hit',()=>random(.8,()=>{
 assert.equal(attack('Double Kick',mon(),mon(null,{currentHp:1})).hits,1);
 assert.equal(attack('Double Slap',mon('Skill Link',{currentHp:1}),mon('Rough Skin')).hits,1);
 const sturdy=mon('Sturdy',{maxHp:2,currentHp:2});assert.equal(attack('Double Kick',mon(),sturdy).hits,2);assert.equal(sturdy.currentHp,0);
 const immune=attack('Double Slap',mon('Skill Link'),mon(null,{type1:'Ghost'}));assert.equal(immune.hits,0);assert.equal(immune.damage,0);assert.equal(immune.effectiveness,0);
}));
test('Triple Kick grows 10/20/30, checks accuracy per hit, Skill Link/No Guard keep their guarantees',()=>{
 random(.8,()=>{const a=mon(),b=mon();const expected=[10,20,30].reduce((sum,power)=>sum+engine.calculateDamage(a,b,{...engine.getMoveByName('Triple Kick'),power}),0);assert.equal(attack('Triple Kick',a,b).damage,expected);});
 const a=mon(),b=mon();let checks=0;random(()=>++checks===3?.99:.8,()=>assert.equal(attack('Triple Kick',a,b).hits,1));
 // Accuracy, critical, accuracy...; the second accuracy roll fails.
 random(.99,()=>assert.equal(attack('Triple Kick',mon('No Guard')).hits,3));
 random(.8,()=>assert.equal(attack('Triple Kick',mon('Skill Link')).hits,3));
});
test('Twineedle retries its secondary on hit two, even after breaking a clone',()=>{
 const a=mon(),b=mon();engine.ensureBattleData(b).substituteHp=1;
 random(.1,()=>{const r=attack('Twineedle',a,b);assert.equal(r.hits,2);assert.equal(b.status,'poison');assert(r.substituteDamage>0);});
 random(.1,()=>{const d=mon('Shield Dust');attack('Twineedle',mon(),d);assert.equal(d.status,'normal');});
});
test('multi-hit recoil is once per move, not once per hit',()=>random(.8,()=>{
 const a=mon('Skill Link',{heldItem:'life_orb'});attack('Bullet Seed',a);assert.equal(a.currentHp,9000);
}));
test('corrected priorities beat speed while switches remain orchestrator-owned',()=>{
 const priorities={'Quick Attack':1,'Extreme Speed':2,'Fake Out':3,'Water Shuriken':1,'Roar':-6,'Counter':-5,'Mat Block':0,'Ion Deluge':1,'Powder':1};
 for(const [name,value]of Object.entries(priorities))assert.equal(engine.getMovePriority(name),value,name);
 const slow=mon(null,{currentSpeed:10}),fast=mon(null,{currentSpeed:999});assert.equal(engine.orderBattleActions([{pokemon:fast,moveName:'Tackle'},{pokemon:slow,moveName:'Quick Attack'}],engine.createBattleState())[0].pokemon,slow);
 for(const [name,kind]of [['Water Shuriken','special'],['Sticky Web','status'],['Venom Drench','status']])assert.equal(engine.getMoveByName(name).combat.damage_class,kind);
});
