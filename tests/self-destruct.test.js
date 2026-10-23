const test=require('node:test'),assert=require('node:assert/strict');
const engine=require('../server/game/battle/battleEngine');
const factory=require('../server/game/drift/pokemonFactory');
function fixture(move){
 const a=factory.create(100,30,true),d=factory.create(7,30,true);
 for(const p of [a,d]){p.passiveAbility=null;p.heldItem=null;p.currentHp=p.maxHp=500;}
 a.abilities=[move];a.movePp=[5];
 const state=engine.createBattleState();
 return {a,d,state,run:(random=.5)=>{const old=Math.random;Math.random=()=>random;try{return engine.useattack(move,a,d,{battleState:state,attackerTeam:[a],defenderTeam:[d]});}finally{Math.random=old;}}};
}
for(const move of ['Self-Destruct','Explosion']){
 test(`${move}: damage, PP and unavoidable sacrifice even with survival items/abilities`,()=>{
  for(const ability of [null,'Sturdy','Magic Guard','Rock Head'])for(const item of [null,'focus_sash','shell_bell']){
   const {a,d,run}=fixture(move);a.passiveAbility=ability;a.heldItem=item;engine.ensureBattleData(a).endure=true;engine.ensureBattleData(a).substituteHp=100;
   const r=run();assert(r.damage>0);assert.equal(d.currentHp,500-r.damage);assert.equal(a.currentHp,0);assert.equal(a.movePp[0],4);assert.equal(a.heldItem,item);
   assert.equal(r.messages.filter(m=>m.includes('se met K.O.')).length,1);assert(!r.messages.some(m=>m.includes('Grelot Coque restaure')));
  }
 });
 for(const situation of ['ghost','protect','miss','dig','substitute','wonder_guard'])test(`${move}: sacrifice against ${situation}`,()=>{
  const {a,d,run}=fixture(move);
  if(situation==='ghost'){d.type1='Ghost';d.type2=null;}
  if(situation==='protect')engine.ensureBattleData(d).protect=true;
  if(situation==='miss')engine.ensureBattleData(a).statStages.accuracy=-6;
  if(situation==='dig')Object.assign(engine.ensureBattleData(d),{semiInvulnerable:'underground',chargeMove:'Dig'});
  if(situation==='substitute')engine.ensureBattleData(d).substituteHp=300;
  if(situation==='wonder_guard'){d.passiveAbility='Wonder Guard';}
  const r=run();assert.equal(a.currentHp,0);assert.equal(a.movePp[0],4);assert.equal(d.currentHp,500);
  if(situation==='substitute')assert(r.substituteDamage>0);else assert.equal(r.damage,0);
 });
 test(`${move}: Damp prevents sacrifice even behind Protect or on a miss; suppressed or ignored Damp does not`,()=>{
  for(const side of ['a','d'])for(const defense of ['protect','miss']){
   const f=fixture(move);f[side].passiveAbility='Damp';
   if(defense==='protect')engine.ensureBattleData(f.d).protect=true;else engine.ensureBattleData(f.a).statStages.accuracy=-6;
   const r=f.run();assert(r.abilityBlocked);assert.equal(f.a.currentHp,500);assert.equal(f.d.currentHp,500);assert.equal(f.a.movePp[0],4);assert(r.messages.some(m=>m.includes('Moiteur')));
  }
  for(const bypass of ['suppressed','mold_breaker']){
   const {a,d,run}=fixture(move);d.passiveAbility='Damp';if(bypass==='suppressed')engine.ensureBattleData(d).abilitySuppressed=true;else a.passiveAbility='Mold Breaker';
   assert(run().damage>0);assert.equal(a.currentHp,0);
  }
 });
 test(`${move}: no sacrifice or PP loss when unable to act`,()=>{
  for(const reason of ['sleep','freeze','paralyze','flinch','ko']){
   const {a,d,run}=fixture(move);if(reason==='ko')a.currentHp=0;else if(reason==='flinch')engine.ensureBattleData(a).flinch=true;else a.status=reason;
   if(reason==='sleep')engine.ensureBattleData(a).sleepTurns=3;
   const hp=a.currentHp;run(reason==='paralyze'?0:.5);assert.equal(a.currentHp,hp,reason);assert.equal(d.currentHp,500,reason);assert.equal(a.movePp[0],5,reason);
  }
 });
}

const {DriftBattle}=require('../server/game/drift/driftBattle');
for(const mode of ['rift','colosseum'])test(`${mode}: sacrifice animates a KO, requests replacement and removes the lost Pokémon`,()=>{
 const {a:lead,d:enemy}=fixture('Self-Destruct'),reserve=factory.create(4,30,true),events=[];
 lead.currentSpeed=999;enemy.type1='Ghost';enemy.type2=null;enemy.abilities=['Splash'];enemy.movePp=[40];enemy.currentSpeed=1;
 const a={userId:1,run:{mode},equipe:{pokemons:[lead,reserve]},items:{},money:0,drifts:[],equipped:[],defeated:new Set()};
 const b={npc:true,equipe:{pokemons:[enemy]},drifts:[],equipped:[]};
 const battle=new DriftBattle(a,b,{type:'wild',paceMs:0,random:()=>.5,emit:(_,name,payload)=>events.push({name,payload:JSON.parse(JSON.stringify(payload))})});
 assert(battle.action(a,{action:'attack',number:0,turnId:battle.token}));battle.tick();
 assert.equal(lead.currentHp,0);assert.equal(lead.movePp[0],4);assert(battle.replacementPhase);
 assert(events.some(e=>e.name==='introAnimation'&&e.payload.transitions?.some(t=>t.kind==='faint'&&t.uuid===lead.uuid)));
 assert(battle.action(a,{action:'change',number:1,turnId:battle.token}));assert.equal(battle.active(0),reserve);assert(!a.equipe.pokemons.includes(lead));
 assert.equal(reserve.currentHp,reserve.maxHp);battle.finish(null,'fled');
});
