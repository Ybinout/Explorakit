const { withTransaction } = require('../config/database');
const { rowToPokemon } = require('./teamRepository');
const { teachMachine } = require('../game/items/machines');

async function useMachine(userId, pokemonUuid, itemKey, choice) {
    return withTransaction(async connection => {
        await connection.execute('SELECT id FROM users WHERE id=? FOR UPDATE', [userId]);
        const [rows] = await connection.execute('SELECT p.* FROM pokemons p JOIN teams t ON t.id=p.team_id WHERE t.user_id=? AND p.uuid=? FOR UPDATE', [userId, pokemonUuid]);
        if (!rows.length) throw Error('Ce Pokémon ne t’appartient pas.');
        const result = teachMachine(rowToPokemon(rows[0]), itemKey, choice);
        const [spent] = await connection.execute('UPDATE user_items SET quantity=quantity-1 WHERE user_id=? AND item_key=? AND quantity>=1', [userId,itemKey]);
        if (!spent.affectedRows) throw Error('Cette CS n’est plus dans ton sac.');
        await connection.execute('UPDATE pokemons SET ability1=?,ability2=?,ability3=?,ability4=?,move1_pp=?,move2_pp=?,move3_pp=?,move4_pp=?,pending_moves=? WHERE uuid=?',
            [...Array.from({length:4},(_,i)=>result.abilities[i]||null),...Array.from({length:4},(_,i)=>result.movePp[i]??null),JSON.stringify(result.pendingMoves),pokemonUuid]);
        return result;
    });
}
module.exports = { useMachine };
