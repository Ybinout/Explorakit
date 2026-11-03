const ITEM='professional_trainer_card',REQUIRED_ROOMS=48,CARD_PRICE=2000000,HEAL_PRICE=10000;
const ARRIVAL=Object.freeze({map:'jungle1',x:208,y:368});
const LOBBY=Object.freeze({map:'super_tournament_lobby',x:448,y:496});
const COLUMNS=require('./darkHabitats').LAND;
const CARD_COOLDOWN_MS=5*60*1000, CARD_READY_FLAG='dark_card_ready_at';
const TYPES={Normal:'Normal',Fire:'Feu',Water:'Eau',Electric:'Électrik',Grass:'Plante',Ice:'Glace',Fighting:'Combat',Poison:'Poison',Ground:'Sol',Flying:'Vol',Psychic:'Psy',Bug:'Insecte',Rock:'Roche',Ghost:'Spectre',Dragon:'Dragon',Dark:'Ténèbres',Steel:'Acier',Fairy:'Fée'};
function isMap(map){return /^jungle[1-9]$/.test(String(map||''));}
const EXIT_MESSAGE='Le module ne fonctionne pas sur le Dark Continent. Parle au guide de la plage pour rentrer chez toi.';
function assertTravelAllowed(map){if(isMap(map))throw Error(EXIT_MESSAGE);}
function column(map){return isMap(map)?(Number(map.slice(6))-1)%3:null;}
function levels(map){return [[100,120],[120,150],[150,200]][column(map)] || null;}
function plateKey(type){return 'dark_plate_'+type.toLowerCase();}
const LOOT_COLUMNS=Object.freeze([
 {crystals:[['crystal_shard',.65,2,4],['clear_crystal',.50,1,3],['aurora_prism',.30,1,2]],plateChance:.03,ordinaryChance:1/6},
 {crystals:[['crystal_shard',.9,3,5],['clear_crystal',.7,2,4],['aurora_prism',.45,1,3]],plateChance:.10,ordinaryChance:1/5},
 {crystals:[['crystal_shard',1,4,6],['clear_crystal',.8,3,5],['aurora_prism',.55,2,4]],plateChance:.14,ordinaryChance:1/4}
].map(p=>Object.freeze({...p,crystals:Object.freeze(p.crystals.map(Object.freeze))})));
function lootProfile(map='jungle1'){if(!isMap(map))throw Error('Butin réservé au Dark Continent.');return LOOT_COLUMNS[column(map)];}
const rules=[
 '!!!! DARK CONTINENT : un Pokémon mis K.O. ici est définitivement perdu. Aucun Centre spécialisé n’est installé sur cette île : je ne peux assurer que les premiers secours, avant qu’il ne soit trop tard. Ses objets récupérables rejoignent ton sac.',
 '!!!! Aucune fuite en combat, même avec Téléport. Les Pokémon de cette île sont trop puissants pour être capturés : une Ball sera perdue si tu essaies.',
 '!!!! Plus tu avances vers la DROITE, plus le danger augmente : niveaux 100–120 à l’ouest, 120–150 au centre, 150–200 à l’est !',
 'Ils rapportent des Pokédollars comme les Pokémon sauvages du continent principal et 50 % de leur XP habituelle. Le module d’expérience n’agit pas ici. En revanche, plus tu avances vers l’est, plus les cristaux sont abondants et plus tu as de chances de trouver des plaques et d’autres objets.',
 `Reviens sur cette plage pour soigner les compagnons encore en vie : ${HEAL_PRICE.toLocaleString('fr-FR')} ₽ pour toute l’équipe. Je ne peux pas sauver un Pokémon déjà perdu. Ni le module Vol ni les téléporteurs ne permettent de quitter l’île : parle-moi sur la plage pour rentrer chez toi.`
];
function actor(name,map,x,y,index){return {name,interactionName:name,map,x,y,sprite:'6931.png',spriteFrame:{columns:8,rows:4,index},block:true,roamRadius:0};}
function actors(map,state={}){if(map==='jungle1')return[actor('dark_guide',map,6,10,1),actor('dark_researcher',map,9,6,12)];if(map===LOBBY.map&&state.eligible&&!state.owned)return[actor('dark_scout',map,state.scoutAt?.x??11,state.scoutAt?.y??14,6)];return[];}
const research=[
 'Les plaques gardent l’empreinte d’un type de Pokémon. Les cristaux, eux, en sont le réservoir : les Éclats fissurés sont bruts, les Cristaux limpides plus stables, et les Prismes d’aurore particulièrement purs.',
 'Avec suffisamment de ces trois matières autour d’une plaque, on pourrait reproduire une capacité de son type… ou transmettre un talent provenant d’un Pokémon qui possède ce type.',
 'Il faudrait dix fois plus de matière, plaques comprises, pour modifier les types d’un Pokémon. Un autre assemblage pourrait renforcer ses attaques d’un type ou sa résistance à ce type, mais cette synthèse serait instable : une chance sur deux d’échouer.',
 'Ces mutations laisseraient une trace définitive. Un compagnon pourrait porter quatre assemblages différents, un de chaque sorte, mais je ne garderais pas deux compagnons corrompus dans une même équipe.',
 'Si le matériel nécessaire existait, nous pourrions peut-être réaliser tout cela… Encore faudrait-il trouver quelqu’un qui ait étudié ces cristaux assez longtemps.'
];
function interactionActor(player,state){
 const x=Math.floor(player.x/32),y=Math.floor(player.y/32),delta={up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]}[player.direction];
 const distance=a=>Math.abs(x-a.x)+Math.min(Math.abs(y-a.y),Math.abs(y-(a.y-1)));
 const list=actors(player.currentmap,state).filter(a=>distance(a)<=1);
 return (delta&&list.find(a=>a.x===x+delta[0]&&(a.y===y+delta[1]||a.y-1===y+delta[1])))||list.sort((a,b)=>distance(a)-distance(b))[0];
}
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
function loot(pokemon,random=Math.random,map='jungle1'){const special=require('./darkEncounters').loot(pokemon,map,random);if(special)return special;const found=[],profile=lootProfile(map);const items=require('../../../data/game/items.json').items;
 for(const[key,chance,min,max]of profile.crystals)if(random()<chance){const item=items.find(i=>i.key===key);found.push({...item,quantity:min+Math.min(max-min,Math.floor(random()*(max-min+1)))});}
 if(random()<profile.plateChance){const types=pokemon.data.type,type=types[Math.min(types.length-1,Math.floor(random()*types.length))];found.push({...items.find(i=>i.key===plateKey(type)),quantity:1});}return found;
}
module.exports={EXIT_MESSAGE,assertTravelAllowed,ITEM,REQUIRED_ROOMS,CARD_PRICE,HEAL_PRICE,CARD_COOLDOWN_MS,CARD_READY_FLAG,ARRIVAL,LOBBY,COLUMNS,TYPES,isMap,column,levels,plateKey,lootProfile,rules,research,actors,interactionActor,scopedStore,scoutPath,loot};
