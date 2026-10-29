// Anonymous team progress only: never expose unseen species, moves or items.
function partyIndicator(pokemons) {
    const members = (Array.isArray(pokemons) ? pokemons : [])
        .filter(pokemon => pokemon && !pokemon.isEgg && !pokemon.storyActor).slice(0, 6);
    return members.length ? members.map(pokemon => Number(pokemon.currentHp) > 0)
        .sort((a, b) => Number(b) - Number(a)) : null;
}
module.exports = { partyIndicator };
