// Ephemeral, read-only checkpoints for presentation. Never stored on a Pokémon
// or battle state, and never used to calculate damage or rewards.
let enabled=0;
function capture(action){enabled++;try{return action();}finally{enabled--;}}
const VOLATILES=['confusionTurns','infatuationTurns','trappedTurns','tauntTurns','disableTurns','disabledMove','encoreTurns','leechSeedSource','curseSource','protect','endure','substituteHp','chargeMove','aquaRing','ingrain','magnetRiseTurns','healBlockTurns'];
function snapshot(p){
 if(!p?.uuid)return null;
 const b=p.__battle||{},conditions={};
 for(const key of VOLATILES)conditions[key]=!b[key]?0:['leechSeedSource','curseSource'].includes(key)?true:typeof b[key]==='number'||typeof b[key]==='boolean'?b[key]:String(b[key]).slice(0,100);
 return {uuid:p.uuid,currentHp:Math.max(0,Number(p.currentHp)||0),maxHp:Math.max(1,Number(p.maxHp)||1),status:p.status||'normal',statStages:{...b.statStages},conditions};
}
function messages(pokemons,field){
 if(!enabled)return [];
 const list=[],read=()=>pokemons.map(snapshot).filter(Boolean),record={before:read(),steps:[]};
 const step=message=>({message:String(message),pokemon:read(),weather:{kind:field?.weather?.kind||null,turns:Math.max(0,Number(field?.weather?.turns)||0)}});
 Object.defineProperty(list,'presentation',{value:record});
 Object.defineProperty(list,'push',{value(...lines){for(const line of lines)if(record.steps.length<96)record.steps.push(step(line));return Array.prototype.push.apply(this,lines);}});
 return list;
}
function append(target,source){
 if(source?.presentation){Array.prototype.push.apply(target,source);target.presentation?.steps.push(...source.presentation.steps.slice(0,96-target.presentation.steps.length));}
 else target.push(...source);
 return target;
}
function project(list,own,enemy,ownIndex=0){
 const record=list?.presentation;if(!record)return [];
 const ownUuid=record.before[ownIndex]?.uuid,enemyUuid=record.before[1-ownIndex]?.uuid;
 const previous=new Map(record.before.map(p=>[p.uuid,JSON.stringify(p)]));
 return record.steps.map(step=>{
  const pokemon=[];
  for(const state of step.pokemon){const key=JSON.stringify(state);if(previous.get(state.uuid)!==key){const side=state.uuid===ownUuid?'player':state.uuid===enemyUuid?'opponent':null;if(side)pokemon.push({...state,side});previous.set(state.uuid,key);}}
  return {message:step.message,pokemon,weather:step.weather,...(step.delayed?{delayed:{...step.delayed,actor:step.delayed.targetUuid===ownUuid?'opponent':'player',result:{...step.delayed.result,actor:step.delayed.targetUuid===ownUuid?'opponent':'player'}}}:{} )};
 });
}
module.exports={capture,messages,append,project,snapshot};
