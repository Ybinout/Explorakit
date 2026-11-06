const {withTransaction}=require('../config/database');
const tutorial=require('../game/tutorial/earlyGame'),teams=require('./teamRepository');
async function read(id,c){const[[r]]=await c.execute('SELECT flag_value FROM player_story_flags WHERE user_id=? AND flag_key=? FOR UPDATE',[id,tutorial.KEY]);return tutorial.parse(r?.flag_value);}
async function write(id,state,c){await c.execute('UPDATE player_story_flags SET flag_value=? WHERE user_id=? AND flag_key=?',[JSON.stringify(state),id,tutorial.KEY]);}
async function change(id,apply){return withTransaction(async c=>{await c.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[id]);const s=await read(id,c);if(!s)return null;await apply(s,c);await write(id,s,c);return s;});}
async function noteWayne(id){return change(id,s=>{s.metWayne=true;if(s.phase==='wayne')s.phase='grass';});}
async function begin(id,uuid){return change(id,s=>{if(!tutorial.active(s))throw Error('Cette initiation est déjà terminée.');s.encounter=uuid;if(['wayne','grass'].includes(s.phase))s.phase='hp';});}
async function advance(id,phase,uuid){return change(id,s=>{const next=tutorial.NEXT[phase];if(!next||s.encounter!==uuid)throw Error('Cette étape n’est plus disponible.');if(s.phase===next)return;if(s.phase!==phase)throw Error('L’initiation a déjà avancé.');s.phase=next;});}
async function attacked(id,uuid){return change(id,s=>{if(s.encounter!==uuid||s.phase!=='attack')throw Error('Cette action n’appartient pas à l’initiation.');s.phase='capture_info';});}
async function capture(id,uuid,player,wild,itemKey){
 return withTransaction(async c=>{
  await c.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[id]);const s=await read(id,c);
  if(s?.phase==='care'&&s.encounter===uuid)return {state:s,duplicate:true};
  if(s?.phase!=='capture'||s.encounter!==uuid||wild.uuid!==uuid||player.currentmap!=='start'||itemKey!=='pokeball')throw Error('Cette première capture n’est plus disponible.');
  const record=await teams.getTeamRecord(id,c),owned=await teams.getTeamPokemons(record.id,c);const refs=player.equipe.pokemons.map(p=>p.uuid);
  if(owned.length!==refs.length||owned.some(p=>!refs.includes(p.uuid)))throw Error('Ton équipe a changé. Reconnecte-toi pour la retrouver.');
  const [spent]=await c.execute("UPDATE user_items SET quantity=quantity-1 WHERE user_id=? AND item_key='pokeball' AND quantity>=1",[id]);if(spent.affectedRows!==1)throw Error('Il te faut une Poké Ball pour continuer.');
  let stored=null;if(refs.length>=6){const entries=await require('./pokemonStorageRepository').loadEntries(id,c,true);stored=require('../game/storage/pokemonStorage').freeSlot(entries);await c.execute('INSERT INTO pokemon_storage(uuid,user_id,box_index,slot_index,pokemon_data) VALUES(?,?,?,?,?)',[wild.uuid,id,stored.box,stored.slot,require('./pokemonStorageRepository').encodePokemon(wild)]);}
  else await teams.editEquipe(id,{pokemons:[...player.equipe.pokemons,wild]},c);
  await require('./progressionRepository').markPokemonCaught(id,wild,c);s.phase='care';await write(id,s,c);return{state:s,stored};
 });
}
module.exports={noteWayne,begin,advance,attacked,capture};
