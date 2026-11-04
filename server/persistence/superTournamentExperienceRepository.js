const assert=require('node:assert/strict');
const experience=require('../game/superTournament/experience');
const teams=require('./teamRepository');
const COLUMNS=['level','experience','current_hp','current_attack','current_defense','current_special_attack','current_special_defense','current_speed',
 'ability1','ability2','ability3','ability4','move1_pp','move2_pp','move3_pp','move4_pp','pending_moves','evolution_state'];
async function apply(id,claim,before,run,connection){
 if(!before?.player || before.id!==claim.runId || (run&&run.id!==claim.runId))throw Error('Gain d’expérience du tournoi périmé.');
 const prior=experience.totals(before),current=run?experience.totals(run):null;
 const allowed=new Set(before.player.equipe.pokemons.map(p=>p.uuid));
 if(!Array.isArray(claim.awards)||!claim.awards.length||claim.awards.length>6||new Set(claim.awards.map(a=>a.uuid)).size!==claim.awards.length)throw Error('Gain d’expérience du tournoi invalide.');
 if(current){const expected=[...current].filter(([uuid,total])=>total>(prior.get(uuid)||0));assert.deepEqual([...claim.awards].map(a=>[a.uuid,a.total]).sort(),expected.sort(),'Le reçu d’expérience doit correspondre au checkpoint.');}
 const updates=[];
 for(const {uuid,total}of claim.awards){
  const previous=prior.get(uuid)||0;
  if(!allowed.has(uuid)||!Number.isSafeInteger(total)||total<=previous)throw Error('Gain d’expérience du tournoi invalide.');
  const [rows]=await connection.execute('SELECT p.* FROM pokemons p JOIN teams t ON t.id=p.team_id WHERE t.user_id=? AND p.uuid=? FOR UPDATE',[id,uuid]);
  if(rows.length!==1)throw Error('Un Pokémon inscrit ne se trouve plus dans ton équipe.');
  const row=rows[0],pokemon=teams.rowToPokemon(row);
  const gain=pokemon.level>=experience.MAX_LEVEL?0:Math.min(total-previous,Math.max(0,pokemon.getNextLevelExpForLevel(experience.MAX_LEVEL)-pokemon.experience));
  if(gain>0){
   pokemon.gainExperience(gain,{deferEvolution:true});
   const values=teams.pokemonToRow(pokemon,row.team_id,row.position),saved=Object.fromEntries(teams.POKEMON_COLUMNS.map((key,i)=>[key,values[i]]));
   await connection.execute('UPDATE pokemons SET '+COLUMNS.map(key=>key+'=?').join(',')+' WHERE uuid=? AND team_id=?',[...COLUMNS.map(key=>saved[key]),uuid,row.team_id]);
  }
  updates.push(pokemon);
 }
 return updates;
}
module.exports={apply};
