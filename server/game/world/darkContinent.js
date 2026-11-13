const dc2=require('./darkContinent2');
const ITEM='professional_trainer_card',REQUIRED_ROOMS=32,CARD_PRICE=1000000,HEAL_PRICE=10000;
const SURVIVAL_KIT=require('../items/darkSurvivalKit');
const ARRIVAL=Object.freeze({map:'jungle1',x:208,y:368});
const LOBBY=Object.freeze({map:'super_tournament_lobby',x:448,y:496});
const COLUMNS=require('./darkHabitats').LAND;
const CARD_COOLDOWN_MS=5*60*1000, CARD_READY_FLAG='dark_card_ready_at';
const TYPES={Normal:'Normal',Fire:'Feu',Water:'Eau',Electric:'Électrik',Grass:'Plante',Ice:'Glace',Fighting:'Combat',Poison:'Poison',Ground:'Sol',Flying:'Vol',Psychic:'Psy',Bug:'Insecte',Rock:'Roche',Ghost:'Spectre',Dragon:'Dragon',Dark:'Ténèbres',Steel:'Acier',Fairy:'Fée'};
function isMap(map){return dc2.isMap(map)||/^jungle[1-9]$/.test(String(map||''));}
const EXIT_MESSAGE='Le module ne fonctionne pas sur le Dark Continent. Parle au guide de la plage pour rentrer chez toi.';
function assertTravelAllowed(map){if(require('../magicIsland/rules').isMap(map))throw Error('Le module ne fonctionne pas sur l’Île Magique. Parle au passeur près du bateau.');if(isMap(map))throw Error(EXIT_MESSAGE);}
function column(map){return dc2.isMap(map)?2:isMap(map)?(Number(map.slice(6))-1)%3:null;}
const LEVELS=Object.freeze([[100,120],[140,160],[180,200],[135,155],[180,200],[225,245],[170,190],[220,240],[290,300]].map(Object.freeze));
function levels(map){return dc2.isMap(map)?[dc2.maps.get(map).level.min,dc2.maps.get(map).level.max]:isMap(map)?LEVELS[Number(map.slice(6))-1]:null;}
function plateKey(type){return 'dark_plate_'+type.toLowerCase();}
// Shard chances are raised by 50%, capped at 100%; each crystal stack gains one extra unit.
const LOOT_COLUMNS=Object.freeze([
 {crystals:[['crystal_shard',.82875,3,5],['clear_crystal',.425,2,4],['aurora_prism',.255,2,3]],plateChance:.24,ordinaryChance:1/6},
 {crystals:[['crystal_shard',1,4,6],['clear_crystal',.595,3,5],['aurora_prism',.3825,2,4]],plateChance:.31,ordinaryChance:1/5},
 {crystals:[['crystal_shard',1,5,7],['clear_crystal',.68,4,6],['aurora_prism',.4675,3,5]],plateChance:.35,ordinaryChance:1/4}
].map(p=>Object.freeze({...p,crystals:Object.freeze(p.crystals.map(Object.freeze))})));
const JUNGLE9_LOOT=Object.freeze({...LOOT_COLUMNS[2],plateChance:.41});
function lootProfile(map='jungle1'){if(!isMap(map))throw Error('Butin réservé au Dark Continent.');return map==='jungle9'||dc2.isMap(map)?JUNGLE9_LOOT:LOOT_COLUMNS[column(map)];}
const rules=[
 '!!!! DARK CONTINENT : sans kit, chaque Pokémon mis K.O. ici a 50 % de chances d’être définitivement perdu et 50 % de chances de survivre à 0 PV. Aucun Centre spécialisé n’est installé sur cette île : je ne peux assurer que les premiers secours, avant qu’il ne soit trop tard. Ses objets récupérables rejoignent ton sac. Exception : un Kit de survie équipé est consommé et le porteur reste simplement K.O.',
 '!!!! Aucune fuite en combat, même avec Téléport. Les Pokémon de cette île sont trop puissants pour être capturés : une Ball sera perdue si tu essaies.',
 '!!!! Plus tu descends et plus tu avances vers la DROITE, plus le danger augmente : niveaux 100–120 sur la plage du nord-ouest, jusqu’à 290–300 dans la jungle tout au sud-est !',
 'Ils rapportent des Pokédollars comme les Pokémon sauvages du continent principal et 42,5 % de leur XP habituelle (85 % pour les corrompus). Le module d’expérience n’agit pas ici. En revanche, plus tu avances vers l’est, plus les cristaux sont abondants et plus tu as de chances de trouver des plaques et d’autres objets.',
 `Reviens sur cette plage pour soigner les compagnons encore en vie : ${HEAL_PRICE.toLocaleString('fr-FR')} ₽ pour toute l’équipe, y compris un compagnon préservé par un kit. Je ne peux pas sauver un Pokémon déjà perdu. Sans Module Vol obscur activé, le Vol et les téléporteurs sont bloqués ici : parle-moi sur la plage pour rentrer chez toi.`
];
function actor(name,map,x,y,index){return {name,interactionName:name,map,x,y,sprite:'6931.png',spriteFrame:{columns:8,rows:4,index},block:true,roamRadius:0};}
function actors(map,state={}){if(map==='DC2_44')return[actor('dark2_guide',map,13,13,1)];if(map==='jungle1')return[actor('dark_guide',map,6,10,1),actor('dark_researcher',map,9,6,12)];if(map===LOBBY.map&&state.eligible&&!state.owned)return[actor('dark_scout',map,state.scoutAt?.x??11,state.scoutAt?.y??14,6)];return[];}
const research=[
 'Les plaques gardent l’empreinte d’un type de Pokémon. Les cristaux, eux, en sont le réservoir : les Éclats fissurés sont bruts, les Cristaux limpides plus stables, et les Prismes d’aurore particulièrement purs.',
 'Avec suffisamment de ces trois matières et plusieurs plaques identiques, on pourrait reproduire une capacité de son type… ou transmettre un talent provenant d’un Pokémon qui possède ce type.',
 'Il faudrait dix fois plus de cristaux et vingt plaques identiques pour modifier les types d’un Pokémon. Un autre assemblage pourrait renforcer ses attaques d’un type ou sa résistance à ce type, mais cette synthèse serait instable : une chance sur deux d’échouer.',
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
const maxLevel=map=>dc2.isMap(map)?1000:isMap(map)?300:Infinity;
module.exports={maxLevel,EXIT_MESSAGE,assertTravelAllowed,ITEM,REQUIRED_ROOMS,CARD_PRICE,HEAL_PRICE,CARD_COOLDOWN_MS,CARD_READY_FLAG,SURVIVAL_KIT,ARRIVAL,LOBBY,COLUMNS,TYPES,isMap,column,levels,plateKey,lootProfile,rules,research,actors,interactionActor,scopedStore,scoutPath,loot};
