const config=require('../../../data/game/dark_continent2.json');
const ITEM='dark_exploration_chart',FOUND='dc2_chart_found',ARRIVED='dc2_arrived',WON='dc2_final_won';
const maps=new Map(config.maps.map(m=>[m.mapName,m]));
const isMap=map=>maps.has(map);
function coordinates(map){const m=maps.get(map);return m?{col:m.col,row:m.row}:null;}
function islandName({chartOwned=false,revealed=false}={},en=false){return chartOwned?(en?'Dark Continent Island':'Île du Dark Continent'):revealed?'Dark Continent ?':'Dark Continent';}
function difficulty(level,final=false){const ratio=level/300;return {id:final?'dc2-final':'dc2-'+level,name:final?'Faille finale':'Terres oubliées',level,maps:[],scale:final?4.5:2.2+(level-300)/700*.8,reward:Math.round(1000000*ratio),pearl:.05*ratio,plateChance:1,quantityScale:ratio,hp:10};}
function eligibleChart(rift){return rift?.training!==true&&/^jungle[1-9]$/.test(rift?.map||'')&&rift?.difficulty==='extreme';}
function isFinal(rift){return rift?.training!==true&&rift?.anchor==='dark2:final'&&rift.map===config.final.map&&rift.difficulty==='dc2-final'&&rift.fixed===true;}
const rules=[
 'Sans kit, chaque K.O. entraîne un tirage indépendant : 50 % de perte définitive, 50 % de survie à 0 PV. Un Kit de survie équipé est consommé à sa place : le compagnon reste K.O. et pourra être soigné après son retour.',
 'Aucun Centre spécialisé ne peut intervenir sur ce territoire. Le guide de la plage peut soigner les compagnons encore en vie. Les kits doivent être équipés avant de partir au combat. Les objets récupérables des compagnons perdus rejoignent ton sac.',
 'Les rencontres et les failles vont du niveau 300 au niveau 1 000. Plus tu te rapproches de la pyramide au nord, plus les adversaires sont puissants.',
 'Active le Module mystérieux de vitesse pour pouvoir fuir les rencontres sauvages. Les capacités de fuite restent sans effet ici. Pour capturer un Pokémon sauvage, utilise une Ball Corrompue du bon type, ou une Master Ball. Seule la Master Ball capture les Élites, avec remise à zéro de leurs EV. Sans Module Vol obscur activé, les modules de voyage sont bloqués : reviens me voir sur cette plage pour rentrer chez toi.'
];
module.exports={config,maps,ITEM,FOUND,ARRIVED,WON,isMap,coordinates,islandName,difficulty,eligibleChart,isFinal,rules};
