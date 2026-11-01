// Server-owned, attempt-only bargains. No Adventure stats, items or moves are changed.
const pact = (key,name,rarity,boon,cost,effects) => ({key:'pact_'+key,name,rarity,kind:'pact',target:'run',boon,cost,effects,description:`${boon} En contrepartie : ${cost}`,duration:'Toute la tentative'});
const cards=Object.freeze([
 pact('hunter','Œil du chasseur','epic','Critiques : +1 cran, non cumulable entre pactes.','Dégâts Eau reçus : +25 %.',{critical:1,incomingType:{Water:1.25}}),
 pact('cold_blood','Sang-froid','epic','Critiques : +1 cran, non cumulable entre pactes.','Vitesse : −10 %.',{critical:1,speed:.9}),
 pact('glass','Lame de verre','rare','Dégâts directs infligés : +15 %.','Dégâts directs reçus : +15 %.',{outgoing:1.15,incoming:1.15}),
 pact('blaze','Brasier ardent','rare','Dégâts Feu infligés : +25 %.','Dégâts Eau reçus : +30 %.',{outgoingType:{Fire:1.25},incomingType:{Water:1.3}}),
 pact('tide','Marée profonde','rare','Dégâts Eau infligés : +25 %.','Dégâts Électrik reçus : +30 %.',{outgoingType:{Water:1.25},incomingType:{Electric:1.3}}),
 pact('garden','Jardin sauvage','rare','Dégâts Plante infligés : +25 %.','Dégâts Feu reçus : +30 %.',{outgoingType:{Grass:1.25},incomingType:{Fire:1.3}}),
 pact('voltage','Haute tension','rare','Dégâts Électrik infligés : +25 %.','Dégâts Sol reçus : +30 %.',{outgoingType:{Electric:1.25},incomingType:{Ground:1.3}}),
 pact('winter','Hiver mordant','rare','Dégâts Glace infligés : +25 %.','Dégâts Combat reçus : +30 %.',{outgoingType:{Ice:1.25},incomingType:{Fighting:1.3}}),
 pact('dragon','Héritage draconique','rare','Dégâts Dragon infligés : +25 %.','Dégâts Fée reçus : +30 %.',{outgoingType:{Dragon:1.25},incomingType:{Fairy:1.3}}),
 pact('heavy_fist','Poing lourd','rare','Dégâts physiques infligés : +20 %.','Vitesse : −10 %.',{outgoingClass:{physical:1.2},speed:.9}),
 pact('mind','Esprit incandescent','rare','Dégâts spéciaux infligés : +20 %.','Dégâts physiques infligés : −20 %.',{outgoingClass:{special:1.2,physical:.8}}),
 pact('soldier','Instinct du combattant','rare','Dégâts physiques infligés : +20 %.','Dégâts spéciaux infligés : −20 %.',{outgoingClass:{physical:1.2,special:.8}}),
 pact('dance','Danse du risque','epic','Vitesse : +15 %.','Dégâts directs reçus : +15 %.',{speed:1.15,incoming:1.15}),
 pact('rampart','Rempart pesant','rare','Dégâts physiques reçus : −15 %.','Vitesse : −10 %.',{incomingClass:{physical:.85},speed:.9}),
 pact('veil','Voile fragile','rare','Dégâts spéciaux reçus : −15 %.','Dégâts physiques reçus : +15 %.',{incomingClass:{special:.85,physical:1.15}}),
 pact('leech','Soif de vie','epic','Soigne 10 % des dégâts directs infligés.','Dégâts Feu reçus : +25 %.',{values:{5:10},incomingType:{Fire:1.25}}),
 pact('breath','Souffle patient','epic','Récupère 3 % des PV maximum en fin de tour.','Vitesse : −10 %.',{values:{16:3},speed:.9}),
 pact('execution','Instinct du finisseur','rare','Dégâts infligés : +25 % si la cible a au plus 35 % de ses PV.','Dégâts infligés : −10 % au-dessus de ce seuil.',{finisher:true}),
 pact('fortress','Force tranquille','rare','Dégâts directs reçus : −12 %.','Dégâts directs infligés : −10 %.',{incoming:.88,outgoing:.9}),
 {key:'next_opponent_two',name:'Duel écourté',rarity:'epic',kind:'opponent',target:'run',count:2,description:'Le prochain dresseur ne garde que ses deux derniers Pokémon, dont son plus fort. Valable pour un seul combat.',duration:'Prochain combat seulement'},
 {key:'next_opponent_one',name:'Face au dernier rempart',rarity:'legendary',kind:'opponent',target:'run',count:1,description:'Le prochain dresseur ne garde que son dernier Pokémon, le plus fort. Valable pour un seul combat.',duration:'Prochain combat seulement'}
].map(c=>Object.freeze({...c,twist:true,rarityName:c.rarity==='epic'?'Épique':c.rarity==='legendary'?'Légendaire':'Rare'})));
const byKey=new Map(cards.map(c=>[c.key,c]));
const enabled=owner=>owner?.currentmap==='super_tournament_room';
const cached=new WeakMap(),empty=Object.freeze([]);
function owned(owner){if(!enabled(owner))return empty;const keys=owner.superTournamentPacts,previous=cached.get(owner);if(previous&&previous.keys===keys)return previous.cards;const result=Object.freeze([...new Set(keys||[])].map(k=>byKey.get(k)).filter(c=>c?.kind==='pact'));cached.set(owner,{keys,cards:result});return result;}
function pending(owner){const c=enabled(owner)?byKey.get(owner.superTournamentNextOpponent):null;return c?.kind==='opponent'?c:null;}
function usable(owner,card){return enabled(owner)&&(card.kind==='pact'?!owner.superTournamentPacts?.includes(card.key)&&(!card.effects.critical||!owned(owner).some(c=>c.effects.critical)):!pending(owner));}
function view(card,owner){return {key:card.key,name:card.name,rarity:card.rarity,rarityName:card.rarityName,kind:card.kind,target:card.target,boon:card.boon,cost:card.cost,description:card.description,duration:card.duration,targets:[],usable:usable(owner,card)};}
function active(owner){return [...owned(owner),...(pending(owner)?[pending(owner)]:[])].map(c=>({key:c.key,name:c.name,description:c.description,rarity:c.rarity,boon:c.boon,cost:c.cost,duration:c.duration}));}
function activate(owner,key){const c=byKey.get(key);if(!c||!usable(owner,c))throw Error('Cette carte est déjà active ou indisponible.');
 if(c.kind==='pact')owner.superTournamentPacts=[...owned(owner).map(p=>p.key),key];else owner.superTournamentNextOpponent=key;
 return {key,name:c.name,description:c.description,duration:c.duration};
}
function reduceNextTeam(owner,team){const c=pending(owner);if(!c)return null;team.pokemons=team.pokemons.slice(-c.count);delete owner.superTournamentNextOpponent;return {key:c.key,name:c.name,count:team.pokemons.length};}
function value(owner,number){return owned(owner).reduce((n,c)=>n+(c.effects.values?.[number]||0),0);}
function signalName(owner,number){return owned(owner).find(c=>c.effects.values?.[number])?.name||null;}
function announce(owner,c,detail){if(!owner?.__preview)require('../drift/driftSignals').named(owner,c.key,c.name,detail);}
function speed(owner){return owned(owner).reduce((n,c)=>{if(c.effects.speed)announce(owner,c,'Vitesse modifiée');return n*(c.effects.speed||1);},1);}
function criticalStage(owner){return Math.min(1,owned(owner).reduce((n,c)=>{if(c.effects.critical)announce(owner,c,'Critiques renforcés');return n+(c.effects.critical||0);},0));}
function multiplier(attackerOwner,defenderOwner,attacker,defender,move){
 const category=move?.combat?.damage_class;if(!['physical','special'].includes(category))return 1;
 let result=1;
 for(const [owner,incoming]of[[attackerOwner,false],[defenderOwner,true]])for(const c of owned(owner)){
  const e=c.effects,prefix=incoming?'incoming':'outgoing';
  let factor=(e[prefix]||1)*(e[prefix+'Type']?.[move.type]||1)*(e[prefix+'Class']?.[category]||1);
  if(!incoming&&e.finisher)factor*=defender.currentHp/Math.max(1,defender.maxHp)<=.35?1.25:.9;
  if(factor!==1){result*=factor;announce(owner,c,incoming?'Dégâts reçus modifiés':'Dégâts infligés modifiés');}
 }
 return result;
}
function unit(random){const n=random();if(!Number.isFinite(n)||n<0||n>=1)throw Error('Tirage de carte invalide.');return n;}
function draw(owner,random,exclude=new Set()){
 const ticket=Math.floor(unit(random)*10000);let card;
 // Absolute chance per offer: 0.5% one opponent, 3% two, 35.2% a bargain.
 if(ticket<50)card=byKey.get('next_opponent_one');
 else if(ticket<350)card=byKey.get('next_opponent_two');
 else if(ticket<3870){const pool=cards.filter(c=>c.kind==='pact'&&usable(owner,c)&&!exclude.has(c.key));if(!pool.length)return null;let roll=unit(random)*pool.reduce((n,c)=>n+(c.rarity==='epic'?1:3),0);card=pool.find(c=>(roll-=c.rarity==='epic'?1:3)<0)||pool.at(-1);}
 return card&&usable(owner,card)&&!exclude.has(card.key)?card.key:null;
}
module.exports={cards,get:key=>byKey.get(key),owned,pending,active,usable,view,activate,reduceNextTeam,value,signalName,speed,criticalStage,multiplier,draw};
