const test=require('node:test'),assert=require('node:assert/strict');
test('move families distinguish contact, ranged, drain and ground effects with safe generic fallbacks',async()=>{
 const {moveVisual}=await import('../vue-explorakit/src/services/moveVisuals.js');
 for(const [name,family] of [['Crunch','bite'],['Fire Fang','bite'],['Shadow Claw','claw'],['Mach Punch','punch'],['Body Slam','charge'],['Ice Beam','beam'],['Water Gun','beam'],['Shadow Ball','projectile'],['Bullet Seed','projectile'],['Drain Punch','drain'],['Giga Drain','drain'],['Earthquake','zone'],['Surf','zone']])assert.equal(moveVisual({moveName:name}).family,family,name);
 assert.equal(moveVisual({moveName:'Solar Beam',phase:'prepare',damageClass:'special'}).family,'status');
 assert.equal(moveVisual({moveName:'Solar Beam',phase:'strike',damageClass:'special'}).family,'beam');
 for(const [damageClass,family] of [['physical','charge'],['special','projectile'],['status','status']])assert.equal(moveVisual({moveName:'Unknown',damageClass}).family,family);
});
test('shields and clones use authoritative state and never survive a KO; failures do not connect',async()=>{
 const {persistentMoveVisuals,moveConnected}=await import('../vue-explorakit/src/services/moveVisuals.js');
 assert.deepEqual(persistentMoveVisuals({uuid:'a',currentHp:20,__battle:{protect:true,substituteHp:8}}),{shield:true,clone:true});
 for(const p of [null,{uuid:'b',currentHp:20},{uuid:'a',currentHp:0,__battle:{protect:true,substituteHp:8}}])assert.deepEqual(persistentMoveVisuals(p),{shield:false,clone:false});
 for(const result of [{success:false},{missed:true},{blocked:true},{immune:true},{effectiveness:0}])assert.equal(moveConnected(result),false);
 assert.equal(moveConnected({damage:10,effectiveness:1}),true);
});
