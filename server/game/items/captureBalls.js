const {currentTypes}=require('../battle/pokemonTypes');
const dark=require('../world/darkContinent');
const hours=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Paris',hour:'2-digit',hourCycle:'h23'});
function isNight(now=Date.now()){const hour=Number(hours.format(new Date(now)));return hour>=18||hour<7;}
function context(pokemon,{map,turn=1,fishing=false,caught=false,now=Date.now()}={}){return{map,turn,fishing,caught,night:isNight(now),cave:/^cave/.test(map||''),types:currentTypes(pokemon),elite:pokemon?.darkContinentEncounter?.kind==='corrupted'||Boolean(pokemon?.corruption?.permanent)};}
function validate(ball,pokemon,ctx={}){
 if(!ball||ball.category!=='ball')throw Error('Choisis une Ball.');
 if(dark.isMap(ctx.map)&&!ball.corruptedBallType&&ball.captureEffect!=='master')throw Error('Utilise des Balls Corrompues ou une Master Ball sur le Dark Continent.');
 if(ball.corruptedBallType){
  if(!dark.isMap(ctx.map))throw Error('Les Balls Corrompues fonctionnent uniquement sur le Dark Continent.');
  if(ctx.elite)throw Error('Les Pokémon Élites nécessitent une Master Ball.');
  if(!(ctx.types||currentTypes(pokemon)).includes(ball.corruptedBallType))throw Error('Le Pokémon ne possède pas le type de cette Ball Corrompue.');
 }
}
function multiplier(ball,pokemon,ctx={}){
 switch(ball.captureEffect){
  case 'dive':return ctx.fishing?3.5:1;
  case 'dusk':return ctx.cave||ctx.night?3:1;
  case 'timer':return Math.min(4,1+Math.max(0,(ctx.turn||1)-1)*1229/4096);
  case 'net':return (ctx.types||currentTypes(pokemon)).some(t=>['Water','Bug'].includes(t))?3.5:1;
  case 'nest':return Math.max(1,Math.min(4,(41-pokemon.level)/10));
  case 'repeat':return ctx.caught?3.5:1;
  case 'quick':return ctx.turn===1?5:1;
  default:return Number(ball.catch_multiplier)||1;
 }
}
function fixedChance(ball,ctx){if(ball.captureEffect==='master')return 1;if(dark.isMap(ctx.map))return ball.corruptedBallType&&!ctx.elite?0.3:0;return null;}
function needsStorage(pokemon,team){return team.length>=6||Boolean(pokemon?.corruption?.permanent)&&team.some(p=>p.corruption?.permanent);}
function prepareCaptured(pokemon,ball,random=Math.random){
 if(ball.corruptedBallType||ball.captureEffect==='master'&&context(pokemon).elite){
  if(ball.corruptedBallType){pokemon.iv=Object.fromEntries(['hp','attack','defense','specialAttack','specialDefense','speed'].map(k=>[k,Math.min(31,Math.floor(random()*32))]));pokemon.corruption=null;}
  pokemon.ev={hp:0,attack:0,defense:0,specialAttack:0,specialDefense:0,speed:0};
  const before=pokemon.currentHp;pokemon.recalculateStats();pokemon.currentHp=Math.max(1,Math.min(pokemon.maxHp,before));
 }
 if(ball.captureEffect==='heal'){
  pokemon.currentHp=pokemon.maxHp;pokemon.status='normal';pokemon.movePp=pokemon.abilities.map(require('../battle/battleResources').getMaxMovePp);
 }
 return pokemon;
}
module.exports={context,validate,multiplier,fixedChance,prepareCaptured,needsStorage,isNight};
