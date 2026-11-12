const test=require('node:test'),assert=require('node:assert/strict');
const factory=require('../server/game/drift/pokemonFactory'),modules=require('../server/game/corruption/modules');
const mutation=require('../server/game/corruption/pokemon'),balance=require('../server/game/corruption/balance');
const engine=require('../server/game/battle/battleEngine');
test('all four corruption modules and their previews reject Shedinja without changing it',()=>{
 for(const key of['cmod_move_483','cmod_ability_sturdy','cmod_type_steel','cmod_offense_ghost']){
  const p=factory.create(292,100,true),before=JSON.stringify(p),item=modules.get(key),choice={expectedRevision:0,expectedMoves:[...p.abilities],slot:p.abilities.length};
  assert.throws(()=>mutation.install(p,item,choice),/Munja ne peut pas être corrompu/);
  assert.throws(()=>require('../server/game/corruption/preview').preview(p,item,choice),/Munja ne peut pas être corrompu/);assert.equal(JSON.stringify(p),before);
 }
 assert(balance.restricted(292));assert(balance.restricted({pokemon_id:292}));assert(!factory.legendary.has(292));
 assert(require('../vue-explorakit/src/data/corruptionBalance.json').restrictedSpecies.includes(292));
});
test('corrupted Nincada cannot evolve into Shedinja, including a direct update, but Ninjask remains available',()=>{
 const evolution=require('../server/game/models/evolution'),p=factory.create(290,100,true);
 mutation.install(p,modules.get('cmod_ability_sturdy'),{expectedRevision:0});
 const before=JSON.stringify(p),options=evolution.options(p);assert.equal(options.find(x=>x.targetId===292).ready,false);assert(options.find(x=>x.targetId===292).condition.includes('corruption'));
 assert.throws(()=>evolution.evolve(p,{fromSpeciesId:290,targetId:292}));assert.throws(()=>p.updatePokemon(292),/corrompu/);assert.equal(JSON.stringify(p),before);
 assert.equal(evolution.evolve(p,{fromSpeciesId:290,targetId:291}).to,291);assert(p.corruption.permanent);
 const normal=factory.create(290,100,true);assert.equal(evolution.evolve(normal,{fromSpeciesId:290,targetId:292}).to,292);assert(!normal.corruption);
});
test('Sturdy retains the usual repeated full-HP protection; indirect damage and Mold Breaker still bypass it',()=>{
 const a=factory.create(143,100,true),p=factory.create(95,100,true);p.passiveAbility='Sturdy';p.heldItem=null;
 for(let n=0;n<3;n++){p.currentHp=p.maxHp;engine.applyDamage(p,p.maxHp*10,{attacker:a});assert.equal(p.currentHp,1);}
 p.currentHp=p.maxHp-1;engine.applyDamage(p,p.maxHp*10,{attacker:a});assert.equal(p.currentHp,0);
 p.currentHp=p.maxHp;engine.applyDamage(p,p.maxHp*10,{});assert.equal(p.currentHp,0);
 a.passiveAbility='Mold Breaker';p.currentHp=p.maxHp;engine.applyDamage(p,p.maxHp*10,{attacker:a});assert.equal(p.currentHp,0);
});
for(const mode of['double','raid'])test(`${mode}: Sturdy can activate again after a full heal`,()=>{
 const {Battle}=require('@pkmn/sim'),doubles=require('../server/game/doubles/ruleset');
 const make=id=>{const p=factory.create(id,100,true);p.abilities=['Splash'];p.movePp=[40];p.passiveAbility=id===95?'Sturdy':'Keen Eye';p.heldItem=null;return doubles.teamSet(p);};
 const own=[95,9,25,143].map(make),enemy=[248,9].map(make);let sim;
 if(mode==='raid')sim=require('../server/game/raids/ruleset').create([own,[enemy[0]]],[1,2,3,4]);
 else{sim=new Battle({format:doubles.dex.formats.get('riftmondoubles'),seed:[1,2,3,4]},doubles.dex);doubles.installStats(sim);sim.setPlayer('p1',{name:'Test',team:own});sim.setPlayer('p2',{name:'Adversaire',team:enemy});}
 const p=sim.p1.active[0];for(let n=0;n<3;n++){sim.heal(p.maxhp,p,p,sim.dex.moves.get('recover'));sim.damage(p.maxhp*10,p,sim.p2.active[0],sim.dex.moves.get('shadowball'));assert.equal(p.hp,1);}
});
