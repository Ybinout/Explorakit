const {AdventureExperience}=require('../battle/adventureExperience');
const {BATTLE_EXPERIENCE_MULTIPLIERS}=require('../models/progression');
const {orderedParty}=require('../battle/partyOrder');
const MAX_LEVEL=130,RATE=.8;
function ensure(player){return player.superTournamentExperience ||= {version:1,gains:new Map()};}
function totals(run){return new Map(run?.player?.superTournamentExperience?.gains||[]);}
function reward(battle,defeated){
 const owner=battle.a,ledger=ensure(owner),team=orderedParty(owner.equipe.pokemons);
 const tracker=new AdventureExperience({expShare:'equipped'});
 const participants=battle.effortParticipants?.get(defeated.uuid)||new Set();
 tracker.participants.set(defeated,participants);
 const io={to:()=>({emit:(event,data)=>battle.emit(owner,event,data)})};
 const awards=tracker.reward({...owner,equipe:{...owner.equipe,pokemons:team}},defeated,BATTLE_EXPERIENCE_MULTIPLIERS.trainer,io,
  {grantEffort:false,experienceRate:RATE,maxLevel:MAX_LEVEL});
 for(const {pokemon,xp}of awards){ledger.gains.set(pokemon.uuid,(ledger.gains.get(pokemon.uuid)||0)+xp);battle.say(`${pokemon.truename||pokemon.name} gagne ${xp} XP !`,true);}
 return awards;
}
function request(run,previous){
 const gains=totals(run),awards=[...gains].filter(([uuid,total])=>total>(previous.get(uuid)||0)).map(([uuid,total])=>({uuid,total}));
 return awards.length?{runId:run.id,awards}:null;
}
// Merge only persistent training. Injuries, PP usage, held-item changes and
// tournament powers belong to the sealed copy and never escape with the XP.
const PROGRESS_FIELDS=['experience','level','currentHp','maxHp','attack','defense','specialAttack','specialDefense','speed','currentAttack','currentDefense','currentSpecialAttack','currentSpecialDefense','currentSpeed','abilities','movePp','pendingMoves','evolutionState'];
function merge(player,updates){for(const update of updates||[]){const pokemon=player?.equipe?.pokemons?.find(p=>p.uuid===update.uuid);if(pokemon)for(const key of PROGRESS_FIELDS)pokemon[key]=update[key];}}
module.exports={MAX_LEVEL,RATE,ensure,totals,reward,request,merge};
