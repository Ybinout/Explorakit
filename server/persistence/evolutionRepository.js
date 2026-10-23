const { withTransaction } = require('../config/database');
const { POKEMON_COLUMNS, pokemonToRow, rowToPokemon } = require('./teamRepository');
const evolution = require('../game/models/evolution');
const stones = require('../game/items/stoneEvolution');
const { loadUserItems } = require('./itemRepository');
const stoneKeys = new Set(require('../../data/game/items.json').items.filter(item => item.category === 'evolution').map(item => item.key));

async function saveEvolution(userId, pokemonUuid, apply) {
    return withTransaction(async connection => {
        await connection.execute('SELECT id FROM users WHERE id=? FOR UPDATE', [userId]);
        const [rows] = await connection.execute(
            'SELECT p.* FROM pokemons p JOIN teams t ON t.id=p.team_id WHERE t.user_id=? AND p.uuid=? FOR UPDATE', [userId, pokemonUuid]);
        if (!rows.length) throw Error('Ce Pokémon ne t’appartient pas.');
        const row = rows[0], pokemon = rowToPokemon(row);
        const result = await apply(pokemon, connection);
        const columns = POKEMON_COLUMNS.filter(column => !['uuid', 'team_id', 'position'].includes(column));
        const saved = pokemonToRow(pokemon, row.team_id, row.position);
        const values = Object.fromEntries(POKEMON_COLUMNS.map((column, i) => [column, saved[i]]));
        await connection.execute(`UPDATE pokemons SET ${columns.map(column => `${column}=?`).join(',')} WHERE uuid=?`, [...columns.map(column => values[column]), pokemonUuid]);
        await require('./progressionRepository').synchronizeCaughtPokemon(userId, [pokemon], connection);
        return { pokemon, evolution: result, items: await loadUserItems(userId, connection) };
    });
}

function evolvePokemon(userId, pokemonUuid, choice) {
    return saveEvolution(userId, pokemonUuid, pokemon => evolution.evolve(pokemon, choice));
}

async function evolvePokemonWithStone(userId, pokemonUuid, itemKey) {
    if (!stoneKeys.has(itemKey)) throw Error('Choisis une pierre d’évolution.');
    return saveEvolution(userId, pokemonUuid, async (pokemon, connection) => {
        if (pokemon.currentHp <= 0) throw Error('Soigne ce Pokémon avant de le faire évoluer.');
        const result = stones.evolve(pokemon, itemKey);
        const [spent] = await connection.execute(
            'UPDATE user_items SET quantity=quantity-1 WHERE user_id=? AND item_key=? AND quantity>=1', [userId, itemKey]);
        if (!spent.affectedRows) throw Error('Cette pierre n’est plus dans ton sac.');
        return result;
    });
}
module.exports = { evolvePokemon, evolvePokemonWithStone };
