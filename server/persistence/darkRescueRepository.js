const {dbPool,withTransaction}=require('../config/database');
const teams=require('./teamRepository'),storage=require('./pokemonStorageRepository');
const {healTeam,getPokemonCenterRespawnPoint}=require('../game/world/playerRecovery');
const FLAG='dark_rescue_notice';
async function rescue(userId,random=Math.random){return withTransaction(async c=>{
 await c.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[userId]);
 require('../game/social/tradeLocks').assertUnlocked(userId);
 const record=await teams.getTeamRecord(userId,c),team={pokemons:(await teams.getTeamPokemons(record.id,c)).map(teams.rowToPokemon)};
 // A concurrent/retried recovery must never withdraw or grant a second companion.
 if(team.pokemons.some(p=>p.currentHp>0))return{equipe:team,rescued:false};
 const [[first]]=await c.execute('SELECT uuid,box_index,slot_index,pokemon_data FROM pokemon_storage WHERE user_id=? ORDER BY box_index,slot_index LIMIT 1 FOR UPDATE',[userId]);
 let pokemon,source='retained';
 if(first){
  pokemon=storage.decodePokemon(first.pokemon_data);source='pc';
  await c.execute('DELETE FROM pokemon_storage WHERE user_id=? AND uuid=?',[userId,first.uuid]);
  const corruption=require('../game/corruption/pokemon');
  let displaced=corruption.corrupted(pokemon)?team.pokemons.findIndex(corruption.corrupted):-1;
  if(displaced<0&&team.pokemons.length===6)displaced=5;
  if(displaced>=0){const [kept]=team.pokemons.splice(displaced,1);await c.execute('INSERT INTO pokemon_storage(uuid,user_id,box_index,slot_index,pokemon_data) VALUES(?,?,?,?,?)',[kept.uuid,userId,first.box_index,first.slot_index,storage.encodePokemon(kept)]);}
  team.pokemons.push(pokemon);
 }else if(!team.pokemons.length){
  const roll=random();if(!Number.isFinite(roll)||roll<0||roll>=1)throw Error('Tirage de secours invalide.');
  pokemon=require('./userRepository').createStarterPokemon([1,4,7][Math.floor(roll*3)],random);source='starter';team.pokemons.push(pokemon);
  await require('./progressionRepository').markPokemonCaught(userId,pokemon,c);
 }
 healTeam(team);await teams.editEquipe(userId,team,c);
 const destination=getPokemonCenterRespawnPoint(),notice={source,pokemonId:pokemon?.data.id,name:pokemon?.name||''};
 await c.execute('UPDATE users SET map=?,x=?,y=? WHERE id=?',[destination.map,destination.x,destination.y,userId]);
 await c.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)',[userId,FLAG,JSON.stringify(notice)]);
 return{equipe:team,rescued:true,notice,destination};
});}
async function readNotice(userId){const [[r]]=await dbPool.execute('SELECT flag_value FROM player_story_flags WHERE user_id=? AND flag_key=?',[userId,FLAG]);return r?JSON.parse(r.flag_value):null;}
async function acknowledge(userId){await dbPool.execute('DELETE FROM player_story_flags WHERE user_id=? AND flag_key=?',[userId,FLAG]);}
module.exports={rescue,readNotice,acknowledge};
