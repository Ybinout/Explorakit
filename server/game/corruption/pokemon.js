const modules = require('./modules');
function normalize(value){
 if(typeof value==='string')value=JSON.parse(value);
 if(!value)return null;
 if(value.version!==1||!Number.isInteger(value.revision)||value.revision<1||!value.modules||typeof value.modules!=='object')throw Error('Données de corruption invalides.');
 const result={version:1,revision:value.revision,permanent:true,modules:{}};
 for(const[family,module]of Object.entries(value.modules)){
  if(!Object.hasOwn(modules.FAMILIES,family)||modules.get(module.itemKey)?.corruptionModule.family!==family)throw Error('Module corrompu invalide.');
  result.modules[family]={itemKey:module.itemKey};
  if(family==='type'){
   if(!Array.isArray(module.types)||module.types.length<1||module.types.length>2||new Set(module.types).size!==module.types.length||module.types.some(t=>!Object.hasOwn(modules.TYPES,t)))throw Error('Types corrompus invalides.');
   result.modules.type.types=[...module.types];
  }
 }
 return result;
}
function corrupted(p){return Boolean(p?.corruption?.permanent);}
function assertTeam(team){if(team.filter(corrupted).length>1)throw Error('Un seul Pokémon corrompu est autorisé dans ton équipe. Dépose d’abord ton autre compagnon corrompu au PC.');}
function moduleOf(p,family){return modules.get(p?.corruption?.modules?.[family]?.itemKey)?.corruptionModule||null;}
function applyTraits(p){
 if(!p?.corruption)return p;
 const type=p.corruption.modules.type,ability=moduleOf(p,'ability');
 if(type){p.data={...p.data,type:[...type.types]};[p.type1,p.type2]=type.types;}
 if(ability){p.passiveAbility=ability.ability;if(Object.hasOwn(p,'__passiveAbilityBeforeBattle'))p.__passiveAbilityBeforeBattle=ability.ability;}
 return p;
}
function protectMove(p,slot){const move=moduleOf(p,'move')?.move;if(move&&p.abilities[slot]===move)throw Error('Cette capacité appartient au module CS corrompue. Remplace ce module pour la changer.');}
function validateTarget(p,item,choice={}){
 if(!p||p.isEgg||!(p.currentHp>0))throw Error('Choisis un Pokémon conscient, hors œuf.');
 if(!item?.corruptionModule)throw Error('Ce module est introuvable.');
 if((p.corruption?.revision||0)!==choice.expectedRevision)throw Error('La corruption de ce Pokémon a changé. Ouvre de nouveau sa fiche.');
 const m=item.corruptionModule;
 if(m.family==='move'){
  if(JSON.stringify(p.abilities)!==JSON.stringify(choice.expectedMoves))throw Error('Les capacités ont changé. Choisis à nouveau.');
  if(p.abilities.includes(m.move))throw Error('Ce Pokémon connaît déjà cette capacité.');
  const old=moduleOf(p,'move')?.move,at=p.abilities.indexOf(old),slot=at>=0?at:choice.slot;
  if(!Number.isInteger(slot)||slot<0||slot>3||slot>p.abilities.length||p.abilities.length<4&&slot!==p.abilities.length&&at<0)throw Error('Choisis la capacité à remplacer.');
 }
 if(m.family==='type'&&p.data.type.length===1&&p.data.type.includes(m.type))throw Error('Impossible de supprimer le seul type de ce Pokémon. Le module reste dans le sac.');
 if(p.corruption?.modules[m.family]?.itemKey===item.key&&m.family!=='type')throw Error('Ce module est déjà installé.');
}
function install(p,item,choice,random=Math.random){
 validateTarget(p,item,choice);const m=item.corruptionModule;
 const next={...(normalize(p.corruption)||{version:1,revision:0,permanent:true,modules:{}})};next.modules={...next.modules};next.revision++;
 next.modules[m.family]={itemKey:item.key};
 if(m.family==='move'){
  const previous=moduleOf(p,'move')?.move,oldSlot=p.abilities.indexOf(previous),slot=oldSlot>=0?oldSlot:choice.slot;
  p.abilities=[...p.abilities];p.movePp=[...p.movePp];p.abilities[slot]=m.move;p.movePp[slot]=require('../battle/battleResources').getMaxMovePp(m.move);p.pendingMoves=(p.pendingMoves||[]).filter(c=>c.move!==m.move);
 }
 if(m.family==='type'){
  const types=[...p.data.type];
  if(types.includes(m.type))types.splice(types.indexOf(m.type),1);
  else if(types.length===1)types.push(m.type);
  else types[Math.floor(modules.roll(random)*2)]=m.type;
  next.modules.type.types=types;
 }
 p.corruption=next;return applyTraits(p);
}
function multiplier(attacker,defender,move){if(!move?.ename)return 1;const a=moduleOf(attacker,'combat'),d=moduleOf(defender,'combat');return(a?.direction==='offense'&&a.type===move.type?1.2:1)*(d?.direction==='defense'&&d.type===move.type?0.8:1);}
function view(p){if(!p.corruption)return null;return {...p.corruption,modules:Object.fromEntries(Object.entries(p.corruption.modules).map(([key,value])=>[key,{...value,...modules.get(value.itemKey).corruptionModule,name:modules.get(value.itemKey).name}]))};}
module.exports={normalize,corrupted,assertTeam,moduleOf,applyTraits,protectMove,validateTarget,install,multiplier,view};
