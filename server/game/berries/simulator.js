// Shared by the existing Doubles and Raid simulators. Nothing is added to classic berries.
const {randomUUID}=require('node:crypto');
const {toID}=require('@pkmn/sim');
const catalog=require('../../../data/game/items.json').items.filter(i=>i.mutationBerry);
const byId=new Map(catalog.map(i=>[toID(i.key),i]));
const stats={attack:'atk',defense:'def',specialAttack:'spa',specialDefense:'spd',speed:'spe'};
function record(p,item,origin=p.m.berryItemOwner||p.set.rift.uuid){p.m.berrySpent ||= [];if(!p.m.berrySpent.some(r=>r.itemKey===item.key&&r.pokemonUuid===origin))p.m.berrySpent.push({battleId:p.battle.berryBattleId,pokemonUuid:origin,itemKey:item.key});}
function multiplier(p,stat){const e=p.volatiles.riftmutation?.berry;if(!e)return 1;return(e.bonus.kind==='stat'&&e.bonus.stat===stat?1+e.bonus.amount:1)*(e.penalty?.stat===stat?e.penalty.factor:1);}
const condition={name:'Rift Mutation',noCopy:true,
 onStart(p,source,effect){const b=effect?.mutationBerry;if(!b)return false;this.effectState.berry=structuredClone(b);this.add('-start',p,'Mutation de baie');if(multiplier(p,'maxHp')!==1){this.effectState.baseMaxhp=p.maxhp;const before=p.maxhp;p.maxhp=Math.floor(before*multiplier(p,'maxHp'));p.hp=Math.max(1,Math.floor(p.hp*p.maxhp/before));}if(b.entryStage)this.boost({[stats[b.entryStage.stat]]:b.entryStage.stages},p,p);},
 onEnd(p){const base=this.effectState.baseMaxhp;if(base){p.hp=p.hp<=0?0:Math.max(1,Math.floor(p.hp*base/p.maxhp));p.maxhp=base;}this.add('-end',p,'Mutation de baie');},
 onModifyDamage(damage,source,target,move){const b=source.volatiles.riftmutation?.berry?.bonus;if(b?.kind==='offense'&&b.type===move.type)return this.chainModify(1+b.amount);},
 onSourceModifyDamage(damage,source,target,move){const b=target.volatiles.riftmutation?.berry?.bonus;if(b?.kind==='defense'&&b.type===move.type)return this.chainModify(1-b.amount);}
};
for(const [stat,key]of Object.entries(stats))condition['onModify'+({atk:'Atk',def:'Def',spa:'SpA',spd:'SpD',spe:'Spe'})[key]]=function(value,p){return this.chainModify(multiplier(p,stat));};
const items=Object.fromEntries(catalog.map(item=>[toID(item.key),{name:item.key.split('_').map(w=>w[0].toUpperCase()+w.slice(1)).join(' '),num:0,isBerry:true,mutationBerry:item.mutationBerry,
 onStart(p){if(p.activeTurns===0&&!p.ignoringItem())p.eatItem();},
 onEat(p,source){
  record(p,item,source&&source!==p?(source.m.berryItemOwner||source.set.rift.uuid):undefined);
  p.addVolatile('riftmutation',p,this.effect);
 }
}]));
function install(battle){
 battle.berryBattleId ||= battle.sides.flatMap(s=>s.pokemon).find(p=>p.m.berryBattleId)?.m.berryBattleId || randomUUID();
 for(const side of battle.sides)for(const p of side.pokemon){
  if(p.__berryHooks)continue; // Wrapper functions are rebound on checkpoint restore below.
  const take=p.takeItem,set=p.setItem,eat=p.eatItem,use=p.useItem;
  p.m.berryBattleId=battle.berryBattleId;
  p.m.berryItemOwner ||= p.set.rift.uuid;
  p.takeItem=function(...args){const owner=this.m.berryItemOwner,item=take.apply(this,args);return item?{...item,berryOwner:owner}:item;};
  p.useItem=function(...args){const item=byId.get(this.item),used=use.apply(this,args);if(used&&item){record(this,item);this.lastItem='';}return used;};
  p.setItem=function(item,...args){if(byId.has(typeof item==='string'?toID(item):item?.id)&&['recycle','harvest','pickup'].includes(this.battle.effect?.id))return false;const previous=byId.get(this.item);if(previous&&!item&&['fling','naturalgift'].includes(this.battle.effect?.id))record(this,previous);const owner=typeof item==='object'?item.berryOwner:null;this.m.berryItemOwner=owner||(!item?this.m.berryItemOwner:this.set.rift.uuid);return set.call(this,item,...args);};
  p.eatItem=function(...args){const permanent=byId.has(this.item),used=eat.apply(this,args);if(used&&permanent)this.lastItem='';return used;};
  Object.defineProperty(p,'__berryHooks',{value:true,configurable:true});
 }
}
function collect(sim){return sim?.sides.flatMap(s=>s.pokemon.flatMap(p=>p.m.berrySpent||[]))||[];}
function syncModels(sim,models){const records=collect(sim);for(const model of models){const own=records.filter(r=>r.pokemonUuid===model.uuid);if(own.length){model.__berrySpent=[...new Map([...(model.__berrySpent||[]),...own].map(r=>[r.battleId+':'+r.itemKey,r])).values()];if(own.some(r=>r.itemKey===model.heldItem))model.heldItem=null;}}return records;}
module.exports={items,condition,install,collect,syncModels,byId};
