const {TYPES}=require('../world/darkContinent');
const {calendar}=require('../world/safari');
const isMap=map=>/^ile2_0[1-4]$/.test(String(map||''));
const ARRIVAL=Object.freeze({map:'ile2_04',x:80,y:400});
const RETURN=Object.freeze({map:'jungle3',x:144,y:208});
const SPEED_ITEM='mysterious_speed_module',SPEED_FLAG='magic_speed_active',SPEED_FACTOR=1.25;
const EXPEDITION_MS=12*60*60*1000;
const definitions=[['magic_balls','ile2_01',14,14,12],['magic_module','ile2_02',12,16,6],['magic_expedition','ile2_03',13,8,19],['magic_neighbor','ile2_04',14,8,9],['magic_return','ile2_04',4,11,1],['magic_captain','jungle3',3,6,6]];
const casino={name:'casino_croupier',map:'ville5_maison2',x:3,y:4,interactionX:3,interactionY:6,service:'casino'};
function actors(map){return definitions.filter(([,m])=>m===map).map(([name,map,x,y,index])=>({name,interactionName:name,map,x,y,sprite:'6931.png',spriteFrame:{columns:8,rows:4,index},block:true,roamRadius:0}));}
function near(player){if(!player)return null;const x=Math.floor(player.x/32),y=Math.floor(player.y/32);return [...actors(player.currentmap),...(player.currentmap===casino.map?[casino]:[])].find(a=>Math.abs(x-(a.interactionX??a.x))+Math.min(Math.abs(y-(a.interactionY??a.y)),Math.abs(y-(a.interactionY??a.y)+1))<=1)||null;}
function scopedStore(base){const at=(map,x,y)=>actors(map).find(a=>a.x===x&&(a.y===y||a.y-1===y));return{...base,getPnjsForMap:map=>[...base.getPnjsForMap(map),...actors(map)],getPnjAtTile:(map,x,y)=>at(map,x,y)||base.getPnjAtTile(map,x,y),isPnjBlockingTile:(map,x,y)=>Boolean(at(map,x,y))||base.isPnjBlockingTile(map,x,y)};}
function departure(p,direction){if(!isMap(p?.currentmap))return null;const delta={up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]}[direction];if(!delta)return null;const x=Math.floor(p.x/32),y=Math.floor(p.y/32);return x+delta[0]<0||x+delta[0]>=28||y+delta[1]<0||y+delta[1]>=20?require('../world/mapRepository').getNextMap(p.currentmap,x,y,direction):null;}
function ballKey(type){if(!Object.hasOwn(TYPES,type))throw Error('Choisis un type de Ball.');return 'corrupted_ball_'+type.toLowerCase();}
function recipe(type,quantity=1){if(!Number.isInteger(quantity)||quantity<1||quantity>99)throw Error('Choisis entre 1 et 99 Balls.');ballKey(type);return[{key:'dark_plate_'+type.toLowerCase(),quantity:2*quantity},{key:'crystal_shard',quantity:50*quantity},{key:'clear_crystal',quantity:25*quantity},{key:'aurora_prism',quantity:4*quantity}];}
const missions=[
 {key:'veins',title:'Les veines du rocher',hint:'On dit que les pierres précieuses dorment sous les couches les plus dures. Il faudrait des compagnons qui savent creuser… et flairer ce qui brille.',types:['Rock','Ground','Steel'],moves:['Ground','Rock','Steel']},
 {key:'reef',title:'Les lumières du récif',hint:'Les courants ont emporté des caisses près des récifs. L’équipe devra aimer les profondeurs et savoir se repérer quand la lumière manque.',types:['Water','Electric','Dark'],moves:['Water','Electric','Dark']},
 {key:'garden',title:'Le jardin silencieux',hint:'Des fleurs étranges poussent au cœur d’un ancien marais. Je cherche des compagnons à l’aise parmi les plantes, les insectes et les effluves du lieu.',types:['Grass','Bug','Poison'],moves:['Grass','Bug','Poison']},
 {key:'summit',title:'Le souffle des hauteurs',hint:'Une bourrasque a dispersé nos instruments sur les sommets gelés. Il faudra résister au froid et atteindre des endroits que mes bottes ne connaissent pas.',types:['Flying','Ice'],moves:['Flying','Ice']},
 {key:'ruins',title:'Les voix des ruines',hint:'Nos relevés parlent de pierres qui murmurent la nuit. Il nous manque des oreilles un peu particulières… et des compagnons qui ne prennent pas peur facilement.',types:['Psychic','Ghost','Fairy'],moves:['Psychic','Ghost','Fairy']},
 {key:'forge',title:'Les braises anciennes',hint:'Nous cherchons les restes d’une forge enfouie. La chaleur y serait encore forte, et les portes n’ont pas bougé depuis des siècles.',types:['Fire','Fighting','Steel'],moves:['Fire','Fighting','Steel']},
 {key:'trail',title:'Au-delà des traces',hint:'Des empreintes ont été trouvées sur une piste oubliée. J’aurais besoin de compagnons tenaces, capables de suivre un chemin difficile sans perdre leur sang-froid.',types:['Normal','Dragon','Ground'],moves:['Normal','Dragon','Ground']}
];
function daily(now=Date.now()){const date=calendar(now).date,index=Math.floor(Date.UTC(...date.split('-').map((n,i)=>Number(n)-(i===1?1:0)))/86400000)%missions.length;return{...missions[index],date,durationMs:EXPEDITION_MS};}
function assess(team,mission){
 if(!Array.isArray(team)||!team.length||team.length>3||new Set(team.map(p=>p.uuid)).size!==team.length)throw Error('Confie entre un et trois Pokémon différents.');
 const matched=new Set(team.flatMap(p=>p.data.type).filter(t=>mission.types.includes(t)));
 const coverage=matched.size/mission.types.length;
 const moves=require('../battle/battleResources');
 const average=team.reduce((sum,p)=>{const iv=Object.values(p.iv||{}).reduce((a,b)=>a+b,0)/186;const attack=p.abilities.some(m=>mission.moves.includes(moves.getMoveDefinition(m)?.type));return sum+Math.min(1,p.level/250)*.35+Math.min(1,(p.k||1)/4)*.2+iv*.2+(attack?.25:0);},0)/team.length;
 return Math.max(0,Math.min(1,coverage*.6+average*.3+team.length/3*.1));
}
function rewards(score,random=require('node:crypto').randomInt){
 // A strong matching team is reliable; small independent rolls keep expeditions varied.
 const quality=Math.max(0,Math.min(1,score*(.8+random(0,201)/1000)));
 const plates=Math.floor(20*quality),items={crystal_shard:Math.floor(1000*quality),clear_crystal:Math.floor(500*quality),aurora_prism:Math.floor(100*quality)};
 const types=Object.keys(TYPES);for(let i=0;i<plates;i++){const key='dark_plate_'+types[random(0,types.length)].toLowerCase();items[key]=(items[key]||0)+1;}
 return{money:Math.floor(2000000*quality),items,quality};
}
module.exports={TYPES,ARRIVAL,RETURN,SPEED_ITEM,SPEED_FLAG,SPEED_FACTOR,EXPEDITION_MS,isMap,actors,near,scopedStore,departure,ballKey,recipe,daily,assess,rewards};
