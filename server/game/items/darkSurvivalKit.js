const KEY = 'survival_kit', PRICE = 25000;
function protect(pokemon) {
    if (!pokemon || pokemon.currentHp > 0 || pokemon.heldItem !== KEY) return false;
    pokemon.heldItem = null;
    pokemon.__darkSurvivalProtected = true;
    // A used kit must never be recovered as lost equipment or restored on exit.
    for (const key of ['__darkLostItem', '__heldItemBeforeExchange', '__heldItemKnockedOff', '__heldItemConsumedForBattle'])
        if (pokemon[key] === KEY) delete pokemon[key];
    return true;
}
module.exports = {KEY, PRICE, protect};
