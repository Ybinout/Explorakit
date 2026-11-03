const {getItemDefinition}=require('../battle/battleResources');
const cards=Object.freeze([
 // Keep the legacy key so saved offers and previously claimed receipts remain valid.
 {key:'prize_money_10k',name:'Bourse du challenger',rarity:'common',kind:'money',amount:1590},
 {key:'prize_money_25k',name:'Prime du public',rarity:'uncommon',kind:'money',amount:7948},
 {key:'prize_money_50k',name:'Coffre du champion',rarity:'rare',kind:'money',amount:15895},
 {key:'prize_super_candy',name:'Super Bonbon',rarity:'epic',rarityName:'Très rare',kind:'item',itemKey:'rare_candy',quantity:1},
 {key:'prize_mega_candy',name:'Méga Bonbon',rarity:'legendary',rarityName:'Ultra rare',kind:'item',itemKey:'mega_candy',quantity:1}
].map(c=>Object.freeze({...c,target:'account'})));
const byKey=new Map(cards.map(c=>[c.key,c]));
function grant(key,room){
 const card=byKey.get(key);if(!card)return null;
 if(!Number.isSafeInteger(room)||room<1)throw Error('Salle de récompense inconnue.');
 const cycle=Math.floor((room-1)/16)+1;
 return card.kind==='money'?{kind:'money',name:card.name,amount:card.amount*cycle}:{kind:'item',name:card.name,itemKey:card.itemKey,quantity:card.quantity};
}
function view(key,room){
 const card=byKey.get(key),reward=grant(key,room);if(!card)return null;
 const description=card.kind==='money'?`Ajoute ${reward.amount.toLocaleString('fr-FR')} ₽ à ton porte-monnaie. Gains conservés après le parcours.`:`Ajoute 1 ${card.name} au sac d’Aventure. Utilisable après le parcours, jusqu’au niveau ${getItemDefinition(card.itemKey).fieldUse.maxLevel}.`;
 return {...card,grant:reward,description,targets:[],usable:true};
}
function unit(random){const n=random();if(!Number.isFinite(n)||n<0||n>=1)throw Error('Tirage de récompense invalide.');return n;}
function draw(random=Math.random){
 // Absolute odds per offer, independent of the team's health. At most one
 // economic choice replaces a recovery card; healing options stay available.
 const ticket=Math.floor(unit(random)*10000);
 if(ticket<20)return 'prize_mega_candy';
 if(ticket<220)return 'prize_super_candy';
 if(ticket<3220){const n=unit(random);return n<.6?'prize_money_10k':n<.9?'prize_money_25k':'prize_money_50k';}
 return null;
}
module.exports={cards,grant,view,draw};
