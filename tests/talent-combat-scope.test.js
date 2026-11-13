const test=require('node:test'),assert=require('node:assert/strict');
const fx=require('../server/game/talents/effects'),engine=require('../server/game/battle/battleEngine'),factory=require('../server/game/drift/pokemonFactory');
const bonus={offense:{Water:11},defense:{Water:11},globalDamage:3,globalExperience:10,globalMoney:15,capture:{Water:49}};
const owner={__trainerTalents:bonus};
test('only the explicit wild, raid and Super Tournament scopes enable offense, defense and ultimate',()=>{
 for(const scope of ['wild','raid','tower'])assert(Math.abs(fx.damage(owner,owner,'Water',scope)-1.14*.89)<1e-9);
 for(const scope of [undefined,null,'pvp','pve','trainer','arena','draft','double','house','tournament'])assert.equal(fx.damage(owner,owner,'Water',scope),1);
 assert.equal(fx.damage(null,null,'Water','wild'),1);
 assert.equal(fx.experience(1000,owner),1100);assert.equal(fx.money(1000,'wild',owner),1150);
});
function damage(type,trained=false,scope){
 const p=factory.create(9,100,true),q=factory.create(143,100,true);
 for(const model of [p,q]){model.iv={...model.iv,specialAttack:31,specialDefense:31};model.ev={...model.ev,specialAttack:0,specialDefense:0};model.nature='Hardy';model.recalculateStats();model.passiveAbility='Keen Eye';model.heldItem=null;}
 if(trained)p.__trainerTalents=bonus;
 const state=engine.createBattleState({battleType:type});if(scope)state.talentCombatScope=scope;
 return engine.calculateDamageDetailed(p,q,engine.getMoveByName('Water Pulse'),{battleState:state,preview:true,previewRoll:1,previewCritical:false}).damage;
}
test('singles engine gates the complete branch by authoritative battle kind, including untagged old snapshots',()=>{
 for(const type of ['trainer','arena','pvp',undefined])assert.equal(damage(type,true),damage(type),String(type));
 const baseline=damage('wild'),boosted=damage('wild',true);assert(boosted>baseline);assert(Math.abs(boosted/baseline-1.14)<.04);
 assert(damage('arena',true,'tower')>damage('arena',false,'tower'));
 assert.equal(damage('pvp',true,'tower'),damage('pvp',false,'tower'),'a stale scope cannot promote a PvP battle');
});
test('native doubles retain corruption but ignore owner talents; the raid hook explicitly enables them',()=>{
 const native=require('../server/game/doubles/ruleset');let factor;
 const source={set:{rift:{talents:bonus,combat:{type:'Water',direction:'offense'}}}},target={set:{rift:{talents:bonus,combat:{type:'Water',direction:'defense'}}}};
 const context={chainModify:n=>{factor=n;}};
 native.format.onModifyDamage.call(context,100,source,target,{type:'Water'});
 const corruption=1.2*require('../server/game/corruption/balance').config.defenseMultiplier;assert.equal(factor,corruption);
 native.format.onModifyDamage.call(context,100,source,target,{type:'Water'},'raid');assert(Math.abs(factor-corruption*1.14*.89)<1e-9);
});
test('a fresh Tower battle is eligible while identical arena and House trainer copies are neutral',()=>{
 const {DriftBattle}=require('../server/game/drift/driftBattle');
 for(const tower of [false,true]){
  const a={id:'local',drifts:[],equipped:[],username:'Test',currentmap:'super_tournament_room',equipe:{pokemons:[factory.create(9,100,true)]}},b={id:'npc',drifts:[],equipped:[],username:'Trainer',npc:true,equipe:{pokemons:[factory.create(143,100,true)]}};
  for(const p of [a,b]){p.equipe.pokemons[0].abilities=['Splash'];p.equipe.pokemons[0].heldItem=null;}
  fx.attach(a.equipe,bonus);
  const battle=new DriftBattle(a,b,{type:'arena',emit(){},rules:{report:false,rewards:false,...(tower?{tournamentExperience:true}:{})}});
  assert.equal(battle.state.talentCombatScope,tower?'tower':undefined);
  const move=engine.getMoveByName('Water Pulse'),calc=()=>engine.calculateDamageDetailed(a.equipe.pokemons[0],b.equipe.pokemons[0],move,{battleState:battle.state,preview:true,previewRoll:1,previewCritical:false}).damage;
  const boosted=calc();delete a.equipe.pokemons[0].__trainerTalents;const baseline=calc();assert.equal(boosted>baseline,tower);
 }
});
test('binding a pre-patch Tower save restores its explicit eligibility without changing nodes or profiles',()=>{
 const {TournamentController}=require('../server/game/superTournament/controller'),p={socketId:'old',equipe:{pokemons:[]}},b={rules:{},state:engine.createBattleState({battleType:'arena'})};
 const c=new TournamentController({userId:1,getPlayer:()=>({id:'new'}),emit(){}});c.run={player:p,battle:b};c.bind();
 assert.equal(b.state.talentCombatScope,'tower');assert.equal(b.rules.tournamentExperience,true);assert.equal(p.socketId,'new');
});
