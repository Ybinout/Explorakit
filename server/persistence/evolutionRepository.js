const { withTransaction } = require('../config/database');
const { POKEMON_COLUMNS, pokemonToRow, rowToPokemon } = require('./teamRepository');
const evolution = require('../game/models/evolution');

async function evolvePokemon(userId, pokemonUuid, choice) {
    return withTransaction(async connection => {
        await connection.execute('SELECT id FROM users WHERE id=? FOR UPDATE', [userId]);
        const [rows] = await connection.execute(
            'SELECT p.* FROM pokemons p JOIN teams t ON t.id=p.team_id WHERE t.user_id=? AND p.uuid=? FOR UPDATE', [userId, pokemonUuid]);
        if (!rows.length) throw Error('Ce Pokémon ne t’appartient pas.');
        const row = rows[0], pokemon = rowToPokemon(row);
        const result = evolution.evolve(pokemon, choice);
        const columns = POKEMON_COLUMNS.filter(column => !['uuid', 'team_id', 'position'].includes(column));
        const saved = pokemonToRow(pokemon, row.team_id, row.position);
        const values = Object.fromEntries(POKEMON_COLUMNS.map((column, i) => [column, saved[i]]));
        await connection.execute(`UPDATE pokemons SET ${columns.map(column => `${column}=?`).join(',')} WHERE uuid=?`, [...columns.map(column => values[column]), pokemonUuid]);
        await require('./progressionRepository').synchronizeCaughtPokemon(userId, [pokemon], connection);
        return { pokemon, evolution: result };
    });
}
module.exports = { evolvePokemon };
