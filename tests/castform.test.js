const test=require('node:test'),assert=require('node:assert/strict');
const factory=require('../server/game/drift/pokemonFactory'),engine=require('../server/game/battle/battleEngine');
const forms=require('../server/game/abilities/abilityForms'),{clearBattleTransientState}=require('../server/game/battle/battleOutcome');
const {encode,decode}=require('../server/game/drift/checkpointCodec');
function mon(id=351){const p=factory.create(id,40,true);p.passiveAbility=id===351?'Forecast':null;p.abilities=['Weather Ball','Rain Dance','Sunny Day','Hail'];p.movePp=[10,5,5,10];return p;}
function setup(weather=null){const a=mon(),b=mon(143),state=engine.createBattleState();b.maxHp=b.currentHp=10000;state.weather={kind:weather,turns:5};enter(a,b,state);return {a,b,state};}
function enter(a,b,state){return engine.applySwitchInEffects(a,state.sides.player,state.sides.enemy,state,b);}
function turn(a,b,name,state){return engine.useattack(name,a,b,{battleState:state,attackerSide:state.sides.player,defenderSide:state.sides.enemy,consumePp:false});}
for(const [weather,sprite,type]of [[null,null,'Normal'],['sun',10013,'Fire'],['rain',10014,'Water'],['hail',10015,'Ice'],['sandstorm',null,'Rock']])test(`Castform entry in ${weather||'clear'}: correct temporary form and Weather Ball type/power`,()=>{
 const {a,b,state}=setup(weather),id=a.data.id,xp=a.experience,stats=[a.attack,a.defense,a.specialAttack,a.specialDefense,a.speed,a.maxHp];
 assert.equal(a.__battle.formSpriteId,sprite);assert.deepEqual(a.__battle.formTypes,sprite?[type]:null);
 const result=turn(a,b,'Weather Ball',state);assert.equal(result.move.type,type);assert.equal(result.move.power,weather?100:50);
 assert.equal(a.data.id,id);assert.equal(a.type1,'Normal');assert.equal(a.experience,xp);assert.deepEqual([a.attack,a.defense,a.specialAttack,a.specialDefense,a.speed,a.maxHp],stats);
 assert.equal(engine.getMoveByName('Weather Ball').type,'Normal');assert.equal(engine.getMoveByName('Weather Ball').power,50);
 assert.equal(engine.battleMoveTypes(a,b,state)[0],type);
});
test('opposing weather moves change Forecast before the next move, not one turn later',()=>{
 const {a,b,state}=setup('rain');
 for(const [name,sprite,type]of [['Sunny Day',10013,'Fire'],['Hail',10015,'Ice'],['Rain Dance',10014,'Water']]){
  const result=turn(b,a,name,state);assert.equal(a.__battle.formSpriteId,sprite);assert.deepEqual(a.__battle.formTypes,[type]);
  assert(result.messages.some(s=>s.includes('Forme')));assert.equal(turn(a,b,'Weather Ball',state).move.type,type);
 }
 const messages=[];forms.syncWeatherForms(a,b,state,messages);assert.deepEqual(messages,[]);
});
test('hail immunity and weather expiration use the up-to-date form in the same round',()=>{
 const {a,b,state}=setup('hail'),hp=a.currentHp;state.weather.turns=1;
 engine.processEndOfRound(a,b,state.sides.player,state.sides.enemy,state);
 assert.equal(a.currentHp,hp);assert.equal(state.weather.kind,null);assert.equal(a.__battle.formSpriteId,null);assert.equal(turn(a,b,'Weather Ball',state).move.power,50);
});
for(const ability of ['Cloud Nine','Air Lock'])test(`${ability} cancels both Forecast and Weather Ball, then restores them on departure or KO`,()=>{
 const {a,b,state}=setup('rain');b.passiveAbility=ability;enter(b,a,state);
 assert.equal(state.weather.kind,'rain');assert.equal(a.__battle.formSpriteId,null);const normal=turn(a,b,'Weather Ball',state);assert.equal(normal.move.type,'Normal');assert.equal(normal.move.power,50);
 b.currentHp=0;forms.syncWeatherForms(a,b,state);assert.equal(a.__battle.formSpriteId,10014);
 b.currentHp=10000;b.passiveAbility=null;enter(b,a,state);assert.equal(a.__battle.formSpriteId,10014);
});
test('Gastro Acid restores the normal form immediately; a borrowed Forecast never transforms another species',()=>{
 const {a,b,state}=setup('rain');turn(b,a,'Gastro Acid',state);assert(a.__battle.abilitySuppressed);assert.equal(a.__battle.formSpriteId,null);assert.equal(a.__battle.formTypes,null);
 const other=mon(25);other.passiveAbility='Forecast';enter(other,b,state);assert.equal(other.type1,'Electric');assert.equal(other.__battle.formSpriteId,null);assert.deepEqual(other.__battle.tempTypes,[]);
});
test('Soak is preserved until a real form change; legacy transient types are migrated once',()=>{
 const {a,b,state}=setup('sun');turn(b,a,'Soak',state);assert.deepEqual(a.__battle.tempTypes,['Water']);
 forms.syncWeatherForms(a,b,state);assert.deepEqual(a.__battle.tempTypes,['Water']);
 turn(b,a,'Hail',state);assert.deepEqual(a.__battle.tempTypes,[]);assert.deepEqual(a.__battle.formTypes,['Ice']);
 const legacy=mon();legacy.__battle={tempTypes:['Water']};enter(legacy,b,state);assert.deepEqual(legacy.__battle.tempTypes,[]);assert.equal(legacy.__battle.formSpriteId,10015);
});
test('forms survive a checkpoint and are removed on exit without changing persistent species, EV or experience',()=>{
 const {a,b,state}=setup('rain'),snapshot={id:a.data.id,ev:{...a.ev},xp:a.experience,hp:a.currentHp};
 const restored=decode(encode({a,b,state}));forms.syncWeatherForms(restored.a,restored.b,restored.state);assert.equal(restored.a.__battle.formSpriteId,10014);
 clearBattleTransientState([restored.a]);assert(!restored.a.__battle);assert.equal(restored.a.data.id,snapshot.id);assert.equal(restored.a.type1,'Normal');assert.deepEqual(restored.a.ev,snapshot.ev);assert.equal(restored.a.experience,snapshot.xp);assert.equal(restored.a.currentHp,snapshot.hp);
});
test('Weather Ball consumes one PP and its weather resolution cannot overwrite Electrify',()=>{
 const {a,b,state}=setup('rain');const before=a.movePp[0];engine.useattack('Weather Ball',a,b,{battleState:state});assert.equal(a.movePp[0],before-1);
 a.__battle.electrified=true;assert.equal(turn(a,b,'Weather Ball',state).move.type,'Electric');
});
