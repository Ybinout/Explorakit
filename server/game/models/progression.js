const DEFAULT_EXPERIENCE_RATE = 1;

const K_TIERS = Object.freeze([
    { k: 4, probability: 0.002, label: 'Exceptionnel' },
    { k: 3, probability: 0.018, label: 'Rare' },
    { k: 2, probability: 0.18, label: 'Prometteur' },
    { k: 1, probability: 0.8, label: 'Commun' }
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

function calculateBattleExperience(defeatedPokemon, multiplier = 1) {
    const level = Math.max(1, Math.floor(Number(defeatedPokemon?.level) || 1));
    const k = normalizeK(defeatedPokemon?.k) || 1;
    const normalizedMultiplier = Math.max(0, Number(multiplier) || 0);
    const potentialBonus = 0.9 + (k * 0.1);
    return Math.max(1, Math.round((12 + 0.9 * Math.pow(level, 2)) * potentialBonus * normalizedMultiplier));
}

module.exports = {
    DEFAULT_EXPERIENCE_RATE,
    K_TIERS,
    calculateBattleExperience,
    getExperienceRate,
    getLevelFromExperience,
    getTotalExperienceForLevel,
    normalizeK,
    rollK
};
