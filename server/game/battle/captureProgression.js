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

// Same opening help in all modes, based on the target rather than the lead.
// Ball strength, expedition Drifts and Adventure badge penalties apply afterwards.
function captureBaseChance(pokemon) {
    const maxHp=Number(pokemon?.maxHp)>0?Number(pokemon.maxHp):1;
    const hp=Math.max(1,Math.min(maxHp,Number(pokemon?.currentHp)||1));
    const level=Number(pokemon?.level)||1, rule=balance.earlyGame;
    const opening=Math.max(0,Math.min(1,(rule.noBonusFromLevel-level)/(rule.noBonusFromLevel-rule.fullBonusThroughLevel)));
    return 0.16+(1-hp/maxHp)*0.64+rule.baseChanceBonus*opening;
}

function captureAssessment(progress, pokemonLevel) {
    if (!progress) return null;
    const excessLevels = Math.max(0, Number(pokemonLevel) - progress.comfortableLevel);
    return {...progress, excessLevels, multiplier: Math.pow(balance.multiplierPerExcessLevel, excessLevels)};
}

module.exports = {captureProgress, captureAssessment, captureBaseChance};
