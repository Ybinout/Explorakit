// Fixed, server-owned powers. Only the sealed Super Tournament participant
// can expose them to the shared battle hooks; no ordinary drift is modified.
const cards=Object.freeze([
 {key:'power_miracle',name:'Miracle des champions',kind:'reset',target:'team',amount:1,tickets:20,description:'Remet toute l’équipe à neuf : PV, statuts et PP, même les Pokémon K.O. Ne rend pas les objets consommés.'},
 {key:'power_phoenix',name:'Phénix souverain',kind:'passive',target:'run',tickets:30,values:{55:100},description:'Chaque Pokémon survit une fois par combat à un coup direct fatal avec 20 % de ses PV. Les dégâts résiduels restent dangereux.'},
 {key:'power_vampire',name:'Vampirisme royal',kind:'passive',target:'run',tickets:50,values:{5:50},description:'Toute l’équipe récupère 50 % des dégâts directs infligés sous forme de PV, pendant cette tentative.'},
 {key:'power_bastion',name:'Bastion absolu',kind:'passive',target:'run',tickets:50,values:{13:40},description:'Toute l’équipe subit 40 % de dégâts directs en moins pendant cette tentative.'},
 {key:'power_fountain',name:'Source éternelle',kind:'passive',target:'run',tickets:50,values:{16:15},description:'Le Pokémon actif récupère 15 % de ses PV maximum à chaque fin de tour pendant cette tentative.'},
 {key:'power_sanctuary',name:'Sanctuaire de victoire',kind:'passive',target:'run',tickets:50,description:'Après chaque salle remportée, rend 25 % des PV maximum à tous les Pokémon encore aptes. Dure toute la tentative.'},
 {key:'power_reunion',name:'Retour des héros',kind:'revive',target:'team',amount:1,tickets:50,description:'Relève tous les Pokémon K.O. avec la totalité de leurs PV et soigne leur statut. Les PP restent inchangés.'},
 {key:'power_mana',name:'Réserves célestes',kind:'pp',target:'team',amount:Infinity,tickets:50,description:'Restaure tous les PP de toutes les capacités des Pokémon aptes de l’équipe.'}
].map(c=>Object.freeze({...c,values:c.values?Object.freeze(c.values):undefined,rarity:'mythic',rarityName:'Mythique',power:true})));
const byKey=new Map(cards.map(c=>[c.key,c]));
function has(owner,key){return Boolean(owner?.superTournamentPassives?.includes(key));}
function active(owner){return [...new Set(owner?.superTournamentPassives||[])].map(key=>byKey.get(key)).filter(c=>c?.kind==='passive').map(({key,name,description,rarity})=>({key,name,description,rarity}));}
function activate(owner,key){const c=byKey.get(key);if(owner?.currentmap!=='super_tournament_room'||c?.kind!=='passive'||has(owner,key))throw Error('Cette augmentation est déjà active ou indisponible.');owner.superTournamentPassives=[...active(owner).map(c=>c.key),key];return {key,name:c.name,description:c.description};}
function value(owner,number){
 if(owner?.currentmap!=='super_tournament_room'||!Array.isArray(owner.superTournamentPassives))return 0;
 return owner.superTournamentPassives.reduce((sum,key,i,keys)=>sum+(keys.indexOf(key)===i?byKey.get(key)?.values?.[number]||0:0),0);
}
function signalName(owner,number){return value(owner,number)>0?cards.find(c=>has(owner,c.key)&&c.values?.[number])?.name:null;}
function afterWin(owner){
 if(owner?.currentmap!=='super_tournament_room'||!has(owner,'power_sanctuary'))return [];
 const changes=[];for(const p of owner.equipe.pokemons){if(p.currentHp<=0||p.currentHp>=p.maxHp)continue;const before=p.currentHp;p.currentHp=Math.min(p.maxHp,p.currentHp+Math.max(1,Math.floor(p.maxHp*.25)));changes.push({uuid:p.uuid,name:p.name||p.truename,amount:p.currentHp-before});}return changes;
}
function draw(owner,random,usable){
 const n=random();if(!Number.isFinite(n)||n<0||n>=1)throw Error('Tirage d’augmentation invalide.');
 let ticket=Math.floor(n*10000);
 for(const card of cards){if(ticket<card.tickets)return card.kind==='passive'?!has(owner,card.key)?card.key:null:usable(card)?card.key:null;ticket-=card.tickets;}
 return null;
}
module.exports={cards,get:key=>byKey.get(key),has,active,activate,value,signalName,afterWin,draw};
