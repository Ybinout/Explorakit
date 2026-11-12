const test=require('node:test'),assert=require('node:assert/strict');
test('Blaziken can really learn CS Drain Punch with full PP, without granting it to Torchic or Combusken',()=>{
 const {machines,teachMachine}=require('../server/game/items/machines');
 const client=require('../vue-explorakit/src/data/machines.json');
 const p=require('../server/game/drift/pokemonFactory').create(257,100,true);p.abilities=['Blaze Kick'];p.movePp=[2];
 assert(machines.cs_drain_punch.species.includes(257));assert(!machines.cs_drain_punch.species.includes(255));assert(!machines.cs_drain_punch.species.includes(256));
 assert.deepEqual(client.cs_drain_punch,machines.cs_drain_punch);
 const result=teachMachine(p,'cs_drain_punch',{slot:1,expectedMoves:p.abilities});
 assert.deepEqual(result.abilities,['Blaze Kick','Drain Punch']);assert.deepEqual(result.movePp,[2,10]);assert(!p.corruption);
});
test('No Guard cannot be acquired by either pill; native owners and legacy module identities are kept',()=>{
 const policy=require('../server/game/abilities/pillAbilityPolicy'),capsule=require('../server/game/items/abilityCapsule');
 const factory=require('../server/game/drift/pokemonFactory'),modules=require('../server/game/corruption/modules');
 assert(!policy.isPillAbilityAllowed('No Guard'));assert(!policy.isCorruptionPillAbilityAllowed('No Guard'));
 for(const id of[66,67,68,622,623]){
  const p=factory.create(id,100,true);p.passiveAbility=id<100?'Guts':'Iron Fist';assert(!capsule.alternatives(p).includes('No Guard'));
 }
 assert(modules.get('cmod_ability_noguard'));
 const view=require('../vue-explorakit/src/data/corruptionAbilityPools.json');
 for(const[type,pool]of Object.entries(modules.pools)){
  assert(!pool.ability.includes('cmod_ability_noguard'));assert(!view[type].some(a=>a.ability==='No Guard'));
 }
});
