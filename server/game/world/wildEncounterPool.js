// Optional Adventure percentages. Unspecified species share the remainder;
// a missing or invalid override retains the historical uniform pool.
function encounterChances(map) {
    const ids = map?.wildpokemon || [];
    if (!ids.length) return [];
    const uniform = () => ids.map(id => [id, 100 / ids.length]);
    const rates = map.adventureEncounterRates;
    if (!rates || typeof rates !== 'object' || Array.isArray(rates)) return uniform();
    const entries = Object.entries(rates), known = new Set(ids.map(String));
    if (!entries.length || entries.some(([id,rate]) => !known.has(id)
        || typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0 || rate > 100)) return uniform();
    const total = entries.reduce((sum, [,rate]) => sum + rate, 0);
    const remaining = ids.length - entries.length;
    if (total > 100 || (!remaining && total !== 100)) return uniform();
    const shared = remaining ? (100 - total) / remaining : 0;
    return ids.map(id => [id, Object.hasOwn(rates, id) ? rates[id] : shared]);
}

function chooseOrdinarySpecies(map, random = Math.random) {
    const ids = map?.wildpokemon;
    if (!ids?.length) return null;
    // Keep exactly the same draw and index for every unconfigured route.
    if (!map.adventureEncounterRates) return ids[Math.floor(random() * ids.length)];
    const chances = encounterChances(map);
    let draw = random() * 100;
    for (const [id, chance] of chances) {
        draw -= chance;
        if (draw < 0) return id;
    }
    // Floating-point rounding at the upper boundary must not lose a species.
    return chances.findLast(([,chance]) => chance > 0)?.[0] ?? null;
}

module.exports = { encounterChances, chooseOrdinarySpecies };
