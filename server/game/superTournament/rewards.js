const {randomUUID}=require('node:crypto');
const {getMaxMovePp}=require('../battle/battleResources');
const augmentations=require('./augmentations');
const powers=require('./powers');
const twists=require('./twists');
const {family}=require('./rewardFamilies');
const CHOICES=4;
const rarities=Object.freeze([
 {key:'common',name:'Commune',weight:55}, {key:'uncommon',name:'Peu commune',weight:30},
 {key:'rare',name:'Rare',weight:11}, {key:'epic',name:'Épique',weight:3.5}, {key:'legendary',name:'Légendaire',weight:.5}
]);
const cards=Object.freeze([
 ['heal_10','Petite pause','common','heal',.10,'one','Rend 10 % des PV maximum à un Pokémon apte.'],
 ['heal_25','Second souffle','common','heal',.25,'one','Rend 25 % des PV maximum à un Pokémon apte.'],
 ['pp_3','Étincelle mentale','common','pp',3,'move','Rend 3 PP à une capacité d’un Pokémon apte.'],
 ['cure','Remède de poche','common','cure',0,'one','Soigne le statut d’un Pokémon apte.'],
 ['heal_50','Repos mérité','uncommon','heal',.50,'one','Rend 50 % des PV maximum à un Pokémon apte.'],
 ['team_heal_10','Pause collective','uncommon','heal',.10,'team','Rend 10 % des PV maximum à chaque Pokémon apte.'],
 ['pp_5','Concentration','uncommon','pp',5,'move','Rend 5 PP à une capacité d’un Pokémon apte.'],
 ['all_pp_3','Inspiration','uncommon','pp',3,'one','Rend 3 PP à chacune des capacités d’un Pokémon apte.'],
 ['revive_25','Sursaut','uncommon','revive',.25,'one','Relève un Pokémon K.O. avec 25 % de ses PV maximum.'],
 ['heal_100','Grand repos','rare','heal',1,'one','Rend tous ses PV à un Pokémon apte, sans soigner son statut.'],
 ['team_heal_25','Halte revigorante','rare','heal',.25,'team','Rend 25 % des PV maximum à chaque Pokémon apte.'],
 ['all_pp_5','Élan retrouvé','rare','pp',5,'one','Rend 5 PP à chacune des capacités d’un Pokémon apte.'],
 ['revive_50','Rappel','rare','revive',.50,'one','Relève un Pokémon K.O. avec 50 % de ses PV maximum.'],
 ['team_cure','Air pur','rare','cure',0,'team','Soigne le statut de tous les Pokémon aptes.'],
 ['revive_100','Rappel Max','epic','revive',1,'one','Relève un Pokémon K.O. avec tous ses PV.'],
 ['full_restore','Soin Total','epic','restore',1,'one','Rend tous ses PV et soigne le statut d’un Pokémon apte. Les PP restent inchangés.'],
 ['full_pp','Clarté absolue','epic','pp',Infinity,'one','Restaure tous les PP des capacités d’un Pokémon apte.'],
 ['team_heal_50','Campement','epic','heal',.50,'team','Rend 50 % des PV maximum à chaque Pokémon apte.'],
 ['full_reset','Renaissance','legendary','reset',1,'one','Remet un Pokémon à neuf : PV, statut et PP, même s’il est K.O. Ne rend pas les objets consommés.'],
 ['team_pp_5','Chœur des champions','legendary','pp',5,'team','Rend 5 PP à toutes les capacités de chaque Pokémon apte.'],
 ['team_revive_25','Dernier espoir','legendary','revive',.25,'team','Relève tous les Pokémon K.O. avec 25 % de leurs PV maximum.']
].map(([key,name,rarity,kind,amount,target,description])=>Object.freeze({key,name,rarity,kind,amount,target,description})).concat(augmentations.cards,powers.cards,twists.cards));
const byKey=new Map(cards.map(c=>[c.key,c]));
function preview(p,card,moveIndex){
 if(!p||p.isEgg||!card)return null;
 const hp=Number(p.currentHp)||0,maxHp=Math.max(1,Number(p.maxHp)||1),dead=hp<=0;
 if(card.kind==='revive'?!dead:card.kind!=='reset'&&dead)return null;
 let after=hp,status=p.status||'normal';const moves=[];
 if(card.kind==='heal'||card.kind==='restore')after=Math.min(maxHp,hp+Math.max(1,Math.floor(maxHp*card.amount)));
 if(card.kind==='revive')after=Math.max(1,Math.floor(maxHp*card.amount));
 if(card.kind==='reset')after=maxHp;
 if(['revive','restore','reset','cure'].includes(card.kind))status='normal';
 if(card.kind==='pp'||card.kind==='reset')for(const [index,name]of (p.abilities||[]).entries()){
  if(card.target==='move'&&moveIndex!==undefined&&index!==moveIndex)continue;
  const max=getMaxMovePp(name),before=Math.max(0,Math.min(max,Number(p.movePp?.[index]??max)));
  const pp=Math.min(max,before+(card.kind==='reset'?max:card.amount));
  if(pp>before)moves.push({index,name,before,after:pp,max});
 }
 if(after===hp&&status===(p.status||'normal')&&!moves.length)return null;
 return {uuid:p.uuid,name:p.name||p.truename||p.data?.name||'Pokémon',hpBefore:hp,hpAfter:after,maxHp,statusBefore:p.status||'normal',statusAfter:status,moves};
}
function viewCard(key,team,afterRoom,owner){
 const card=byKey.get(key);if(!card)return null;
 if(card.twist)return twists.view(card,owner);
 if(card.target==='account')return {...augmentations.view(key,afterRoom),rarityName:card.rarityName||rarities.find(r=>r.key===card.rarity).name};
 if(card.kind==='passive')return {...card,targets:[],usable:!powers.has(owner,key)};
 const targets=team.map(p=>preview(p,card)).filter(Boolean);
 return {key:card.key,name:card.name,rarity:card.rarity,rarityName:card.rarityName||rarities.find(r=>r.key===card.rarity).name,kind:card.kind,target:card.target,description:card.description,power:card.power||false,targets,usable:targets.length>0};
}
function viewOffer(offer,team,owner){if(!offer)return null;const choices=offer.cards.map(k=>viewCard(k,team,offer.afterRoom,owner)).filter(Boolean);return {id:offer.id,afterRoom:offer.afterRoom,choices,canSkip:choices.every(c=>!c.usable),canDecline:offer.cards.some(k=>twists.get(k))};}
function drawIndex(random,length){const n=random();if(!Number.isFinite(n)||n<0||n>=1)throw Error('Tirage de récompense invalide.');return Math.floor(n*length);}
function recoveryCards(exclude,used){return cards.filter(c=>c.target!=='account'&&!c.power&&!c.twist&&!exclude.has(c.key)&&!used.has(family(c)));}
function pickRecovery(team,exclude,used,random){
 const available=recoveryCards(exclude,used);
 if(!available.length)throw Error('Aucune famille de récompense disponible.');
 // Roll rarity before preferring useful effects. A legendary reset must not
 // become guaranteed just because it is the only heal that also restores PP.
 const tiers=rarities.filter(r=>available.some(c=>c.rarity===r.key)),total=tiers.reduce((n,r)=>n+r.weight,0);
 let value=random();if(!Number.isFinite(value)||value<0||value>=1)throw Error('Tirage de récompense invalide.');value*=total;
 const tier=tiers.find(r=>(value-=r.weight)<0)||tiers.at(-1),candidates=available.filter(c=>c.rarity===tier.key);
 const useful=candidates.filter(c=>team.some(p=>preview(p,c))),pool=useful.length?useful:candidates;
 return pool[drawIndex(random,pool.length)];
}
function createOffer(team,afterRoom,random=Math.random,owner,excluded=[]){
 const exclude=new Set(excluded),extra=augmentations.draw(random),power=powers.draw(owner,random,c=>team.some(p=>preview(p,c))),twist=twists.draw(owner,random,exclude),picked=[],used=new Set();
 // Preserve the special-draw priority and a minimum of two recovery choices.
 for(const key of [power,twist,extra]){
  const card=byKey.get(key);if(!card||exclude.has(key)||used.has(family(card)))continue;
  picked.push(key);used.add(family(card));if(picked.length===2)break;
 }
 while(picked.length<CHOICES){
  const card=pickRecovery(team,exclude,used,random);picked.push(card.key);used.add(family(card));
 }
 for(let i=picked.length-1;i>0;i--){const j=drawIndex(random,i+1);[picked[i],picked[j]]=[picked[j],picked[i]];}
 return {id:randomUUID(),afterRoom,cards:picked};
}
function needsRepair(offer){return Boolean(offer&&(offer.cards.length!==CHOICES||offer.cards.some(k=>!byKey.has(k))||new Set(offer.cards.map(k=>family(byKey.get(k)))).size!==offer.cards.length));}
function ensureFour(offer,team,random=Math.random){
 if(!needsRepair(offer))return false;
 const ranks={common:0,uncommon:1,rare:2,epic:3,legendary:4,mythic:5},best=new Map();
 for(const [index,key]of offer.cards.entries()){
  const card=byKey.get(key);if(!card)continue;const f=family(card),previous=best.get(f);
  if(!previous||ranks[card.rarity]>ranks[previous.card.rarity])best.set(f,{index,card});
 }
 const kept=[...best.values()].sort((a,b)=>a.index-b.index).slice(0,CHOICES),used=new Set(kept.map(c=>family(c.card)));
 const result=Array(CHOICES).fill(null);for(const {index,card}of kept)result[index<CHOICES&&!result[index]?index:result.indexOf(null)]=card.key;
 for(let i=0;i<result.length;i++)if(!result[i]){const c=pickRecovery(team,new Set(offer.cards),used,random);result[i]=c.key;used.add(family(c));}
 offer.cards=result;return true;
}
function applyChoice(offer,team,data,owner){
 if(!offer||data.offerId!==offer.id)throw Error('Ce choix n’est plus disponible.');
 if(data.skip===true){const view=viewOffer(offer,team,owner);if(!view.canSkip&&!view.canDecline)throw Error('Choisis une carte pour continuer.');return {name:view.canDecline?'Récompense passée':'Équipe déjà prête',changes:[],skipped:true};}
 if(!offer.cards.includes(data.cardKey))throw Error('Cette carte ne fait pas partie du tirage.');
 const card=byKey.get(data.cardKey);if(!card)throw Error('Cette carte n’existe plus.');
 if(card.twist)return {name:card.name,changes:[],passive:twists.activate(owner,card.key)};
 if(card.target==='account')return {name:card.name,changes:[],grant:augmentations.grant(card.key,offer.afterRoom)};
 if(card.kind==='passive')return {name:card.name,changes:[],passive:powers.activate(owner,card.key)};
 let targets;
 if(card.target==='team')targets=team;
 else{const p=team.find(p=>p.uuid===data.pokemonUuid);if(!p)throw Error('Choisis un Pokémon de ton équipe inscrite.');targets=[p];}
 if(card.target==='move'&&(!Number.isInteger(data.moveIndex)||data.moveIndex<0||data.moveIndex>=targets[0].abilities.length))throw Error('Choisis la capacité à restaurer.');
 const changes=targets.map(p=>preview(p,card,data.moveIndex)).filter(Boolean);
 if(!changes.length)throw Error('Cette carte n’aurait aucun effet sur cette cible.');
 for(const change of changes){const p=team.find(p=>p.uuid===change.uuid);p.currentHp=change.hpAfter;p.status=change.statusAfter;
  if(change.moves.length){p.movePp=p.abilities.map((name,i)=>p.movePp?.[i]??getMaxMovePp(name));for(const move of change.moves)p.movePp[move.index]=move.after;}
  if(['revive','reset'].includes(card.kind))delete p.riftFainted;
 }
 return {name:card.name,changes};
}
module.exports={rarities,cards,preview,viewOffer,createOffer,applyChoice,ensureFour,needsRepair,familyOf:key=>family(byKey.get(key)),CHOICES};
