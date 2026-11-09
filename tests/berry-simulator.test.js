const test=require('node:test'),assert=require('node:assert/strict');
const {make}=require('../scripts/calibrateCorruptionRaids');
const {DoublesBattle}=require('../server/game/doubles/doublesBattle');
const {RaidBattle}=require('../server/game/raids/RaidBattle');
const berries=require('../data/game/items.json').items.filter(i=>i.mutationBerry);
function p(item=null){const x=make(9,100,4,['Splash'],'Keen Eye');x.heldItem=item;return x;}
function double(item){const players=[[p(item),p(),p()],[p(),p(),p()]].map((pokemons,id)=>({id,username:'Test'+id,equipe:{pokemons}}));const b=new DoublesBattle(...players,{emit(){}});return{b,players,lead:b.sim.sides[0].active[0]};}
test('all 126 berries work in the real doubles simulator with native stat and HP effects',()=>{
 for(const item of berries){const{b,players,lead}=double(item.key);assert.equal(lead.item,'',item.key);assert(lead.volatiles.riftmutation?.berry,item.key);assert.equal(lead.lastItem,'');assert.equal(lead.m.berrySpent.length,1);assert.equal(players[0].equipe.pokemons[0].heldItem,null);
  const effect=item.mutationBerry,base=p().maxHp;
  if(effect.bonus.kind==='stat'&&effect.bonus.stat==='maxHp')assert.equal(lead.maxhp,Math.floor(base*(1+effect.bonus.amount)));
  if(effect.penalty?.stat==='maxHp')assert.equal(lead.maxhp,Math.floor(base*effect.penalty.factor));
  if(effect.entryStage)assert.equal(lead.boosts[({attack:'atk',defense:'def',specialAttack:'spa',specialDefense:'spd',speed:'spe'})[effect.entryStage.stat]],1);
  require('../server/game/doubles/ruleset').format.onSwitchOut.call(b.sim,lead);assert.equal(lead.maxhp,base);assert.equal(lead.volatiles.riftmutation,undefined);
 }
});
test('raid allies consume mutations; checkpoint restoration does not eat another berry or lose effects',()=>{
 const models=[p('mutant_stat_maxhp_legendary_berry'),p('mutant_offense_water_common_berry'),p(),p()].map(pokemon=>({pokemon,ownerId:1,ownerName:'Test'}));
 const b=new RaidBattle(models,p(),{seed:[1,2,3,4],now:()=>1000});b.applyModels();
 assert.equal(models[0].pokemon.heldItem,null);assert.equal(models[0].pokemon.__berrySpent.length,1);assert.equal(models[1].pokemon.heldItem,null);
 const snapshot=b.snapshot(),restored=RaidBattle.restore(require('../server/game/drift/checkpointCodec').decode(require('../server/game/drift/checkpointCodec').encode(snapshot)),()=>2000);restored.applyModels();
 const sim=restored.sim.sides[0].pokemon[0];assert(sim.volatiles.riftmutation);assert.equal(sim.m.berrySpent.length,1);assert.equal(restored.models[0].pokemon.heldItem,null);
 assert.equal(restored.models[0].pokemon.__berrySpent[0].battleId,models[0].pokemon.__berrySpent[0].battleId);
});
test('berry item compatibility does not disable mutated berries on corrupted Pokémon',()=>{
 const x=p('mutant_stat_attack_common_berry');x.corruption={version:1,revision:1,permanent:true,modules:{}};
 const players=[[x,p()],[p(),p()]].map((pokemons,id)=>({id,username:'Test'+id,equipe:{pokemons}}));const b=new DoublesBattle(...players,{emit(){}});assert.equal(b.sim.sides[0].active[0].item,'');assert(b.sim.sides[0].active[0].volatiles.riftmutation);
});
test('typed offensive and defensive mutations modify actual simulator damage for all eighteen types',()=>{
 const dex=require('../server/game/doubles/ruleset').dex,types=require('../data/game/berryMutation.json').families.filter(f=>f.bonus.kind==='offense').map(f=>f.bonus.type);
 const damage=(fixture,type)=>{const sim=fixture.b.sim;sim.prng.setSeed('1,2,3,4');const move=dex.getActiveMove({...dex.moves.get('tackle'),type,basePower:80,willCrit:false});return sim.actions.getDamage(sim.p2.active[0],sim.p1.active[0],move);};
 for(const type of types){const normal=double(null),defense=double('mutant_defense_'+type.toLowerCase()+'_common_berry');const a=damage(normal,type),b=damage(defense,type);assert(Math.abs(b-a*.9)<=2,type+' defensive damage');
  const attack=double('mutant_offense_'+type.toLowerCase()+'_common_berry'),sim=attack.b.sim,base=normal.b.sim;const hit=s=>{s.prng.setSeed('1,2,3,4');return s.actions.getDamage(s.p1.active[0],s.p2.active[0],dex.getActiveMove({...dex.moves.get('tackle'),type,basePower:80,willCrit:false}));};const c=hit(base),d=hit(sim);assert(Math.abs(d-c*1.1)<=2,type+' offensive damage');
 }
});
