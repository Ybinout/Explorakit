const test=require('node:test'),assert=require('node:assert/strict');
const engine=require('../server/game/battle/battleEngine'),resources=require('../server/game/battle/battleResources');
const factory=require('../server/game/drift/pokemonFactory'),{planTurnActions}=require('../server/game/battle/turnActions');
const {DriftBattle}=require('../server/game/drift/driftBattle'),traits=require('../server/game/abilities/abilityReactions').traits.moves;
function mon(moves=['Bite']){const p=factory.create(7,50,true);p.passiveAbility=null;p.heldItem=null;p.abilities=moves;p.movePp=moves.map(resources.getMaxMovePp);p.currentHp=p.maxHp=10000;return p;}
function fixed(value,work){const old=Math.random;Math.random=()=>value;try{return work();}finally{Math.random=old;}}
function cast(name,a,b,s){return engine.useattack(name,a,b,{battleState:s,attackerSide:s.sides.player,defenderSide:s.sides.enemy,attackerTeam:[a],defenderTeam:[b]});}
test('Bite deals Dark physical damage, spends one PP and has a 30% flinch chance (60% with Serene Grace)',()=>{
 for(const [ability,expected]of [[null,30],['Serene Grace',60]]){
  let count=0;for(let i=0;i<100;i++){const a=mon(),b=mon(['Tackle']),s=engine.createBattleState();a.passiveAbility=ability;
   const r=fixed((i+.5)/100,()=>cast('Bite',a,b,s));assert(r.success&&r.damage>0);assert.equal(a.movePp[0],24);if(b.__battle.flinch)count++;
  }assert.equal(count,expected);
 }
});
for(const name of Object.keys(traits).filter(n=>resources.getMoveDefinition(n)&&traits[n].secondaries?.some(e=>e.volatileStatus==='flinch')))test(`${name}: a successful flinch actually prevents the pending action`,()=>fixed(0,()=>{
 const a=mon([name]),b=mon(['Tackle']),s=engine.createBattleState();if(name==='Snore'){a.status='sleep';engine.ensureBattleData(a).sleepTurns=3;}
 planTurnActions(s,[{pokemon:a,action:'attack',moveName:name},{pokemon:b,action:'attack',moveName:'Tackle'}]);
 let r=cast(name,a,b,s);if(r.phase==='prepare'){s.turn++;planTurnActions(s,[{pokemon:a,action:'attack',moveName:name},{pokemon:b,action:'attack',moveName:'Tackle'}]);r=cast(name,a,b,s);}
 assert(r.damage>0);assert.equal(b.__battle.flinch,true);const hp=a.currentHp,pp=b.movePp[0],reply=cast('Tackle',b,a,s);
 assert.equal(reply.actionPrevented,true);assert.equal(a.currentHp,hp);assert.equal(b.movePp[0],pp);assert.match(reply.messages.join(' '),/apeuré/);
}));
test('Bite cannot flinch an opponent that already acted, never hits through a clone or Protect, and Strong Jaw boosts damage',()=>fixed(.1,()=>{
 const a=mon(),b=mon(['Tackle']),s=engine.createBattleState();planTurnActions(s,[{pokemon:a,action:'attack',moveName:'Bite'},{pokemon:b,action:'attack',moveName:'Tackle'}]);cast('Tackle',b,a,s);cast('Bite',a,b,s);assert(!b.__battle.flinch);
 for(const defense of ['clone','protect']){const p=mon(),q=mon(),state=engine.createBattleState();engine.ensureBattleData(q)[defense==='clone'?'substituteHp':'protect']=defense==='clone'?2000:true;const hp=q.currentHp;cast('Bite',p,q,state);assert.equal(q.currentHp,hp);assert(!q.__battle.flinch);}
 const p=mon(),q=mon(),state=engine.createBattleState(),normal=cast('Bite',p,q,state).damage;p.passiveAbility='Strong Jaw';const boosted=cast('Bite',p,q,state).damage;assert(boosted>normal*1.45&&boosted<normal*1.55);
}));
for(const [source,target,reason]of [['Sheer Force',null,/Sans Limite/],[null,'Shield Dust',/Écran Poudre/],[null,'Inner Focus',/Attention/]])test(`Bite explains why ${source||target} prevents flinching without preventing damage`,()=>fixed(0,()=>{
 const a=mon(),b=mon(),s=engine.createBattleState();a.passiveAbility=source;b.passiveAbility=target;const r=cast('Bite',a,b,s);assert(r.damage>0);assert(!b.__battle.flinch);assert.match(r.messages.join(' '),reason);
}));
for(const name of ['Feint','Hyperspace Hole','Phantom Force','Shadow Force'])for(const protection of ['protect','quickGuardTurns','matBlockTurns','wideGuardTurns','craftyShieldTurns'])test(`${name} breaks ${protection}, retaining Endure and a substitute when appropriate`,()=>fixed(.5,()=>{
 const a=mon([name]),b=mon(),s=engine.createBattleState();if(engine.getMoveByName(name).combat.power_type==='charge'){cast(name,a,b,s);s.turn++;}
 const d=engine.ensureBattleData(b);if(protection==='protect')d.protect=true;else s.sides.enemy.protectTeam[protection]=1;d.endure=true;d.substituteHp=1000;
 const r=cast(name,a,b,s);assert(!r.blocked);assert(r.damage+r.substituteDamage>0);assert.equal(d.protect,false);assert(Object.values(s.sides.enemy.protectTeam).every(v=>v===0));assert.equal(d.endure,true);
 if(name==='Hyperspace Hole'){assert(r.damage>0);assert.equal(d.substituteHp,1000);}else assert(r.substituteDamage>0);
}));
for(const mode of ['rift','colosseum'])test(`${mode}: Bite's flinch is respected by the real two-player queue, then cleared next round`,()=>fixed(0,()=>{
 const player=(id,moves)=>({userId:id,socketId:'p'+id,run:{mode},currentmap:'route1',equipe:{pokemons:[mon(moves)]},items:{},money:0,drifts:[],equipped:[],defeated:new Set()});
 const a=player(1,['Bite','Splash']),b=player(2,['Tackle']),events=[];a.equipe.pokemons[0].currentSpeed=999;b.equipe.pokemons[0].currentSpeed=1;
 const battle=new DriftBattle(a,b,{type:'pvp',paceMs:0,random:()=>0,emit:(p,event,data)=>{if(p===a)events.push({event,data});}});
 battle.action(a,{action:'attack',number:0,turnId:battle.token});battle.action(b,{action:'attack',number:0,turnId:battle.token});
 assert.equal(a.equipe.pokemons[0].currentHp,10000);assert.equal(b.equipe.pokemons[0].movePp[0],35);assert(events.some(e=>e.event==='battleText'&&/apeuré/.test(e.data.message)));
 battle.tick();battle.action(a,{action:'attack',number:1,turnId:battle.token});battle.action(b,{action:'attack',number:0,turnId:battle.token});assert(a.equipe.pokemons[0].currentHp<10000);assert.equal(b.equipe.pokemons[0].movePp[0],34);battle.finish(null,'fled');
}));
test('failed protection breakers leave guards intact on a miss, immunity or inability to act',()=>{
 for(const prevention of ['miss','immune','sleep','ability']){
  const a=mon(['Feint']),b=mon(),s=engine.createBattleState(),d=engine.ensureBattleData(b);d.protect=true;s.sides.enemy.protectTeam.quickGuardTurns=1;
  if(prevention==='miss')engine.ensureBattleData(a).statStages.accuracy=-6;
  if(prevention==='immune')b.type1='Ghost';
  if(prevention==='ability')b.passiveAbility='Wonder Guard';
  if(prevention==='sleep'){a.status='sleep';engine.ensureBattleData(a).sleepTurns=3;}
  const hp=b.currentHp;fixed(prevention==='miss'?.99:.5,()=>cast('Feint',a,b,s));assert.equal(b.currentHp,hp);assert.equal(d.protect,true);assert.equal(s.sides.enemy.protectTeam.quickGuardTurns,1);
 }
});
