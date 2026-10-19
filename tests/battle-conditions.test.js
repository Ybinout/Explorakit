const test=require('node:test'),assert=require('node:assert/strict');
const mon=(stages={},extra={})=>({uuid:'a',currentHp:30,status:'normal',__battle:{statStages:stages,...extra}});
test('battle badges show actual stages, clamp them and omit neutral values',async()=>{
 const {battleConditions}=await import('../vue-explorakit/src/services/battleConditions.js');
 assert.deepEqual(battleConditions(mon()),[]);
 const badges=battleConditions(mon({speed:2,attack:-1,defense:0,accuracy:-2,specialAttack:99},{confusionTurns:2,substituteHp:15}));
 assert.equal(badges.find(x=>x.key==='speed').text,'VIT +2');assert.match(badges.find(x=>x.key==='speed').title,/×2/);
 assert.equal(badges.find(x=>x.key==='specialAttack').text,'ATQ S +6');assert.match(badges.find(x=>x.key==='accuracy').title,/×0,6/);
 assert(badges.some(x=>x.text==='Clone'));assert(badges.some(x=>x.text==='Confusion'));
});
test('real effect differences distinguish boosts, drops, ailments, cures, shields and charge without switch/replay false positives',async()=>{
 const {battleConditionChanges:diff}=await import('../vue-explorakit/src/services/battleConditions.js');
 const before=mon({attack:6,speed:0}),after=mon({attack:6,speed:-2},{confusionTurns:2,protect:true,substituteHp:10,chargeMove:'Solar Beam'});after.status='paralyze';
 const changes=diff(before,after);
 assert.deepEqual(changes.map(x=>x.kind),['down','status','status','shield','shield','charge']);
 assert(!changes.some(x=>x.key==='attack'));assert.deepEqual(diff(after,structuredClone(after)),[]);
 assert.deepEqual(diff(null,after),[]);assert.deepEqual(diff(before,{...after,uuid:'b'}),[]);assert.deepEqual(diff(before,{...after,currentHp:0}),[]);
 const cured=diff(after,mon());assert(cured.some(x=>x.kind==='cure'));assert(cured.some(x=>x.kind==='break'));assert(cured.some(x=>x.key==='speed'&&x.kind==='up'));
});
test('actual shared engine outputs power the stage indicators, including Contrary and blocked status',async()=>{
 const {battleConditionChanges:diff}=await import('../vue-explorakit/src/services/battleConditions.js');
 const engine=require('../server/game/battle/battleEngine'),factory=require('../server/game/drift/pokemonFactory');
 const p=factory.create(1,20,true);p.passiveAbility='Contrary';engine.ensureBattleData(p);
 const before=structuredClone(p);engine.applyStageChange(p,'speed',-1,[]);
 assert.equal(diff(before,p).find(x=>x.key==='speed').text,'VIT +1');
 p.passiveAbility='Limber';const snapshot=structuredClone(p);engine.applyStatus(p,'paralyze',{},[],{});assert.deepEqual(diff(snapshot,p),[]);
});
