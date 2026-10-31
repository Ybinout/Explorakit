// Anonymous team progress only: never expose unseen species, moves or items.
function partyIndicator(pokemons) {
    const members = (Array.isArray(pokemons) ? pokemons : [])
        .filter(pokemon => pokemon && !pokemon.isEgg && !pokemon.storyActor).slice(0, 6);
    return members.length ? members.map(pokemon => Number(pokemon.currentHp) > 0)
        .sort((a, b) => Number(b) - Number(a)) : null;
}
function partyConditionIndicator(pokemons) {
    const rank = { ready: 0, hurt: 1, ko: 2 };
    const states = (Array.isArray(pokemons) ? pokemons : [])
        .filter(pokemon => pokemon && !pokemon.isEgg && !pokemon.storyActor).slice(0, 6)
        .map(pokemon => Number(pokemon.currentHp) > 0
            ? Number(pokemon.maxHp) > Number(pokemon.currentHp) ? 'hurt' : 'ready'
            : 'ko');
    // Counts only, independent of switches: no identity, order or exact HP.
    return states.length ? states.sort((a, b) => rank[a] - rank[b]) : null;
}
module.exports = { partyIndicator, partyConditionIndicator };
