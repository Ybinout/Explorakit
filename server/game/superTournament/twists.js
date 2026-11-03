const stacks=require('./cardStacks');
const {getMoveDefinition}=require('../battle/battleResources');
// Server-owned, attempt-only bargains. No Adventure stats, items or moves are changed.
const pact = (key,name,rarity,boon,cost,effects) => ({key:'pact_'+key,name,rarity,kind:'pact',target:'run',boon,cost,effects,description:`${boon} En contrepartie : ${cost}`,duration:'Toute la tentative'});
const cards=Object.freeze([
 pact('hunter','Œil du chasseur','epic','Coups critiques plus fréquents (+1 niveau, maximum +3 avec les pactes).','Dégâts Eau reçus : +25 %.',{critical:1,incomingType:{Water:1.25}}),
 pact('cold_blood','Sang-froid','epic','Coups critiques plus fréquents (+1 niveau, maximum +3 avec les pactes).','Vitesse : −10 %.',{critical:1,speed:.9}),
 pact('glass','Lame de verre','rare','Dégâts de tes attaques : +15 %.','Dégâts des attaques ennemies : +15 %.',{outgoing:1.15,incoming:1.15}),
 pact('blaze','Brasier ardent','rare','Dégâts Feu infligés : +25 %.','Dégâts Eau reçus : +30 %.',{outgoingType:{Fire:1.25},incomingType:{Water:1.3}}),
 pact('tide','Marée profonde','rare','Dégâts Eau infligés : +25 %.','Dégâts Électrik reçus : +30 %.',{outgoingType:{Water:1.25},incomingType:{Electric:1.3}}),
 pact('garden','Jardin sauvage','rare','Dégâts Plante infligés : +25 %.','Dégâts Feu reçus : +30 %.',{outgoingType:{Grass:1.25},incomingType:{Fire:1.3}}),
 pact('voltage','Haute tension','rare','Dégâts Électrik infligés : +25 %.','Dégâts Sol reçus : +30 %.',{outgoingType:{Electric:1.25},incomingType:{Ground:1.3}}),
 pact('winter','Hiver mordant','rare','Dégâts Glace infligés : +25 %.','Dégâts Combat reçus : +30 %.',{outgoingType:{Ice:1.25},incomingType:{Fighting:1.3}}),
 pact('dragon','Héritage draconique','rare','Dégâts Dragon infligés : +25 %.','Dégâts Fée reçus : +30 %.',{outgoingType:{Dragon:1.25},incomingType:{Fairy:1.3}}),
 pact('fairy','Poussière féerique','rare','Dégâts Fée infligés : +25 %.','Dégâts Acier reçus : +30 %.',{outgoingType:{Fairy:1.25},incomingType:{Steel:1.3}}),
 pact('heavy_fist','Poing lourd','rare','Dégâts physiques infligés : +20 %.','Vitesse : −10 %.',{outgoingClass:{physical:1.2},speed:.9}),
 pact('mind','Esprit incandescent','rare','Dégâts spéciaux infligés : +20 %.','Dégâts physiques infligés : −20 %.',{outgoingClass:{special:1.2,physical:.8}}),
 pact('soldier','Instinct du combattant','rare','Dégâts physiques infligés : +20 %.','Dégâts spéciaux infligés : −20 %.',{outgoingClass:{physical:1.2,special:.8}}),
 pact('dance','Danse du risque','epic','Vitesse : +15 %.','Dégâts des attaques ennemies : +15 %.',{speed:1.15,incoming:1.15}),
 pact('rampart','Rempart pesant','rare','Dégâts physiques reçus : −15 %.','Vitesse : −10 %.',{incomingClass:{physical:.85},speed:.9}),
 pact('veil','Voile fragile','rare','Dégâts spéciaux reçus : −15 %.','Dégâts physiques reçus : +15 %.',{incomingClass:{special:.85,physical:1.15}}),
 pact('leech','Soif de vie','epic','Ton Pokémon récupère en PV 10 % des dégâts de ses attaques.','Dégâts Feu reçus : +25 %.',{values:{5:10},incomingType:{Fire:1.25}}),
 pact('breath','Souffle patient','epic','Récupère 3 % des PV maximum en fin de tour.','Vitesse : −10 %.',{values:{16:3},speed:.9}),
 pact('execution','Instinct du finisseur','rare','Tes attaques font +25 % de dégâts si l’ennemi a 35 % de PV ou moins.','Elles font −10 % de dégâts s’il lui reste plus de 35 % de PV.',{finisher:true}),
 pact('fortress','Force tranquille','rare','Dégâts des attaques ennemies : −12 %.','Dégâts de tes attaques : −10 %.',{incoming:.88,outgoing:.9}),
 pact('velvet','Crocs de velours','rare','Récupère 6 % des dégâts infligés par ses attaques en PV.','Dégâts des attaques ennemies : +5 %.',{values:{5:6},incoming:1.05}),
 pact('moss','Peau de mousse','rare','Récupère 2 % des PV maximum en fin de tour.','Dégâts Feu reçus : +8 %.',{values:{16:2},incomingType:{Fire:1.08}}),
 pact('opening','Élan d’ouverture','rare','Tes attaques font +15 % de dégâts quand ton Pokémon a tous ses PV.','Vitesse : −3 %.',{fullHealth:1.15,speed:.97}),
 pact('last_stand','Courage obstiné','rare','Tes attaques font +18 % de dégâts quand ton Pokémon a 50 % de PV ou moins.','Dégâts des attaques ennemies : +5 %.',{desperate:1.18,incoming:1.05}),
 pact('quickstep','Pas de côté','rare','Vitesse : +8 %.','Dégâts des attaques ennemies : +6 %.',{speed:1.08,incoming:1.06}),
 pact('spark','Coup d’éclat','epic','Coups critiques plus fréquents (+1 niveau, maximum +3 avec les pactes).','Dégâts de tes attaques : −5 %.',{critical:1,outgoing:.95}),
 pact('resupply','Ravitaillement discret','epic','Après une victoire, rend 1 PP à chaque capacité des Pokémon aptes.','Dégâts des attaques ennemies : +6 %.',{victoryPp:1,incoming:1.06}),
 pact('campfire','Feu de camp','rare','Après une victoire, rend 8 % des PV maximum à chaque Pokémon apte.','Vitesse : −4 %.',{victoryHeal:.08,speed:.96}),
 pact('pebble','Petit élan','common','Dégâts de tes attaques : +4 %.','Dégâts des attaques ennemies : +3 %.',{outgoing:1.04,incoming:1.03}),
 pact('feather','Semelles légères','common','Vitesse : +4 %.','Dégâts de tes attaques : −2 %.',{speed:1.04,outgoing:.98}),
 pact('patchwork','Veste rapiécée','common','Dégâts physiques reçus : −4 %.','Dégâts spéciaux reçus : +3 %.',{incomingClass:{physical:.96,special:1.03}}),
 pact('umbrella','Petit parapluie','common','Dégâts spéciaux reçus : −4 %.','Dégâts physiques reçus : +3 %.',{incomingClass:{special:.96,physical:1.03}}),
 pact('snack','Petit creux','common','Récupère 2 % des dégâts infligés par ses attaques en PV.','Dégâts des attaques ennemies : +2 %.',{values:{5:2},incoming:1.02}),
 pact('picnic','Goûter de victoire','common','Après une victoire, rend 3 % des PV maximum aux Pokémon aptes.','Vitesse : −1 %.',{victoryHeal:.03,speed:.99}),
 pact('fresh_start','Bien réveillé','common','Tes attaques font +6 % de dégâts quand ton Pokémon a tous ses PV.','Dégâts des attaques ennemies : +2 %.',{fullHealth:1.06,incoming:1.02}),
 pact('grit','Petit courage','common','Tes attaques font +6 % de dégâts quand ton Pokémon a 50 % de PV ou moins.','Dégâts des attaques ennemies : +2 %.',{desperate:1.06,incoming:1.02}),
 pact('pixie','Paillette féerique','common','Dégâts Fée infligés : +6 %.','Dégâts Poison reçus : +4 %.',{outgoingType:{Fairy:1.06},incomingType:{Poison:1.04}}),
 pact('palette','Jeu de couleurs','common','Changer de type d’attaque donne +5 % de dégâts. Exemple : Eau puis Feu.','Répéter le même type retire 2 % de dégâts. La première attaque n’a ni bonus ni malus.',{changeType:{different:1.05,same:.98}}),
 {key:'next_opponent_two',name:'Duel écourté',rarity:'epic',kind:'opponent',target:'run',count:2,description:'Le prochain dresseur ne garde que ses deux derniers Pokémon, dont son plus fort. Valable pour un seul combat.',duration:'Prochain combat seulement'},
 {key:'next_opponent_one',name:'Face au dernier rempart',rarity:'legendary',kind:'opponent',target:'run',count:1,description:'Le prochain dresseur ne garde que son dernier Pokémon, le plus fort. Valable pour un seul combat.',duration:'Prochain combat seulement'}
].map(c=>Object.freeze({...c,twist:true,rarityName:({common:'Commune',uncommon:'Peu commune',rare:'Rare',epic:'Épique',legendary:'Légendaire'})[c.rarity]})));
const byKey=new Map(cards.map(c=>[c.key,c]));
const enabled=owner=>owner?.currentmap==='super_tournament_room';
const cached=new WeakMap(),empty=Object.freeze([]);
function count(owner,key){return stacks.count(owner,key,'superTournamentPacts','superTournamentPactStacks');}
function owned(owner){if(!enabled(owner))return empty;const keys=owner.superTournamentPacts,counts=owner.superTournamentPactStacks,previous=cached.get(owner);if(previous&&previous.keys===keys&&previous.counts===counts)return previous.cards;const result=Object.freeze([...new Set(keys||[])].map(k=>byKey.get(k)).filter(c=>c?.kind==='pact'));cached.set(owner,{keys,counts,cards:result});return result;}
function pending(owner){const c=enabled(owner)?byKey.get(owner.superTournamentNextOpponent):null;return c?.kind==='opponent'?c:null;}
function usable(owner,card){return Boolean(enabled(owner)&&card&&(card.kind==='pact'?count(owner,card.key)<stacks.LIMIT&&(!card.effects.critical||criticalStage(owner)<3):!pending(owner)));}
const typeNames={Normal:'Normal',Fire:'Feu',Water:'Eau',Electric:'Électrik',Grass:'Plante',Ice:'Glace',Fighting:'Combat',Poison:'Poison',Ground:'Sol',Flying:'Vol',Psychic:'Psy',Bug:'Insecte',Rock:'Roche',Ghost:'Spectre',Dragon:'Dragon',Dark:'Ténèbres',Steel:'Acier',Fairy:'Fée'};
function summary(card,n){const e=card.effects||{},parts=[],effect=(label,factor)=>{if(factor!==1)parts.push(`${label} ${factor>1?'+':'−'}${(Math.round(Math.abs(factor-1)*10000)/100).toLocaleString('fr-FR')} %`);};
 for(const [key,label]of[['outgoing','Dégâts de tes attaques'],['incoming','Dégâts des attaques ennemies'],['speed','Vitesse']])if(e[key])effect(label,stacks.factor(e[key],n));
 for(const [key,label]of[['outgoingType','Dégâts infligés'],['incomingType','Dégâts reçus'],['outgoingClass','Dégâts infligés'],['incomingClass','Dégâts reçus']])for(const [kind,v]of Object.entries(e[key]||{}))effect(`${label} ${typeNames[kind]||{physical:'physiques',special:'spéciaux'}[kind]||kind}`,stacks.factor(v,n));
 if(e.critical)parts.push(`Critiques +${Math.min(3,e.critical*n)} niveau(x)`);
 if(e.values?.[5])parts.push(`PV récupérés : ${e.values[5]*n} % des dégâts de tes attaques`);if(e.values?.[16])parts.push(`Récupère ${e.values[16]*n} % des PV à chaque fin de tour`);
 if(e.victoryHeal)parts.push(`Soin de victoire ${Math.round(e.victoryHeal*n*10000)/100} % PV`);if(e.victoryPp)parts.push(`Victoire +${e.victoryPp*n} PP/capacité`);
 if(e.fullHealth)effect('Dégâts avec tous tes PV',stacks.factor(e.fullHealth,n));if(e.desperate)effect('Dégâts avec 50 % de PV ou moins',stacks.factor(e.desperate,n));
 if(e.finisher){effect('Dégâts sur un ennemi à 35 % de PV ou moins',stacks.factor(1.25,n));effect('Dégâts sur un ennemi à plus de 35 % de PV',stacks.factor(.9,n));}
 if(e.changeType){effect('Changer de type d’attaque',stacks.factor(e.changeType.different,n));effect('Répéter le même type d’attaque',stacks.factor(e.changeType.same,n));}
 return parts.join(' · ');
}
function view(card,owner){const n=count(owner,card.key);return {key:card.key,name:card.name,rarity:card.rarity,rarityName:card.rarityName,kind:card.kind,target:card.target,boon:card.boon,cost:card.cost,description:card.description,duration:card.duration,targets:[],usable:usable(owner,card),...(card.kind==='pact'?{stackable:true,stacks:n,nextStacks:n+1,cumulativeDescription:summary(card,n+1)}:{})};}
function active(owner){return [...owned(owner),...(pending(owner)?[pending(owner)]:[])].map(c=>({key:c.key,name:c.name,description:c.description,rarity:c.rarity,boon:c.boon,cost:c.cost,duration:c.duration,...(c.kind==='pact'?{stackable:true,stacks:count(owner,c.key),cumulativeDescription:summary(c,count(owner,c.key))}:{})}));}
function activate(owner,key){const c=byKey.get(key);if(!c||!usable(owner,c))throw Error('Cette carte est déjà active ou indisponible.');let n;
 if(c.kind==='pact')n=stacks.add(owner,key,'superTournamentPacts','superTournamentPactStacks');else owner.superTournamentNextOpponent=key;
 return {key,name:c.name,description:c.description,duration:c.duration,...(n?{stacks:n,stackable:true,cumulativeDescription:summary(c,n)}:{})};
}
function reduceNextTeam(owner,team){const c=pending(owner);if(!c)return null;team.pokemons=team.pokemons.slice(-c.count);delete owner.superTournamentNextOpponent;return {key:c.key,name:c.name,count:team.pokemons.length};}
function value(owner,number){return owned(owner).reduce((n,c)=>n+(c.effects.values?.[number]||0)*count(owner,c.key),0);}
function signalName(owner,number){return owned(owner).find(c=>c.effects.values?.[number])?.name||null;}
function announce(owner,c,detail){if(!owner?.__preview)require('../drift/driftSignals').named(owner,c.key,c.name,detail);}
function speed(owner){return owned(owner).reduce((n,c)=>{if(c.effects.speed)announce(owner,c,'Vitesse modifiée');return Math.max(1e-6,Math.min(1e6,n*stacks.factor(c.effects.speed||1,count(owner,c.key))));},1);}
function criticalStage(owner){return Math.min(3,owned(owner).reduce((n,c)=>{if(c.effects.critical)announce(owner,c,'Critiques renforcés');return n+(c.effects.critical||0)*count(owner,c.key);},0));}
function multiplier(attackerOwner,defenderOwner,attacker,defender,move){
 const category=move?.combat?.damage_class;if(!['physical','special'].includes(category))return 1;
 let result=1;
 for(const [owner,incoming]of[[attackerOwner,false],[defenderOwner,true]])for(const c of owned(owner)){
  const e=c.effects,prefix=incoming?'incoming':'outgoing';
  let factor=(e[prefix]||1)*(e[prefix+'Type']?.[move.type]||1)*(e[prefix+'Class']?.[category]||1);
  if(!incoming&&e.finisher)factor*=defender.currentHp/Math.max(1,defender.maxHp)<=.35?1.25:.9;
  if(!incoming&&e.changeType){const last=getMoveDefinition(attacker.__battle?.lastMoveUsed);if(last)factor*=last.type!==move.type?e.changeType.different:e.changeType.same;}
  if(!incoming&&e.fullHealth&&attacker.currentHp>=attacker.maxHp)factor*=e.fullHealth;
  if(!incoming&&e.desperate&&attacker.currentHp/Math.max(1,attacker.maxHp)<=.5)factor*=e.desperate;
  if(factor!==1){result=Math.max(1e-6,Math.min(1e6,result*stacks.factor(factor,count(owner,c.key))));announce(owner,c,incoming?'Dégâts reçus modifiés':'Dégâts infligés modifiés');}
 }
 return result;
}
function afterWin(owner){
 const list=owned(owner),hp=list.reduce((n,c)=>n+(c.effects.victoryHeal||0)*count(owner,c.key),0),pp=list.reduce((n,c)=>n+(c.effects.victoryPp||0)*count(owner,c.key),0),changes=[];
 if(!hp&&!pp)return changes;
 const {getMaxMovePp}=require('../battle/battleResources');
 for(const p of owner.equipe.pokemons){if(p.currentHp<=0)continue;const before=p.currentHp,moves=[];
  if(hp)p.currentHp=Math.min(p.maxHp,p.currentHp+Math.max(1,Math.floor(p.maxHp*hp)));
  if(pp){p.movePp=p.abilities.map((name,i)=>{const max=getMaxMovePp(name),old=p.movePp?.[i]??max,next=Math.min(max,old+pp);if(next>old)moves.push({index:i,name,amount:next-old});return next;});}
  if(p.currentHp>before||moves.length)changes.push({uuid:p.uuid,name:p.name||p.truename,amount:p.currentHp-before,moves});
 }
 return changes;
}
function unit(random){const n=random();if(!Number.isFinite(n)||n<0||n>=1)throw Error('Tirage de carte invalide.');return n;}
function draw(owner,random,exclude=new Set()){
 const ticket=Math.floor(unit(random)*10000);let card;
 // Absolute chance per offer: 0.5% one opponent, 3% two, 35.2% a bargain.
 if(ticket<50)card=byKey.get('next_opponent_one');
 else if(ticket<350)card=byKey.get('next_opponent_two');
 else if(ticket<3870){const pool=cards.filter(c=>c.kind==='pact'&&usable(owner,c)&&!(owner.superTournamentFortune&&c.rarity==='common')&&!exclude.has(c.key));if(!pool.length)return null;let roll=unit(random)*pool.reduce((n,c)=>n+(c.rarity==='epic'?1:c.rarity==='common'?5:3),0);card=pool.find(c=>(roll-=c.rarity==='epic'?1:c.rarity==='common'?5:3)<0)||pool.at(-1);}
 return card&&usable(owner,card)&&!exclude.has(card.key)?card.key:null;
}
module.exports={cards,get:key=>byKey.get(key),count,owned,pending,active,usable,view,activate,reduceNextTeam,value,signalName,speed,criticalStage,multiplier,afterWin,draw};
