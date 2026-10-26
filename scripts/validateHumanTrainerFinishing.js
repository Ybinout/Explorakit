// Pure public-state decision sweep, no database or production players.
const assert=require('node:assert/strict'),{performance}=require('node:perf_hooks');
const ai=require('../server/game/battle/humanTrainerAI'),engine=require('../server/game/battle/battleEngine'),factory=require('../server/game/drift/pokemonFactory'),resources=require('../server/game/battle/battleResources');
function mon(id,names,label){const p=factory.create(id,50,true);p.uuid=label;p.passiveAbility=null;p.heldItem=null;p.abilities=names;p.movePp=names.map(resources.getMaxMovePp);p.__battle={statStages:{},sleepTurns:1};return p;}
let decisions=0,immuneChoices=0,maxSwitchProbability=0,totalMs=0,maxMs=0;const examples=[];
for(const id of [51,112,232,445])for(const hp of [10,40,80])for(const ownSpeed of [70,130,250])for(const trick of [0,3])for(const habits of [0,10]){
 const a=mon(26,['Thunderbolt','Surf'],`npc:${id}:${hp}:${ownSpeed}:${trick}:${habits}`),b=mon(id,['Earthquake'],'player'),reserve=mon(130,['Tackle'],'reserve');a.currentHp=hp;a.currentSpeed=ownSpeed;
 const field=engine.createBattleState();field.field.trickRoomTurns=trick;
 const o={team:[a],opponentTeam:[b,reserve],field,ownSide:field.sides.enemy,enemySide:field.sides.player,memory:{habits:{turns:10,switches:habits,moves:{}}},round:1,skill:1};
 const visible=ai.publicPokemon(b),eq=engine.getMoveByName('Earthquake'),surf=engine.getMoveByName('Surf');
 const incoming=engine.estimateDamage(visible,a,eq,{battleState:field,defenderSide:o.ownSide}),outgoing=engine.estimateDamage(a,visible,surf,{battleState:field,defenderSide:o.enemySide});
 const first=engine.orderBattleActions([{pokemon:a,moveName:'Surf',side:o.ownSide},{pokemon:visible,moveName:'Earthquake',side:o.enemySide}],field,()=>.5)[0].pokemon===a;
 if(incoming<a.currentHp || first&&outgoing>=b.currentHp)continue;
 const before=JSON.stringify(o),start=performance.now(),analysis=ai.analyse(o),chosen=ai.chooseAction(o),ms=performance.now()-start;totalMs+=ms;maxMs=Math.max(maxMs,ms);decisions++;
 const switched=analysis.predictions.filter(s=>s.action==='change').reduce((n,s)=>n+s.probability,0);maxSwitchProbability=Math.max(maxSwitchProbability,switched);
 const immune=chosen.action==='attack'&&chosen.number===0;if(immune)immuneChoices++;
 if(examples.length<4)examples.push({id,hp,ownSpeed,trick,habits,chosen:chosen.action==='attack'?a.abilities[chosen.number]:chosen.action,switchProbability:switched});
 assert.equal(JSON.stringify(o),before,'Analysis mutated a live state');
}
assert(decisions>60);
const result={decisions,immuneChoices,maxSwitchProbability,averageAnalysisAndChoiceMs:totalMs/decisions,maxAnalysisAndChoiceMs:maxMs,examples};console.log(JSON.stringify(result));
if(!process.env.ALLOW_BASELINE_FAILURE){assert.equal(immuneChoices,0,'A current-target immunity must not beat an effective response under credible finishing pressure');assert(maxSwitchProbability<.04);}
