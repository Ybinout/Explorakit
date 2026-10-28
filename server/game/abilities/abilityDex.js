const abilityData = require('../../../data/game/abilities.gen7.json');
const pokemonAbilityData = require('../../../data/game/pokemon_abilities.gen7.json');

const HIDDEN_ABILITY_CHANCE = 0.05;

const abilityByName = new Map(
    abilityData.abilities.map((ability) => [ability.name.toLowerCase(), ability])
);

function createDeterministicRandom(seed) {
    let state = 2166136261;
    for (const character of String(seed || 'explorakit')) {
        state ^= character.charCodeAt(0);
        state = Math.imul(state, 16777619);
    }
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

function getSpeciesAbilitySlots(pokemonId) {
    const entry = pokemonAbilityData.pokemon[String(Number(pokemonId))];
    return Array.isArray(entry?.abilities) ? entry.abilities.map((slot) => ({ ...slot })) : [];
}

function getAbilityDefinition(abilityName) {
    if (typeof abilityName !== 'string' || !abilityName.trim()) return null;
    return abilityByName.get(abilityName.trim().toLowerCase()) || null;
}

function getCanonicalSpeciesAbility(pokemonId, abilityName) {
    if (typeof abilityName !== 'string' || !abilityName.trim()) return null;
    const normalizedName = abilityName.trim().toLowerCase();
    return getSpeciesAbilitySlots(pokemonId)
        .find((slot) => slot.name.toLowerCase() === normalizedName)?.name || null;
}

function chooseSpeciesAbility(pokemonId, random = Math.random, hiddenChance = HIDDEN_ABILITY_CHANCE) {
    const slots = getSpeciesAbilitySlots(pokemonId);
    if (slots.length === 0) return null;

    const normalSlots = slots.filter((slot) => !slot.hidden && !slot.special);
    const hiddenSlots = slots.filter((slot) => slot.hidden);
    const safeRandom = typeof random === 'function' ? random : Math.random;
    const resolvedHiddenChance = Math.min(1, Math.max(0, Number(hiddenChance) || 0));

    if (hiddenSlots.length > 0 && safeRandom() < resolvedHiddenChance) {
        return hiddenSlots[Math.floor(safeRandom() * hiddenSlots.length)]?.name || hiddenSlots[0].name;
    }

    const candidates = normalSlots.length > 0 ? normalSlots : hiddenSlots;
    return candidates[Math.floor(safeRandom() * candidates.length)]?.name || candidates[0].name;
}

function normalizeSpeciesAbility(pokemonId, abilityName, random = Math.random) {
    const slots = getSpeciesAbilitySlots(pokemonId);
    const normalizedName = typeof abilityName === 'string' ? abilityName.trim().toLowerCase() : '';
    const validRegularSlot = slots.find((slot) => !slot.special && slot.name.toLowerCase() === normalizedName);
    return validRegularSlot?.name || chooseSpeciesAbility(pokemonId, random);
}

function evolveSpeciesAbility(previousPokemonId, nextPokemonId, currentAbility, random = Math.random) {
    const previousSlot = getSpeciesAbilitySlots(previousPokemonId)
        .find((slot) => slot.name.toLowerCase() === String(currentAbility || '').toLowerCase());
    if (!previousSlot || previousSlot.special) return chooseSpeciesAbility(nextPokemonId, random);

    const nextSlots = getSpeciesAbilitySlots(nextPokemonId).filter(slot => !slot.special);
    const matchingSlot = nextSlots.find((slot) =>
        !slot.special
        && slot.hidden === previousSlot.hidden
        && slot.slot === previousSlot.slot
    );
    if (matchingSlot) return matchingSlot.name;
    // A second ordinary slot can disappear (Eevee -> Vaporeon, Kirlia ->
    // Gallade). Evolution is not a new encounter: never reroll a hidden ability.
    const sameKind = nextSlots.find(slot => slot.hidden === previousSlot.hidden);
    if (sameKind) return sameKind.name;
    // Some evolutions have no hidden slot at all, e.g. Shedinja. Fall back to
    // their first ordinary ability without changing valid saved companions.
    return nextSlots.find(slot => !slot.hidden)?.name || chooseSpeciesAbility(nextPokemonId, random);
}

module.exports = {
    HIDDEN_ABILITY_CHANCE,
    chooseSpeciesAbility,
    createDeterministicRandom,
    evolveSpeciesAbility,
    getAbilityDefinition,
    getCanonicalSpeciesAbility,
    getSpeciesAbilitySlots,
    normalizeSpeciesAbility
};
