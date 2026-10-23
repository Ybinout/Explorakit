const DEFAULT_EXPERIENCE_RATE = 1;
const EXPERIENCE_BALANCE = require('../../../data/game/experience_balance.json');
const BATTLE_EXPERIENCE_MULTIPLIERS = Object.freeze({ ...EXPERIENCE_BALANCE.multipliers });

const K_TIERS = Object.freeze([
    { k: 4, probability: 0.01, label: 'Exceptionnel' },
    { k: 3, probability: 0.02, label: 'Rare' },
    { k: 2, probability: 0.18, label: 'Prometteur' },
    { k: 1, probability: 0.79, label: 'Commun' }
]);

function getExperienceRate(maxExperience) {
    const parsed = Number(maxExperience);
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_EXPERIENCE_RATE;
    return parsed / 1000000;
}

function getTotalExperienceForLevel(level, rate = DEFAULT_EXPERIENCE_RATE) {
    const normalizedLevel = Math.max(1, Math.floor(Number(level) || 1));
    const normalizedRate = Number.isFinite(Number(rate)) && Number(rate) > 0
        ? Number(rate)
        : DEFAULT_EXPERIENCE_RATE;
    return Math.floor(normalizedRate * Math.pow(normalizedLevel - 1, 3));
}

function getLevelFromExperience(experience, rate = DEFAULT_EXPERIENCE_RATE) {
    const normalizedExperience = Math.max(0, Math.floor(Number(experience) || 0));
    const normalizedRate = Number.isFinite(Number(rate)) && Number(rate) > 0
        ? Number(rate)
        : DEFAULT_EXPERIENCE_RATE;

    let level = Math.floor(Math.cbrt(normalizedExperience / normalizedRate)) + 1;
    while (getTotalExperienceForLevel(level + 1, normalizedRate) <= normalizedExperience) level += 1;
    while (level > 1 && getTotalExperienceForLevel(level, normalizedRate) > normalizedExperience) level -= 1;
    return level;
}

function rollK(random = Math.random) {
    const roll = Math.min(0.999999999, Math.max(0, Number(random()) || 0));
    let cumulativeProbability = 0;
    for (const tier of K_TIERS) {
        cumulativeProbability += tier.probability;
        if (roll < cumulativeProbability) return tier.k;
    }
    return 1;
}

function normalizeK(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 1 && parsed <= 4 ? parsed : null;
}

// A small lead stays on the ordinary curve. Farming far below one's level
// progressively reduces future awards, without taking away accumulated XP.
function overlevelExperienceFactor(opponentLevel, recipientLevel) {
    if (!Number.isFinite(recipientLevel) || recipientLevel <= 0) return 1;
    const rule = EXPERIENCE_BALANCE.overlevelPenalty;
    const grace = Math.max(rule.graceLevels, Math.ceil(opponentLevel * rule.graceRatio));
    const excess = Math.max(0, recipientLevel - opponentLevel - grace);
    return Math.max(rule.minimum, 1 / (1 + Math.pow(excess / rule.scale, 2)));
}

function calculateBattleExperience(defeatedPokemon, multiplier = 1, recipient = null) {
    const level = Math.max(1, Math.floor(Number(defeatedPokemon?.level) || 1));
    const k = normalizeK(defeatedPokemon?.k) || 1;
    const normalizedMultiplier = Number.isFinite(Number(multiplier)) ? Math.max(0, Number(multiplier)) : 1;
    const potentialBonus = 0.9 + (k * 0.1);
    const recipientLevel = Number(recipient?.level);
    const scaling = EXPERIENCE_BALANCE.levelScaling;
    const levelFactor = Number.isFinite(recipientLevel) && recipientLevel > 0
        ? Math.max(scaling.minimum, Math.min(scaling.maximum, Math.pow(level / recipientLevel, scaling.exponent)))
        : 1;
    return Math.max(1, Math.round((12 + 0.9 * Math.pow(level, 2)) * potentialBonus * normalizedMultiplier * levelFactor * overlevelExperienceFactor(level, recipientLevel)));
}

module.exports = {
    BATTLE_EXPERIENCE_MULTIPLIERS,
    DEFAULT_EXPERIENCE_RATE,
    K_TIERS,
    calculateBattleExperience,
    overlevelExperienceFactor,
    getExperienceRate,
    getLevelFromExperience,
    getTotalExperienceForLevel,
    normalizeK,
    rollK
};
