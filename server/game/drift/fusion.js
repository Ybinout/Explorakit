const catalogue = require('../../../data/game/drifts.json');
const effects = require('./driftEffects');
const report = require('./runReport');
const rarities = catalogue.rarities.map(r => r.key);
const definitions = new Map(catalogue.definitions.map(d => [d.id, d]));

// Never change bonuses while an attached battle is still being settled.
function consolidate(p) {
    if (p.npc || p.inbattle || p.run?.phase === 'results' ||
        p.equipe?.pokemons.some(poke => effects.states.has(poke))) return [];
    const merged = [];
    for (let tier = 0; tier < rarities.length - 1; tier++) {
        const groups = new Map();
        for (const drift of p.drifts || []) {
            const definition = definitions.get(drift.definitionId);
            if (drift.rarity !== rarities[tier] || definition?.values[drift.rarity] == null ||
                definition.values[rarities[tier + 1]] == null) continue;
            const key = JSON.stringify([drift.definitionId, drift.element || null]);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(drift);
        }
        for (const group of groups.values()) {
            // Keep the equipped UUID and its exact slot, even through a cascade.
            group.sort((a,b) => Number(p.equipped.includes(b.uuid)) - Number(p.equipped.includes(a.uuid)));
            while (group.length >= 2) {
                const [kept, consumed] = group.splice(0, 2);
                const from = kept.rarity;
                kept.rarity = rarities[tier + 1];
                p.drifts = p.drifts.filter(d => d.uuid !== consumed.uuid);
                report.driftFused(p, kept, consumed, from);
                merged.push({ name:definitions.get(kept.definitionId).name, rarity:kept.rarity });
            }
        }
    }
    if (merged.length) {
        p.ready = false;
        p.lastDriftFusion = { count:merged.length, ...merged[merged.length - 1] };
        report.syncDrifts(p);
    }
    return merged;
}
function acquire(p, drift, source) {
    p.drifts.push(drift);
    report.driftFound(p, drift, source);
    consolidate(p);
}
module.exports = { consolidate, acquire };
