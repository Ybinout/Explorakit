const KEY='fortune_charm';
const card=Object.freeze({key:KEY,name:'Trèfle porte-bonheur',rarity:'rare',rarityName:'Rare',kind:'fortune',target:'run',description:'À partir du prochain tirage, les cartes proposées sont au minimum peu communes. Fonctionne aussi sur les relances. Les cartes déjà proposées restent inchangées.',duration:'Toute la tentative'});
function has(owner){return owner?.currentmap==='super_tournament_room'&&owner.superTournamentFortune===true;}
function usable(owner){return owner?.currentmap==='super_tournament_room'&&!has(owner);}
function activate(owner){if(!usable(owner))throw Error('Cette chance est déjà active ou indisponible.');owner.superTournamentFortune=true;return{key:KEY,name:card.name,description:card.description,duration:card.duration};}
function draw(owner,random,exclude=new Set()){
 if(!usable(owner)||exclude.has(KEY))return null;
 const n=random();if(!Number.isFinite(n)||n<0||n>=1)throw Error('Tirage de chance invalide.');
 return n<.06?KEY:null;
}
function active(owner){return has(owner)?[{key:KEY,name:card.name,description:card.description,duration:card.duration,rarity:card.rarity}]:[];}
module.exports={KEY,card,has,usable,activate,draw,active};
