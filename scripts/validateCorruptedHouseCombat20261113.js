// Real single-battle engine, legal sets and the normal human AI on both sides.
// No account, database or live player is touched.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {DriftBattle}=require('../server/game/drift/driftBattle'),ai=require('../server/game/battle/humanTrainerAI');
const trainers=require('../server/game/whitepeak/trainers'),sets=require('../server/game/whitepeak/corruptedPracticeSets');
const factory=require('../server/game/drift/pokemonFactory'),replacement=require('../server/game/battle/replacementChoice');
const reports=[];
for(const entry of sets)for(const opponentKey of ['practice_spectral_rush','practice_sand_balance']){
 const seed=entry.key+':'+opponentKey,random=require('../server/game/abilities/abilityDex').createDeterministicRandom(seed);
 const reference=[9,6,3,94,149,212].map(id=>factory.create(id,100,true));
 const a={id:'test-side',equipe:trainers.create(opponentKey,reference,100),drifts:[],equipped:[],items:{},currentmap:'ville5_maison1'};
 const b={npc:true,equipe:trainers.create(entry.key,a.equipe.pokemons,100),drifts:[],equipped:[],items:{}};
 for(const [side,p]of[a,b].entries())p.equipe.pokemons.forEach((p,i)=>{p.uuid=seed+':'+side+':'+i;});
 let clock=10000,animations=0,accepted=0;const memory={},initial=a.equipe.pokemons.map(p=>[p.uuid,p.experience]);
 const battle=new DriftBattle(a,b,{type:'trainer',emit(_p,event){if(event==='battleMoveAnimation')animations++;},now:()=>clock,random,paceMs:0,rules:{rewards:false,report:false,restoreBerries:true,bagAllowed:false}});
 const lead=b.equipe.pokemons[0].data.id,start=performance.now();
 for(let step=0;!battle.finished&&battle.round<=240&&step<1200;step++){
  if(!battle.awaiting){clock+=2000;battle.tick();continue;}
  if(battle.pending.has(a)){clock=battle.deadline+1;battle.tick();continue;}
  let decision;
  const options={opponentTeam:b.equipe.pokemons,field:battle.state,ownSide:battle.sides[0],enemySide:battle.sides[1],memory,round:battle.round};
  if(battle.replacementPhase){const indexes=replacement.replacementIndexes(a.equipe);assert(indexes.length);const choice=ai.chooseReplacement({...options,team:indexes.map(i=>a.equipe.pokemons[i])});decision={action:'change',number:indexes[choice]};}
  else decision=ai.chooseAction({...options,team:a.equipe.pokemons});
  assert(battle.action(a,{...decision,turnId:battle.token}),`${seed}: invalid ${JSON.stringify(decision)}`);accepted++;memory.decisions=(memory.decisions||0)+1;
  for(const p of [...a.equipe.pokemons,...b.equipe.pokemons]){assert(Number.isFinite(p.currentHp)&&p.currentHp>=0&&p.currentHp<=p.maxHp);assert(p.movePp.every(n=>Number.isInteger(n)&&n>=0));}
 }
 const finished=battle.finished;if(!finished)battle.finish(null,'interrupted');
 assert(accepted>3);for(const [uuid,xp]of initial){const p=battle.originals.find(p=>p.uuid===uuid);assert.equal(p.experience,xp,'House must not grant XP');}
 reports.push({team:entry.key,opponent:opponentKey,lead,rounds:battle.round,accepted,finished,animations,ms:Math.round(performance.now()-start)});
 console.log(JSON.stringify(reports.at(-1)));
}
fs.writeFileSync('/tmp/riftmon-combats-20261113-native.json',JSON.stringify({success:true,matches:reports,productionWrites:false},null,2));
