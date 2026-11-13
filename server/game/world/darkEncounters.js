const dc=require('./darkContinent');
const {STAT_KEYS}=require('../models/training');
const {rollK}=require('../models/progression');
const CORRUPTED_CHANCE=.02;
function unit(random){const n=random();if(!Number.isFinite(n)||n<0||n>=1)throw Error('Tirage Dark Continent invalide.');return n;}
function integer(min,max,random){return min+Math.floor(unit(random)*(max-min+1));}
function randomEffort(random=Math.random){
 const weights=Object.fromEntries(STAT_KEYS.map(k=>[k,integer(1,100,random)])),ev=Object.fromEntries(STAT_KEYS.map(k=>[k,0]));let remaining=510;
 while(remaining){const open=STAT_KEYS.filter(k=>ev[k]<252),total=open.reduce((n,k)=>n+weights[k],0),budget=remaining;for(const k of open){const gain=Math.min(remaining,252-ev[k],Math.max(1,Math.floor(budget*weights[k]/total)));ev[k]+=gain;remaining-=gain;if(!remaining)break;}}
 return ev;
}
// Enemy-only traits. No trainer storage, normalization or evolution limit changes.
function prepare(pokemon,map,random=Math.random){
 if(!dc.isMap(map))return 0;
 const corrupted=unit(random)<CORRUPTED_CHANCE;
 pokemon.darkContinentEncounter={version:1,map,kind:corrupted?'corrupted':'ordinary'};
 pokemon.iv=Object.fromEntries(STAT_KEYS.map(k=>[k,corrupted?31:integer(20,28,random)]));
 pokemon.k=corrupted?4:Math.max(2,rollK(random));
 pokemon.ev=corrupted?Object.fromEntries(STAT_KEYS.map(k=>[k,250])):randomEffort(random);
 if(corrupted)pokemon.corruption={version:1,revision:1,permanent:true,modules:{}};
 return corrupted?5:0;
}
function isCorrupted(pokemon,map){return dc.isMap(map)&&pokemon?.darkContinentEncounter?.version===1&&pokemon.darkContinentEncounter.map===map&&pokemon.darkContinentEncounter.kind==='corrupted';}
function experienceMultiplier(pokemon,map){return !dc.isMap(map) ? 1 : isCorrupted(pokemon,map) ? 0.85 : 0.425;}
function money(pokemon,map,ordinary){return isCorrupted(pokemon,map)?10000:ordinary;}
function loot(pokemon,map,random=Math.random){
 if(!isCorrupted(pokemon,map))return null;
 const c=dc.column(map),items=require('../../../data/game/items.json').items,range=[[[5,15],[7,11],[6,7]],[[5,15],[9,16],[6,9]],[[5,15],[13,20],[8,13]]][c];
 const found=['crystal_shard','clear_crystal','aurora_prism'].map((key,i)=>({...items.find(v=>v.key===key),quantity:integer(...range[i],random)})),plates=new Map(),count=integer(1,3,random),types=pokemon.data.type;
 for(let i=0;i<count;i++){const key=dc.plateKey(types[integer(0,types.length-1,random)]);plates.set(key,(plates.get(key)||0)+1);}
 for(const[key,quantity]of plates)found.push({...items.find(v=>v.key===key),quantity});
 return found;
}
module.exports={CORRUPTED_CHANCE,randomEffort,prepare,isCorrupted,experienceMultiplier,money,loot};
