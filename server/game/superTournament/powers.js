const stacks=require('./cardStacks');
// Fixed, server-owned powers. Only the sealed Super Tournament participant
// can expose them to the shared battle hooks; no ordinary drift is modified.
const cards=Object.freeze([
 {key:'power_miracle',name:'Miracle des champions',kind:'reset',target:'team',amount:1,tickets:20,description:'Remet toute l’équipe à neuf : PV, statuts et PP, même les Pokémon K.O. Ne rend pas les objets consommés.'},
 {key:'power_phoenix',name:'Phénix souverain',kind:'passive',target:'run',tickets:30,values:{55:100},description:'Chaque cumul permet à chaque Pokémon d’éviter un K.O. causé par une attaque, une fois par combat, et de garder 20 % de ses PV. Le poison et les autres dégâts hors attaque peuvent toujours le mettre K.O.'},
 {key:'power_vampire',name:'Vampirisme royal',kind:'passive',target:'run',tickets:50,values:{5:50},description:'Chaque cumul rend au lanceur 50 % des dégâts de ses attaques en PV. Exemple : 100 dégâts infligés → 50 PV récupérés.'},
 {key:'power_bastion',name:'Bastion absolu',kind:'passive',target:'run',tickets:50,values:{13:40},description:'Réduit de 40 % les dégâts des attaques ennemies. Le bonus s’applique à toute ton équipe.'},
 {key:'power_fountain',name:'Source éternelle',kind:'passive',target:'run',tickets:50,values:{16:15},description:'Par cumul, le Pokémon actif récupère 15 % de ses PV maximum à chaque fin de tour pendant cette tentative.'},
 {key:'power_sanctuary',name:'Sanctuaire de victoire',kind:'passive',target:'run',tickets:50,description:'Par cumul, après chaque salle remportée, rend 25 % des PV maximum à tous les Pokémon encore aptes. Dure toute la tentative.'},
 {key:'power_reunion',name:'Retour des héros',kind:'revive',target:'team',amount:1,tickets:50,description:'Relève tous les Pokémon K.O. avec la totalité de leurs PV et soigne leur statut. Les PP restent inchangés.'},
 {key:'power_mana',name:'Réserves célestes',kind:'pp',target:'team',amount:Infinity,tickets:50,description:'Restaure tous les PP de toutes les capacités des Pokémon aptes de l’équipe.'}
].map(c=>Object.freeze({...c,values:c.values?Object.freeze(c.values):undefined,rarity:'mythic',rarityName:'Mythique',power:true})));
const byKey=new Map(cards.map(c=>[c.key,c]));
function count(owner,key){return stacks.count(owner,key,'superTournamentPassives','superTournamentPassiveStacks');}
function has(owner,key){return count(owner,key)>0;}
function usable(owner,key){return owner?.currentmap==='super_tournament_room'&&byKey.get(key)?.kind==='passive'&&count(owner,key)<stacks.LIMIT;}
function description(key,n){return ({
 power_phoenix:`Chaque Pokémon peut survivre à ${n} attaque${n>1?'s':''} qui devrai${n>1?'ent':'t'} le mettre K.O. par combat, avec 20 % de ses PV.`,
 power_vampire:`Récupère en PV ${n*50} % des dégâts de ses attaques.`,
 power_bastion:`Dégâts des attaques ennemies : −${Math.round((1-stacks.factor(.6,n))*10000)/100} %.`,
 power_fountain:`Récupère ${n*15} % des PV maximum à chaque fin de tour.`,
 power_sanctuary:`Récupère ${n*25} % des PV maximum après chaque victoire pour les Pokémon aptes.`
 })[key];}
function active(owner){return [...new Set(owner?.superTournamentPassives||[])].map(key=>byKey.get(key)).filter(c=>c?.kind==='passive'&&has(owner,c.key)).map(({key,name,rarity})=>({key,name,description:description(key,count(owner,key)),rarity,stacks:count(owner,key),stackable:true}));}
function activate(owner,key){const c=byKey.get(key);if(!usable(owner,key))throw Error('Cette augmentation est indisponible.');const n=stacks.add(owner,key,'superTournamentPassives','superTournamentPassiveStacks');return {key,name:c.name,description:description(key,n),stacks:n,stackable:true};}
function value(owner,number){
 if(owner?.currentmap!=='super_tournament_room')return 0;
 return [...new Set(owner.superTournamentPassives||[])].reduce((sum,key)=>{const n=count(owner,key),v=byKey.get(key)?.values?.[number]||0;return sum+(number===13&&v?100*(1-stacks.factor(.6,n)):number===55&&v?v:v*n);},0);
}
function damageMultiplier(owner){return stacks.factor(.6,count(owner,'power_bastion'));}
function signalName(owner,number){return value(owner,number)>0?cards.find(c=>has(owner,c.key)&&c.values?.[number])?.name:null;}
function afterWin(owner){
 if(owner?.currentmap!=='super_tournament_room'||!has(owner,'power_sanctuary'))return [];
 const changes=[];for(const p of owner.equipe.pokemons){if(p.currentHp<=0||p.currentHp>=p.maxHp)continue;const before=p.currentHp;p.currentHp=Math.min(p.maxHp,p.currentHp+Math.max(1,Math.floor(p.maxHp*.25*count(owner,'power_sanctuary'))));changes.push({uuid:p.uuid,name:p.name||p.truename,amount:p.currentHp-before});}return changes;
}
function draw(owner,random,canRestore){
 const n=random();if(!Number.isFinite(n)||n<0||n>=1)throw Error('Tirage d’augmentation invalide.');
 let ticket=Math.floor(n*10000);
 for(const card of cards){if(ticket<card.tickets)return card.kind==='passive'?usable(owner,card.key)?card.key:null:canRestore(card)?card.key:null;ticket-=card.tickets;}
 return null;
}
module.exports={cards,get:key=>byKey.get(key),count,usable,description,damageMultiplier,has,active,activate,value,signalName,afterWin,draw};
