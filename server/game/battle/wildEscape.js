const { canSwitchOut } = require('./battleEngine');

// Wild encounters only: an overleveled enemy guarantees a safe retreat, even
// against trapping moves/abilities. Trainer switches keep their normal rules.
function canFleeWildBattle(pokemon, wildPokemon, battleState) {
    if (!(pokemon?.currentHp > 0)) return false;
    if (Number.isFinite(pokemon.level) && Number.isFinite(wildPokemon?.level)
        && pokemon.level > 0 && wildPokemon.level >= pokemon.level + 6) return true;
    return canSwitchOut(pokemon, wildPokemon, battleState, { escape: true });
}

module.exports = { canFleeWildBattle };
