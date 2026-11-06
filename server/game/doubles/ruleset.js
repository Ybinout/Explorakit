// Canonical doubles mechanics, isolated from RiftMon's established singles engine.
const {Dex,toID}=require('@pkmn/sim');
const catalog=require('../../../data/game/items.json').items;
const corruptedItemIds=new Set(catalog.filter(i=>i.corruptedHeldItem).map(i=>toID(i.key)));
const aliases={celebration:'celebrate'};
const statNames={hp:'hp',atk:'attack',def:'defense',spa:'specialAttack',spd:'specialDefense',spe:'speed'};
const customItems={};
for(const item of catalog.filter(i=>i.corruptedHeldItem)){
 const base=Dex.items.get(toID(item.corruptedBase));
 const copy={...Dex.data.Items[base.id],name:item.key.split('_').map(w=>w[0].toUpperCase()+w.slice(1)).join(' '),num:0};
 if(item.key==='death_orb'){
  copy.onModifyDamage=function(){return this.chainModify(1.2);};
  copy.onAfterMoveSecondarySelf=function(source,target,move){if(source&&source!==target&&move.category!=='Status'&&!source.forceSwitchFlag)this.damage(Math.max(1,Math.floor(source.baseMaxhp*.3)),source,source,this.effect);};
 }else if(item.key.startsWith('corrupted_choice_')){
  const stat={choice_attack:'Atk',choice_specialAttack:'SpA',choice_speed:'Spe'}[catalog.find(i=>i.key===item.corruptedBase).battle_effect];
  copy['onModify'+stat]=function(){return this.chainModify(1.2);};
  // Unlike life-orb secondary recoil, this is a cost for each launched move.
  copy.onAfterMove=function(pokemon){if(pokemon.hp)this.damage(Math.max(1,Math.floor(pokemon.baseMaxhp*item.recoilFraction)),pokemon,pokemon,this.effect);};
 }else if(item.key==='corrupted_leftovers'){
  copy.onStart=function(p){p.m.corruptedLeftoversTurns=0;};
  copy.onResidual=function(p){if((p.m.corruptedLeftoversTurns||0)>=item.maxActiveTurns-1){this.add('-activate',p,'item: '+item.name);p.faint();}else this.heal(Math.max(1,Math.floor(p.baseMaxhp*item.healFraction)),p,p,this.effect);};
 }
 customItems[toID(item.key)]=copy;
}
for(const key of ['everstone','exp_share','rift_talisman'])if(!Dex.items.get(toID(key)).exists)customItems[toID(key)]={name:catalog.find(i=>i.key===key).name,num:0};
const dex=Dex.mod('riftmondoubles',{Scripts:{inherit:'gen7'},Items:customItems,Moves:{teleport:{...Dex.mod('gen8').data.Moves.teleport,inherit:true}}});
const format={name:'RiftMon Doubles',id:'riftmondoubles',mod:'riftmondoubles',gameType:'doubles',playerCount:2,debug:false,
 ruleset:['Cancel Mod','Max Team Size = 12','Max Move Count = 4','Max Level = 9999','Default Level = 100'],
 onModifySpecies(species,pokemon){const r=pokemon?.set?.rift;if(r&&!pokemon.transformed){const base=species.id===toID(pokemon.set.species)?require('../../../data/game/pokedex.json').find(p=>p.id===species.num)?.base:null;return {...species,...(r.types?{types:[...r.types]}:{}),maxHP:undefined,...(base?{baseStats:{hp:base.HP,atk:base.Attack,def:base.Defense,spa:base['Sp. Attack'],spd:base['Sp. Defense'],spe:base.Speed}}:{})};}},
 onModifyDamage(damage,source,target,move){const a=source?.set.rift?.combat,d=target?.set.rift?.combat;return this.chainModify((a?.direction==='offense'&&a.type===move.type?1.2:1)*(d?.direction==='defense'&&d.type===move.type ? .8 : 1));},
 onTryHit(target,source,move){if(['trick','switcheroo'].includes(move.id)&&(!acceptsItem(target,source.item)||!acceptsItem(source,target.item)))return false;},
 onResidualOrder:5,
 onResidual(p){if(p?.hp)p.m.corruptedLeftoversTurns=(p.m.corruptedLeftoversTurns||0)+1;},
 onSwitchOut(p){p.m.corruptedLeftoversTurns=0;},
 onBegin(){for(const side of this.sides)for(const p of side.pokemon){const original=p.ignoringItem,setItem=p.setItem;p.setItem=function(item,...args){if(!acceptsItem(this,typeof item==='string'?toID(item):item.id))return false;return setItem.call(this,item,...args);};p.ignoringItem=function(){const corrupt=corruptedItemIds.has(this.item);return Boolean(this.item)&&corrupt!==!!this.set.rift.corrupted||original.call(this);};}}
};
function acceptsItem(p,item){return !item||corruptedItemIds.has(item)===!!p.set.rift?.corrupted;}
dex.formats.extend([format]);
function teamSet(p){
 const species=dex.species.get(p.data.name.english);
 if(!species.exists)throw Error('Espèce non prise en charge en Double : '+p.data.name.english);
 const moves=p.abilities.map(name=>{const id=aliases[toID(name)]||toID(name);if(!dex.moves.get(id).exists)throw Error('Capacité non prise en charge en Double : '+name);return id;});
 const item=toID(p.heldItem||'');if(item&&!dex.items.get(item).exists)throw Error('Objet non pris en charge en Double : '+p.heldItem);
 const ability=dex.abilities.get(p.passiveAbility);if(!ability.exists)throw Error('Talent non pris en charge en Double : '+p.passiveAbility);
 return {name:p.truename||p.data.name.french,species:species.name,ability:ability.name,item,moves,nature:p.nature,level:p.level,
  gender:({male:'M',female:'F',genderless:''})[require('../items/stoneEvolution').gender(p)]||'',shiny:!!p.shiny,
  ivs:Object.fromEntries(Object.entries(statNames).map(([key,name])=>[key,p.iv[name]])),
  evs:Object.fromEntries(Object.entries(statNames).map(([key,name])=>[key,p.ev[name]])),
  rift:{uuid:p.uuid,k:p.k,iv:p.iv,ev:p.ev,types:p.corruption?.modules?.type?.types||null,corrupted:!!p.corruption?.permanent,combat:require('../corruption/pokemon').moduleOf(p,'combat')}};
}
function installStats(battle){
 const calculatePP=battle.calculatePP;
 battle.calculatePP=function(move,ppUps){const name=move.name==='Celebrate'?'Celebration':move.name;const definition=require('../battle/battleResources').getMoveDefinition(name);return definition?require('../battle/battleResources').getMaxMovePp(name):calculatePP.call(this,move,ppUps);};
 // The simulator calls this for initial and temporary forms. Preserve RiftMon's
 // IV×K formula and EV rules; Transform copies these real stored stats itself.
 const original=battle.spreadModify;
 battle.spreadModify=function(base,set){if(!set.rift)return original.call(this,base,set);const r=set.rift,nature=this.dex.natures.get(set.nature),out={};
  for(const[key,name]of Object.entries(statNames)){
   const value=((2*base[key]+r.k*r.iv[name]+Math.floor((r.ev[name]||0)/4))*set.level)/100;
   out[key]=Math.floor(key==='hp'?value+set.level+10:(value+5)*(nature.plus===key&&nature.minus!==key?1.1:nature.minus===key&&nature.plus!==key?.9:1));
  }return out;
 };
}
module.exports={dex,format,teamSet,installStats,statNames};
