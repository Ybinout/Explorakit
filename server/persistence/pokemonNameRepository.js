const {withTransaction} = require('../config/database');
const {rowToPokemon} = require('./teamRepository');
const {renamedPokemon} = require('../game/models/ownedNames');
const {assertUnlocked} = require('../game/social/tradeLocks');
async function renamePokemon(userId, payload) {
    if(typeof payload?.pokemonUuid!=='string' || !payload.pokemonUuid || payload.pokemonUuid.length>64)throw Error('Choisis un Pokémon.');
    return withTransaction(async c => {
        await c.execute('SELECT id FROM users WHERE id=? FOR UPDATE', [userId]);
        assertUnlocked(userId);
        const [rows] = await c.execute('SELECT p.* FROM pokemons p JOIN teams t ON t.id=p.team_id WHERE t.user_id=? AND p.uuid=? FOR UPDATE', [userId, payload?.pokemonUuid || '']);
        const name = renamedPokemon(rows[0] && rowToPokemon(rows[0]), payload);
        await c.execute('UPDATE pokemons SET name=? WHERE uuid=? AND team_id=?', [name, rows[0].uuid, rows[0].team_id]);
        return {name};
    });
}
module.exports = {renamePokemon};
