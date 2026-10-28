// Capture and victory pay the same reward for a given wild Pokémon.
// Existing curves get 20% more money, including their caps and reward bonuses.
const WILD_MONEY_BOOST = 1.2;
function wildMoneyReward(pokemon, multiplier = 1) {
    const level = Math.max(1, Math.floor(Number(pokemon?.level) || 1));
    const base = Math.min(120, 20 + level * 2);
    const bonus = Number.isFinite(Number(multiplier)) ? Math.max(1, Number(multiplier)) : 1;
    return Math.floor(base * bonus * WILD_MONEY_BOOST);
}
function adventureMoneyReward(pokemon, multiplier = 1) {
    const level = Math.max(1, Math.floor(Number(pokemon?.level) || 1));
    const base = Math.min(250, 30 + level * 3);
    const bonus = Number.isFinite(Number(multiplier)) ? Math.max(1, Number(multiplier)) : 1;
    return Math.floor(base * bonus * WILD_MONEY_BOOST);
}
module.exports = { wildMoneyReward, adventureMoneyReward };
