const { growthSnapshot, levelGrowth } = require('./levelGrowth');
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

// EVs are a full yield for each actual entrant, independent of XP sharing.
// A fainted companion still in the team keeps its training, without being healed.
function grantParticipantEffort(team, opponent, participants = new Set()) {
    const gains = new Map();
    for (const pokemon of team || []) {
        if (pokemon.isEgg || !participants.has(pokemon.uuid) || gains.has(pokemon.uuid)) continue;
        gains.set(pokemon.uuid, pokemon.gainEffort(effortYield(opponent) || {}));
    }
    return gains;
}

function rewardTraining(pokemon, defeated, xp, io, playerId, options = {}) {
    const previousLevel = pokemon.level;
    const previousExperience = pokemon.experience;
    const effortGained = options.effortGained ?? grantEffort(pokemon, defeated);
    const beforeGrowth = growthSnapshot(pokemon);
    pokemon.gainExperience(xp, {deferEvolution:true});
    io.to(playerId).emit('battleExperience', { pokemon, xpGained: xp, previousLevel, previousExperience, effortGained, levelGrowth:levelGrowth(pokemon,beforeGrowth) });
}

module.exports = { STAT_KEYS, normalizeEffort, effortYield, grantEffort, grantParticipantEffort, rewardTraining };
