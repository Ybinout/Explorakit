const catalog=require('../../../data/game/items.json').items;
const Pokemon=require('../models/Pokemon');
const {medicineResult}=require('./medicineEffects');
const {randomInt}=require('node:crypto');
const STATS=['hp','attack','defense','specialAttack','specialDefense','speed'];
const secureRandom=()=>randomInt(0,0x100000000)/0x100000000;
function normalize(payload={}) {
 if(typeof payload.pokemonUuid!=='string'||payload.pokemonUuid.length>80||!payload.pokemonUuid)throw Error('Choisis un Pokémon de ton équipe.');
 if(payload.kind==='iv'){
  if(!STATS.includes(payload.stat)||!Number.isInteger(payload.target)||payload.target<0||payload.target>31)throw Error('Choisis une statistique et un IV entre 0 et 31.');
  return {kind:'iv',pokemonUuid:payload.pokemonUuid,stat:payload.stat,target:payload.target,itemKey:catalog.find(i=>i.fieldUse?.ivReroll===payload.stat).key};
 }
 if(payload.kind==='nature'&&Pokemon.natureNames.includes(payload.target))return {kind:'nature',pokemonUuid:payload.pokemonUuid,target:payload.target,itemKey:catalog.find(i=>i.fieldUse?.natureReroll).key};
 throw Error('Objectif de relance invalide.');
}
function value(pokemon,goal){return goal.kind==='iv'?pokemon.iv[goal.stat]:pokemon.nature;}
function reached(pokemon,goal){return value(pokemon,goal)===goal.target;}
function batch(pokemon,goal,stock,{limit=5,random=secureRandom}={}){
 if(!pokemon||pokemon.isEgg||pokemon.currentHp<=0)throw Error('Choisis un Pokémon apte à s’entraîner.');
 if(!Number.isInteger(limit)||limit<1||limit>5)throw Error('Lot de relances invalide.');
 if(!Number.isInteger(stock)||stock<0)throw Error('Stock invalide.');
 const current=Object.assign(Object.create(Object.getPrototypeOf(pokemon)),pokemon),before=value(current,goal);let consumed=0,result=null;
 while(consumed<Math.min(stock,limit)&&!reached(current,goal)){
  result=medicineResult(current,goal.itemKey,random);Object.assign(current,result);consumed++;
 }
 return {result,consumed,before,after:value(current,goal),reached:reached(current,goal),remaining:stock-consumed};
}
module.exports={normalize,value,reached,batch,STATS};
