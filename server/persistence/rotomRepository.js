const transactions=require('./magicIslandRepository'),teams=require('./teamRepository');
function transform(id,p){return transactions.mutate(id,'rotom',p,async c=>{
 const record=await teams.getTeamRecord(id,c);if(!record)throw Error('Équipe introuvable.');
 const[rows]=await c.execute('SELECT * FROM pokemons WHERE team_id=? ORDER BY position FOR UPDATE',[record.id]);
 const pokemon=rows[0]&&teams.rowToPokemon(rows[0]);require('../game/models/rotomForms').change(pokemon,p.reset?null:p.appliance,p);
 const values=teams.pokemonToRow(pokemon,record.id,1),columns=teams.POKEMON_COLUMNS;
 await c.execute('UPDATE pokemons SET '+columns.filter(k=>k!=='uuid').map(k=>k+'=?').join(',')+' WHERE uuid=? AND team_id=?',[...values.filter((_,i)=>columns[i]!=='uuid'),pokemon.uuid,record.id]);
 return{pokemon};
 });}
module.exports={transform};
