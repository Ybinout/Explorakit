const ITEM='professional_trainer_card',REQUIRED_ROOMS=48,CARD_PRICE=2000000,HEAL_PRICE=50000;
const ARRIVAL=Object.freeze({map:'jungle1',x:208,y:368});
const LOBBY=Object.freeze({map:'super_tournament_lobby',x:448,y:496});
const COLUMNS=[
 [3,6,9,65,68,94,130,143,181,212,229,242],
 [248,254,257,260,282,306,330,350,389,392,395,398],
 [373,376,405,407,445,448,450,452,464,468,473,477]
];
const TYPES={Normal:'Normal',Fire:'Feu',Water:'Eau',Electric:'Électrik',Grass:'Plante',Ice:'Glace',Fighting:'Combat',Poison:'Poison',Ground:'Sol',Flying:'Vol',Psychic:'Psy',Bug:'Insecte',Rock:'Roche',Ghost:'Spectre',Dragon:'Dragon',Dark:'Ténèbres',Steel:'Acier',Fairy:'Fée'};
function isMap(map){return /^jungle[1-9]$/.test(String(map||''));}
function column(map){return isMap(map)?(Number(map.slice(6))-1)%3:null;}
function levels(map){return [[100,120],[120,150],[150,200]][column(map)] || null;}
function plateKey(type){return 'dark_plate_'+type.toLowerCase();}
const rules=[
 '!!!! DARK CONTINENT : un Pokémon mis K.O. ici est définitivement perdu. Aucun Centre spécialisé n’est installé sur cette île : je ne peux assurer que les premiers secours, avant qu’il ne soit trop tard. Ses objets récupérables rejoignent ton sac.',
 '!!!! Aucune fuite en combat, même avec Téléport. Les Pokémon de cette île sont trop puissants pour être capturés : une Ball sera perdue si tu essaies.',
 '!!!! Plus tu avances vers la DROITE, plus le danger augmente : niveaux 100–120 à l’ouest, 120–150 au centre, 150–200 à l’est !',
 'Ils ne donnent pas de Pokédollars et seulement 10 % de leur XP habituelle. Le module d’expérience n’agit pas ici. En revanche, ils peuvent laisser des plaques et davantage de cristaux.',
 'Reviens sur cette plage pour soigner les compagnons encore en vie : 50 000 ₽ pour toute l’équipe. Je ne peux pas sauver un Pokémon déjà perdu. Ta carte professionnelle permet de retourner à l’accueil du tournoi hors combat.'
];
function actor(name,map,x,y,index){return {name,interactionName:name,map,x,y,sprite:'6931.png',spriteFrame:{columns:8,rows:4,index},block:true,roamRadius:0};}
function actors(map,state={}){if(map==='jungle1')return[actor('dark_guide',map,6,10,1)];if(map===LOBBY.map&&state.eligible&&!state.owned)return[actor('dark_scout',map,state.scoutAt?.x??11,state.scoutAt?.y??14,6)];return[];}
function scopedStore(base,getState){const at=(map,x,y)=>actors(map,getState()).find(n=>n.x===x&&(n.y===y||n.y-1===y));return{...base,getPnjsForMap:map=>[...base.getPnjsForMap(map),...actors(map,getState())],getPnjAtTile:(map,x,y)=>at(map,x,y)||base.getPnjAtTile(map,x,y),isPnjBlockingTile:(map,x,y)=>Boolean(at(map,x,y))||base.isPnjBlockingTile(map,x,y)};}
// A private scout follows walkable floor, stopping beside the returning trainer.
function scoutPath(grid,goal){
 const start={x:11,y:14};if(start.x===goal.x&&Math.abs(start.y-goal.y)<=1)start.x=10;
 const queue=[{...start,path:[{...start}]}],seen=new Set();
 for(const at of queue){const key=at.x+':'+at.y;if(seen.has(key)||grid[at.y]?.[at.x]!==0||at.x===goal.x&&at.y===goal.y)continue;seen.add(key);
  if(Math.abs(at.x-goal.x)+Math.abs(at.y-goal.y)<=1)return at.path;
  for(const[dx,dy]of[[1,0],[0,1],[-1,0],[0,-1]])queue.push({x:at.x+dx,y:at.y+dy,path:[...at.path,{x:at.x+dx,y:at.y+dy}]});
 }return[start];
}
function loot(pokemon,random=Math.random){const found=[];const items=require('../../../data/game/items.json').items;
 for(const[key,chance,min,max]of[['crystal_shard',.8,2,4],['clear_crystal',.6,1,3],['aurora_prism',.35,1,2]])if(random()<chance){const item=items.find(i=>i.key===key);found.push({...item,quantity:min+Math.min(max-min,Math.floor(random()*(max-min+1)))});}
 if(random()<.07){const types=pokemon.data.type,type=types[Math.min(types.length-1,Math.floor(random()*types.length))];found.push({...items.find(i=>i.key===plateKey(type)),quantity:1});}return found;
}
module.exports={ITEM,REQUIRED_ROOMS,CARD_PRICE,HEAL_PRICE,ARRIVAL,LOBBY,COLUMNS,TYPES,isMap,column,levels,plateKey,rules,actors,scopedStore,scoutPath,loot};
