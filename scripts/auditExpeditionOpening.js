// Controlled opening hit sample, not a substitute for full human playthroughs.
const assert=require('node:assert/strict');
const factory=require('../server/game/drift/pokemonFactory'),engine=require('../server/game/battle/battleEngine');
const {tuneWildMoves}=require('../server/game/drift/openingBalance');
const species=require('../data/game/nextMap.json').maps.find(m=>m.mapName==='start').wildpokemon;
function measureOpening(){
 const original=Math.random;Math.random=()=>.5;
 try{const results={};for(const [key,level,tune]of [['before',7,false],['after',5,true]]){
  let pairs=0,oneHitKOs=0,totalFraction=0;const examples=[];
  for(const id of species)for(const starter of factory.STARTERS){let worst=0,moveName='';const template=factory.create(id,level);if(tune)tuneWildMoves(template);
   for(const name of template.abilities){const a=factory.create(id,level),b=factory.create(starter,5,true),state=engine.createBattleState();const move=engine.getMoveByName(name);if(!(move?.power>0))continue;
    a.abilities=[name];a.movePp=[99];const result=engine.useattack(name,a,b,{battleState:state,attackerSide:state.sides.enemy,defenderSide:state.sides.player});
    const fraction=result.damage/b.maxHp;if(fraction>worst){worst=fraction;moveName=name;}
   }
   pairs++;totalFraction+=worst;if(worst>=1){oneHitKOs++;if(examples.length<5)examples.push({wild:id,starter,move:moveName});}
  }results[key]={pairs,oneHitKOs,oneHitKoPercent:Math.round(oneHitKOs/pairs*1000)/10,averageWorstHitPercent:Math.round(totalFraction/pairs*1000)/10,examples};
 }assert(results.after.oneHitKOs<results.before.oneHitKOs);return {scenario:'Village upper level vs all 49 level-5 starters, strongest first move, fixed IV/nature/random roll, no crit; not an encounter probability',...results};
 }finally{Math.random=original;}
}
if(require.main===module)console.log(JSON.stringify(measureOpening()));
module.exports={measureOpening};
