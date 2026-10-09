const { dbPool } = require('../server/config/database');
const {
    createDeterministicRandom,
    normalizeSpeciesAbility
} = require('../server/game/abilities/abilityDex');

async function backfillPokemonAbilities() {
    const [rows] = await dbPool.execute(
        'SELECT uuid, pokemon_id, passive_ability FROM pokemons ORDER BY uuid'
    );
    let updated = 0;

    for (const row of rows) {
        const ability = normalizeSpeciesAbility(
            row.pokemon_id,
            row.passive_ability,
            createDeterministicRandom(row.uuid)
        );
        if (ability === row.passive_ability) continue;
        await dbPool.execute(
            'UPDATE pokemons SET passive_ability = ? WHERE uuid = ?',
            [ability, row.uuid]
        );
        updated += 1;
    }

    console.log(`Talents verifies: ${rows.length}; talents attribues ou corriges: ${updated}.`);
    return { checked: rows.length, updated };
}

if (require.main === module) {
    backfillPokemonAbilities()
        .catch((error) => {
            console.error(`Backfill des talents interrompu: ${error.message}`);
            process.exitCode = 1;
        })
        .finally(() => dbPool.end());
}

module.exports = { backfillPokemonAbilities };

