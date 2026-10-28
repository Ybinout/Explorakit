const { dbPool } = require('../config/database');
const wildFactory = require('../game/world/wildPokemonFactory');
const { isLegendary } = require('../game/world/legendaryEncounters');

const ABRA_ID = 63;
const ABRA_MAP = 'route2';

// Called only after an actual grass encounter passes the Repel check.
// The ordinary battle's Pokédex write records the encounter; merely selecting
// a Pokémon must never consume the guarantee (disconnects, startup failures).
async function applyEncounterGuarantee(userId, map, wild, executor = dbPool) {
    if (map !== ABRA_MAP || !wild || Number(wild.data?.id) === ABRA_ID || isLegendary(wild.data?.id)) return wild;
    if (!Number.isInteger(userId) || userId <= 0) throw new Error('Utilisateur invalide.');
    const [rows] = await executor.execute(
        `SELECT seen_count, caught_count FROM user_pokedex
         WHERE user_id = ? AND pokemon_id = ? LIMIT 1`,
        [userId, ABRA_ID]
    );
    if (Number(rows[0]?.seen_count) > 0 || Number(rows[0]?.caught_count) > 0) return wild;
    return wildFactory.createAtLevel(ABRA_ID, wild.level);
}

module.exports = { applyEncounterGuarantee, ABRA_ID, ABRA_MAP };
