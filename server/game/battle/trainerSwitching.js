// Switching estimates on sanitized planner views only. Current abilities are
// known; incomplete legacy views fall back to hypotheses from the species.
const engine = require('./battleEngine');
const { getSpeciesAbilitySlots } = require('../abilities/abilityDex');
const pools = new Map();

function abilities(p) {
    if (!p || p.__battle?.abilitySuppressed) return [null];
    if (Object.hasOwn(p, 'passiveAbility')) return [p.passiveAbility];
    const id = p.data?.id;
    if (!pools.has(id)) {
        const names = [...new Set(getSpeciesAbilitySlots(id).filter(s => !s.special).map(s => s.name))];
        pools.set(id, names.length ? names : [null]);
    }
    return pools.get(id);
}

function chance(p, opponent, field) {
    if (!p) return 0;
    let allowed = 0, total = 0;
    for (const own of abilities(p)) for (const rival of abilities(opponent)) {
        const clone = (source, passiveAbility) => ({ ...source, passiveAbility, __battle: {
            ...source.__battle, statStages: { ...source.__battle?.statStages }, sleepTurns: source.__battle?.sleepTurns ?? 1
        } });
        const candidate = clone(p, own);
        const target = opponent ? clone(opponent, rival) : null;
        total++;
        if (engine.canSwitchOut(candidate, target, field)) allowed++;
    }
    return allowed / total;
}

module.exports = { chance };
