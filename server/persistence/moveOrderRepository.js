const {withTransaction}=require('../config/database');
const {rowToPokemon}=require('./teamRepository');
const {reorderMoves}=require('../game/models/moveOrder');
const {assertUnlocked}=require('../game/social/tradeLocks');
async function saveMoveOrder(connection,uuid,result) {
    const names=Array.from({length:4},(_,i)=>result.abilities[i] || null);
    const pp=Array.from({length:4},(_,i)=>result.movePp[i] ?? null);
    await connection.execute('UPDATE pokemons SET ability1=?,ability2=?,ability3=?,ability4=?,move1_pp=?,move2_pp=?,move3_pp=?,move4_pp=? WHERE uuid=?',[...names,...pp,uuid]);
}
async function reorderPokemonMoves(userId,uuid,payload) {
    assertUnlocked(userId);
    return withTransaction(async connection=>{
        await connection.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[userId]);
        assertUnlocked(userId);
        const [rows]=await connection.execute('SELECT p.* FROM pokemons p JOIN teams t ON t.id=p.team_id WHERE t.user_id=? AND p.uuid=? FOR UPDATE',[userId,uuid]);
        if(!rows.length)throw Error('Ce Pokémon ne t’appartient pas.');
        const result=reorderMoves(rowToPokemon(rows[0]),payload);
        await saveMoveOrder(connection,uuid,result);
        return result;
    });
}
module.exports={reorderPokemonMoves,saveMoveOrder};
