const trainers = require('../../../data/game/expedition_trainers.json');
const factory = require('./pokemonFactory');
const {tuneWildMoves} = require('./openingBalance');
const dex = new Map(require('../../../data/game/pokedex.json').map(p=>[p.id,p]));
const entries = trainers.map(t=>({name:t.id,interactionName:t.id,map:t.map,x:t.x,y:t.y,sprite:'townspeople.png',spriteFrame:t.spriteFrame,challengeLevel:t.level,block:true}));
const find = id=>trainers.find(t=>t.id===id);
function view(t,p){return {id:t.id,name:t.name,place:t.place,level:t.level,defeated:p.defeated.has(t.id),team:t.team.map(id=>({id,name:dex.get(id).name.french})),hint:'Défi facultatif · K.O. définitifs · Récompense et butin de dresseur.'};}
function opponent(t){return {npc:true,username:t.name,equipe:{pokemons:t.team.map(id=>tuneWildMoves(factory.create(id,t.level,true)))},drifts:[],equipped:[],chain:0};}
module.exports={entries,find,view,opponent,list:p=>trainers.map(t=>view(t,p))};
