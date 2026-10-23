const { canSwitchOut } = require('./battleEngine');

// Wild encounters only: a clear level advantage guarantees retreat, even
// against trapping moves/abilities. Trainer switches keep their normal rules.
function canFleeWildBattle(pokemon, wildPokemon, battleState) {
    if (!(pokemon?.currentHp > 0)) return false;
    if (Number.isFinite(pokemon.level) && Number.isFinite(wildPokemon?.level)
        && wildPokemon.level > 0 && pokemon.level >= wildPokemon.level + 6) return true;
    return canSwitchOut(pokemon, wildPokemon, battleState, { escape: true });
}

module.exports = { canFleeWildBattle };
