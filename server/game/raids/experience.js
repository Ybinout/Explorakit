const {growthSnapshot,levelGrowth}=require('../models/levelGrowth');
function amount(boss){const level=Number(boss?.level);if(!Number.isInteger(level)||level<1||level>9999)throw Error('Niveau du boss invalide.');return level*500;}
function award(run,member){
 const eligible=new Set((run.combat?.models||[]).filter(p=>p.ownerId===member.id).map(p=>p.pokemon.uuid)),xp=amount(run.combat?.boss||run.rift),awards=[];
 for(const pokemon of member.team.pokemons){
  if(!eligible.has(pokemon.uuid)||pokemon.isEgg||pokemon.__darkContinentDead)continue;
  const before=growthSnapshot(pokemon),experience=pokemon.experience;
  pokemon.gainExperience(xp,{deferEvolution:true});
  awards.push({uuid:pokemon.uuid,pokemonId:pokemon.data.id,name:pokemon.truename||pokemon.name,shiny:!!pokemon.shiny,k:pokemon.k,xp:pokemon.experience-experience,previousLevel:before.level,level:pokemon.level,growth:levelGrowth(pokemon,before)});
 }
 return awards;
}
module.exports={amount,award};
