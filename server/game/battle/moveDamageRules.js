// Conditional powers shared by real damage and deterministic AI previews.
// This module only reads the supplied board; it never examines queued actions.
const MAJOR_STATUSES = new Set(['burn', 'poison', 'badly_poison', 'paralyze', 'sleep', 'freeze']);
const SPECIAL_DEFENSE_OVERRIDES = new Set(['Psyshock', 'Psystrike', 'Secret Sword']);
const IGNORE_DEFENSE_STAGES = new Set(['Chip Away', 'Sacred Sword']);
const ALWAYS_CRITICAL = new Set(['Frost Breath', 'Storm Throw']);
const CRASH_MOVES = new Set(['Jump Kick', 'High Jump Kick']);
const HIDDEN_POWER_TYPES = ['Fighting','Flying','Poison','Ground','Rock','Bug','Ghost','Steel','Fire','Water','Grass','Electric','Psychic','Ice','Dragon','Dark'];
function hiddenPowerType(pokemon) {
    if (HIDDEN_POWER_TYPES.includes(pokemon?.hiddenPowerType)) return pokemon.hiddenPowerType;
    const stats = ['hp','attack','defense','speed','specialAttack','specialDefense'];
    if (stats.every(stat => Number.isInteger(pokemon?.iv?.[stat]))) {
        const bits = stats.reduce((sum,stat,index) => sum + (pokemon.iv[stat] % 2) * 2 ** index, 0);
        return HIDDEN_POWER_TYPES[Math.floor(bits * 15 / 63)];
    }
    // An opposing IV spread is private. Until the type is seen in battle,
    // the planner retains a neutral unknown-type approximation.
    return pokemon?.__battle?.revealedHiddenPowerType || 'Normal';
}
function damagedThisTurn(pokemon, state, source = null) {
    const data = pokemon?.__battle || {};
    return data.lastDamageTurn === state?.turn && data.lastDamageTaken > 0
        && (!source || data.lastDamageSource === source.uuid);
}
function power(move, attacker, defender, context = {}) {
    const base = Math.max(0, Number(move.power) || 0), field = context.battleState;
    switch (move.ename) {
        case 'Eruption':
        case 'Water Spout': return Math.max(1, Math.floor(base * attacker.currentHp / Math.max(1, attacker.maxHp)));
        case 'Brine': return base * (defender.currentHp <= defender.maxHp / 2 ? 2 : 1);
        case 'Hex': return base * (MAJOR_STATUSES.has(defender.status) ? 2 : 1);
        case 'Venoshock': return base * (['poison', 'badly_poison'].includes(defender.status) ? 2 : 1);
        case 'Acrobatics': return base * (!attacker.heldItem ? 2 : 1);
        case 'Smelling Salts': return base * (defender.status === 'paralyze' ? 2 : 1);
        case 'Wake-Up Slap': return base * (defender.status === 'sleep' || defender.passiveAbility === 'Comatose' && !defender.__battle?.abilitySuppressed ? 2 : 1);
        case 'Revenge':
        case 'Avalanche': return base * (damagedThisTurn(attacker, field, defender) ? 2 : 1);
        case 'Assurance': return base * (damagedThisTurn(defender, field) || defender.__battle?.lastHurtTurn === field?.turn ? 2 : 1);
        case 'Payback': return base * (context.movedLast ? 2 : 1);
        case 'Facade': return base * (['burn', 'poison', 'badly_poison', 'paralyze'].includes(attacker.status) ? 2 : 1);
        case 'Knock Off': return base * (context.canKnockOffItem ? 1.5 : 1);
        default: return base;
    }
}
function failure(move, attacker, defender, state, {types = p => [p.type1, p.type2].filter(Boolean)} = {}) {
    const data = attacker.__battle || {};
    if (move.combat?.power_type === 'ohko') {
        if (attacker.level < defender.level) return 'Cette capacité échoue sur une cible de niveau supérieur.';
        if (move.ename === 'Sheer Cold' && types(defender).includes('Ice')) return 'Glaciation est sans effet sur les Pokémon de type Glace.';
    }
    if (move.ename === 'Dream Eater' && defender.status !== 'sleep'
        && !(defender.passiveAbility === 'Comatose' && !defender.__battle?.abilitySuppressed)) return 'La cible ne dort pas.';
    if (move.ename === 'Focus Punch' && damagedThisTurn(attacker, state)) return 'Mitra-Poing échoue : le lanceur a perdu sa concentration.';
    if (move.ename === 'Synchronoise' && !types(attacker).some(t => types(defender).includes(t))) return 'La cible ne partage aucun type avec le lanceur.';
    if (move.ename === 'Belch' && !state?.berryEaters?.includes(attacker.uuid)) return 'Éructation nécessite d’avoir consommé une baie.';
    if (move.ename === 'Last Resort' && (!attacker.abilities?.includes('Last Resort') || !attacker.abilities?.some(name => name !== 'Last Resort')
        || attacker.abilities.some(name => name !== 'Last Resort' && !data.usedMoves?.includes(name)))) return 'Dernier Recours nécessite d’avoir utilisé les autres capacités.';
    return null;
}
function curedStatus(move) {
    return move.ename === 'Wake-Up Slap' ? 'sleep' : move.ename === 'Smelling Salts' ? 'paralyze' : null;
}
module.exports = {power, failure, curedStatus, damagedThisTurn, hiddenPowerType, HIDDEN_POWER_TYPES, SPECIAL_DEFENSE_OVERRIDES, IGNORE_DEFENSE_STAGES, ALWAYS_CRITICAL, CRASH_MOVES};
