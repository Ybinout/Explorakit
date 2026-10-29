const { isWeatherSuppressed } = require('../abilities/abilityEngine');

const WEATHER_HEALS = new Set(['Morning Sun', 'Synthesis', 'Moonlight']);

// pokemon-showdown/data/moves.ts (Morning Sun) and sim/battle.ts (modify).
// Gen 7 fixed-point modifiers, rounded to nearest HP (ties round down).
// null leaves other healing moves' existing rules untouched.
function weatherHealingAmount(move, pokemon, opponent, battleState) {
    if (!WEATHER_HEALS.has(move?.ename)) return null;
    const weather = isWeatherSuppressed(pokemon, opponent) ? null : battleState?.weather?.kind;
    const modifier = weather === 'sun' ? 2732
        : ['rain', 'sandstorm', 'hail'].includes(weather) ? 1024 : 2048;
    const maxHp = Math.max(0, Math.floor(Number(pokemon?.maxHp) || 0));
    return Math.floor((maxHp * modifier + 2047) / 4096);
}

module.exports = { weatherHealingAmount };
