const balance = require('../../../data/game/capture_balance.json');
const knownBadges = new Set(require('../../../data/game/progression.json').badges.map(b => b.key));

function captureProgress(badges = []) {
    const earned = new Set(badges.filter(b => b.earned === true && knownBadges.has(b.key)).map(b => b.key));
    const badgeCount = earned.size, levels = balance.comfortableLevelsByBadges;
    return {
        badgeCount,
        comfortableLevel: levels[Math.min(badgeCount, levels.length - 1)],
        nextComfortableLevel: badgeCount < levels.length - 1 ? levels[badgeCount + 1] : null
    };
}

function captureAssessment(progress, pokemonLevel) {
    if (!progress) return null;
    const excessLevels = Math.max(0, Number(pokemonLevel) - progress.comfortableLevel);
    return {...progress, excessLevels, multiplier: Math.pow(balance.multiplierPerExcessLevel, excessLevels)};
}

module.exports = {captureProgress, captureAssessment};
