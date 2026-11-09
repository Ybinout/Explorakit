const {randomUUID}=require('node:crypto');
const {getItemDefinition}=require('../battle/battleResources');
function permanent(key){return getItemDefinition(key)?.permanentConsumption===true;}
function record(p,state,key){
 const origin=p.__heldItemOrigin||p;
 state.berryBattleId ||= randomUUID();
 origin.__berrySpent ||= [];
 if(!origin.__berrySpent.some(x=>x.battleId===state.berryBattleId&&x.itemKey===key))origin.__berrySpent=[...origin.__berrySpent,{battleId:state.berryBattleId,pokemonUuid:origin.uuid,itemKey:key}];
 if(Object.hasOwn(origin,'__heldItemBeforeExchange'))origin.__heldItemBeforeExchange=null;
 delete origin.__heldItemConsumedForBattle;delete origin.__heldItemKnockedOff;
}
function statMultiplier(p,stat){const e=p.__battle?.mutationBerry;if(!e)return 1;return(e.bonus.kind==='stat'&&e.bonus.stat===stat?1+e.bonus.amount:1)*(e.penalty?.stat===stat?e.penalty.factor:1);}
function damageMultiplier(a,d,type){const x=a?.__battle?.mutationBerry?.bonus,y=d?.__battle?.mutationBerry?.bonus;return(x?.kind==='offense'&&x.type===type?1+x.amount:1)*(y?.kind==='defense'&&y.type===type?1-y.amount:1);}
function hp(p,max){const old=p.maxHp;p.maxHp=Math.max(1,Math.floor(max));p.currentHp=p.currentHp<=0?0:Math.max(1,Math.min(p.maxHp,Math.floor(p.currentHp*p.maxHp/old)));}
function activate(p,state,{enabled,consume,stage,messages}){
 const item=getItemDefinition(p?.heldItem);if(!item?.mutationBerry||!enabled||p.currentHp<=0)return false;
 const effect=structuredClone(item.mutationBerry);
 p.__battle.mutationBerry=effect;
 const hpFactor=statMultiplier(p,'maxHp');
 if(hpFactor!==1){
  p.__berryBaseMaxHp=p.maxHp;hp(p,p.maxHp*hpFactor);
 }
 consume(p,state,messages);
 messages.push(`${p.truename||p.name} active ${item.name} : ses effets dureront jusqu’à son retrait.`);
 if(effect.entryStage)stage(p,effect.entryStage.stat,effect.entryStage.stages,messages,p);
 return true;
}
function clear(p){if(p.__berryBaseMaxHp){hp(p,p.__berryBaseMaxHp);delete p.__berryBaseMaxHp;}if(p.__battle)delete p.__battle.mutationBerry;}
function savedHp(p){return p.__berryBaseMaxHp? p.currentHp<=0?0:Math.max(1,Math.floor(p.currentHp*p.__berryBaseMaxHp/p.maxHp)):p.currentHp;}
function spent(models){return models.flatMap(p=>p?.__berrySpent||[]);}
module.exports={permanent,record,statMultiplier,damageMultiplier,activate,clear,savedHp,spent};
