const abilities = require('../data/game/abilities.gen7.json');
const pokemonAbilities = require('../data/game/pokemon_abilities.gen7.json');
const pokedex = require('../data/game/pokedex.json');
const pnjTeams = require('../data/game/pnj_teams.json');
const { FAMILY_ABILITIES, SUPPORTED_ABILITIES } = require('../server/game/abilities/abilityEngine');
const coverage=require('../server/game/abilities/abilityCoverage');

const errors = [];
const abilityNames = new Set(abilities.abilities.map((ability) => ability.name));
const mappedIds = Object.keys(pokemonAbilities.pokemon).map(Number).sort((a, b) => a - b);

if (pokedex.length !== 809) errors.push(`Pokedex attendu: 809, recu: ${pokedex.length}`);
if (mappedIds.length !== 809) errors.push(`Mappings attendus: 809, recus: ${mappedIds.length}`);

for (const pokemon of pokedex) {
    const mapping = pokemonAbilities.pokemon[String(pokemon.id)];
    if (!mapping) {
        errors.push(`Pokemon #${pokemon.id} sans talent.`);
        continue;
    }
    if (!Array.isArray(mapping.abilities) || mapping.abilities.length === 0) {
        errors.push(`Pokemon #${pokemon.id} sans aucun slot de talent.`);
    }
    if (!(mapping.abilities || []).some((slot) => !slot.hidden && !slot.special)) {
        errors.push(`Pokemon #${pokemon.id} sans talent normal eligible au tirage.`);
    }
    for (const slot of mapping.abilities || []) {
        if (!abilityNames.has(slot.name)) errors.push(`Talent inconnu ${slot.name} pour #${pokemon.id}.`);
        if (slot.hidden && slot.special) errors.push(`Slot incoherent cache et special pour #${pokemon.id}.`);
    }
}

for (const [family, familyAbilities] of Object.entries(FAMILY_ABILITIES)) {
    for (const abilityName of familyAbilities) {
        if (!abilityNames.has(abilityName)) errors.push(`${family}: talent absent du catalogue: ${abilityName}.`);
    }
}

for (const pnj of pnjTeams.pnjs || []) {
    for (const pokemon of pnj.team || []) {
        if (!pokemon.passiveAbility) continue;
        const slots = pokemonAbilities.pokemon[String(pokemon.pokemonId)]?.abilities || [];
        if (!slots.some((slot) => slot.name === pokemon.passiveAbility)) {
            errors.push(`PNJ ${pnj.name}: ${pokemon.name} ne peut pas avoir ${pokemon.passiveAbility}.`);
        }
    }
}

const usedAbilities = new Set();
for (const mapping of Object.values(pokemonAbilities.pokemon)) {
    for (const slot of mapping.abilities) usedAbilities.add(slot.name);
}
const unsupported = [...usedAbilities].filter((name) => coverage.status(name)==='missing').sort();
for(const name of unsupported)errors.push(`Talent non classé: ${name}.`);
const specialSlots = Object.values(pokemonAbilities.pokemon)
    .flatMap((mapping) => mapping.abilities)
    .filter((slot) => slot.special);

const report = {
    generation: pokemonAbilities.generation,
    pokemon: mappedIds.length,
    catalogAbilities: abilityNames.size,
    usedAbilities: usedAbilities.size,
    specialEventSlotsExcludedFromRandomRolls: specialSlots.length,
    implementedInFamilies1To4: [...SUPPORTED_ABILITIES].filter((name) => usedAbilities.has(name)).length,
    remainingForLaterFamilies: unsupported.length,
    implementedSingleBattleAbilities: [...usedAbilities].filter(name=>coverage.status(name)==='single_battle').length,
    doublesOnly: [...coverage.doublesOnly].sort(),
    overworldPending: [...coverage.overworldPending].sort(),
    errors
};

console.log(JSON.stringify(report, null, 2));
if (errors.length > 0) process.exitCode = 1;

