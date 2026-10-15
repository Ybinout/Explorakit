const { withTransaction } = require('../config/database');
const { rowToPokemon } = require('./teamRepository');
const { resolveMoveChoice } = require('../game/models/moveLearning');

async function learnMove(userId, pokemonUuid, choice) {
    return withTransaction(async connection => {
        await connection.execute('SELECT id FROM users WHERE id=? FOR UPDATE', [userId]);
        const [rows] = await connection.execute(
            'SELECT p.* FROM pokemons p JOIN teams t ON t.id=p.team_id WHERE t.user_id=? AND p.uuid=? FOR UPDATE',
            [userId, pokemonUuid]);
        if (!rows.length) throw Error('Ce Pokémon ne t’appartient pas.');
        const result = resolveMoveChoice(rowToPokemon(rows[0]), choice);
        const names = Array.from({ length: 4 }, (_, i) => result.abilities[i] || null);
        const pp = Array.from({ length: 4 }, (_, i) => result.movePp[i] ?? null);
        await connection.execute('UPDATE pokemons SET ability1=?,ability2=?,ability3=?,ability4=?,move1_pp=?,move2_pp=?,move3_pp=?,move4_pp=?,pending_moves=? WHERE uuid=?',
            [...names, ...pp, JSON.stringify(result.pendingMoves), pokemonUuid]);
        return result;
    });
}
module.exports = { learnMove };
