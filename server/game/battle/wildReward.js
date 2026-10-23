// Capture and victory pay the same reward for a given wild Pokémon.
// Expeditions retain their own curve; Adventure continues up to 250 before bonuses.
function wildMoneyReward(pokemon, multiplier = 1) {
    const level = Math.max(1, Math.floor(Number(pokemon?.level) || 1));
    const base = Math.min(120, 20 + level * 2);
    const bonus = Number.isFinite(Number(multiplier)) ? Math.max(1, Number(multiplier)) : 1;
    return Math.floor(base * bonus);
}
function adventureMoneyReward(pokemon, multiplier = 1) {
    const level = Math.max(1, Math.floor(Number(pokemon?.level) || 1));
    const base = Math.min(250, 30 + level * 3);
    const bonus = Number.isFinite(Number(multiplier)) ? Math.max(1, Number(multiplier)) : 1;
    return Math.floor(base * bonus);
}
module.exports = { wildMoneyReward, adventureMoneyReward };
