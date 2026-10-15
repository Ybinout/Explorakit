// A modest exploration income, below the price of a Ball even at high levels.
// Capture and victory use the same rule in Adventure, Rift and Colosseum.
function wildMoneyReward(pokemon, multiplier = 1) {
    const level = Math.max(1, Math.floor(Number(pokemon?.level) || 1));
    const base = Math.min(120, 20 + level * 2);
    const bonus = Number.isFinite(Number(multiplier)) ? Math.max(1, Number(multiplier)) : 1;
    return Math.floor(base * bonus);
}
module.exports = { wildMoneyReward };
