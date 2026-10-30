const { createHash } = require('node:crypto');
const { rules, genderRates } = require('../../../data/game/stone_evolutions.json');
const dex = new Map(require('../../../data/game/pokedex.json').map(p => [p.id,p]));
function gender(pokemon) {
    const rate = genderRates[pokemon?.data?.id];
    if (rate < 0) return 'genderless';
    if (rate === 0) return 'male';
    if (rate === 8) return 'female';
    // Species restrictions override stale fields (e.g. an evolved Shedinja).
    if (['male','female'].includes(pokemon?.gender)) return pokemon.gender;
    if (!Number.isInteger(rate) || typeof pokemon?.uuid !== 'string' || !pokemon.uuid) return null;
    // Stable for legacy expeditions too: reopening the bag cannot reroll a condition.
    const roll = createHash('sha256').update(pokemon.uuid).digest().readUInt32BE(0) % 8;
    return roll < rate ? 'female' : 'male';
}
function target(pokemon, key) {
    if (!pokemon || pokemon.isEgg || pokemon.currentHp <= 0) return null;
    const rule = rules.find(r => r.from === pokemon.data.id && r.item === key && (!r.gender || r.gender === gender(pokemon)));
    return rule ? { id:rule.to, name:dex.get(rule.to).name.french } : null;
}
function evolve(pokemon, key) {
    const evolution = target(pokemon,key);
    if (!evolution) throw Error('Cette pierre ne convient pas à ce Pokémon.');
    pokemon.gender = gender(pokemon);
    pokemon.updatePokemon(evolution.id);
    return evolution;
}
function requiresStone(from, to) { return rules.some(r => r.from === from && r.to === to); }
module.exports = { gender, target, evolve, requiresStone };
