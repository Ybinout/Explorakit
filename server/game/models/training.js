const { yields } = require('../../../data/game/effort_yields.json');

const STAT_KEYS = ['hp', 'attack', 'defense', 'specialAttack', 'specialDefense', 'speed'];
function normalizeEffort(input = {}) {
    let remaining = 510;
    return Object.fromEntries(STAT_KEYS.map((key) => {
        const value = Math.min(252, remaining, Math.max(0, Math.floor(Number(input?.[key]) || 0)));
        remaining -= value;
        return [key, value];
    }));
}

function effortYield(pokemon) {
    const entry = yields[pokemon?.data?.id];
    return entry ? { ...entry } : null;
}

function grantEffort(pokemon, opponent) {
    if (!pokemon || Number(pokemon.currentHp) <= 0) return {};
    return pokemon.gainEffort(effortYield(opponent) || {});
}

function rewardTraining(pokemon, defeated, xp, io, playerId, options = {}) {
    const previousLevel = pokemon.level;
    const previousExperience = pokemon.experience;
    const effortGained = options.effortGained ?? grantEffort(pokemon, defeated);
    pokemon.gainExperience(xp);
    io.to(playerId).emit('battleExperience', { pokemon, xpGained: xp, previousLevel, previousExperience, effortGained });
}

module.exports = { STAT_KEYS, normalizeEffort, effortYield, grantEffort, rewardTraining };
