// A future attack belongs to the opposing slot, not the Pokémon occupying it.
// Source references are trusted server objects; the checkpoint codec preserves them.
const LABELS = { 'Future Sight': 'Prescience', 'Doom Desire': 'Vœu Destructeur' };
function isFuture(move) { return Object.hasOwn(LABELS, typeof move === 'string' ? move : move?.ename); }
function schedule(side, source, move, state, sourceSide) {
    if (side.futureMove) return false;
    side.futureMove = { moveName: move.ename, source, sourceSide: sourceSide.name, dueTurn: state.turn + 2 };
    return true;
}
function takeDue(pokemon, opponent, side, otherSide, state) {
    const pending = side?.futureMove;
    if (!pending || pending.dueTurn > state.turn) return null;
    side.futureMove = null; // Remove before applying damage: replay cannot hit twice.
    return { ...pending, source: opponent?.uuid === pending.source?.uuid ? opponent : pending.source, target: pokemon, defenderSide: side, attackerSide: otherSide,
        sourceActive: opponent?.uuid === pending.source?.uuid && opponent.currentHp > 0 };
}
function damageSource(pending) {
    if (pending.sourceActive) return pending.source;
    const original = pending.source;
    const copy = { ...original, heldItem: null, passiveAbility: null, __battle: { statStages: {} } };
    for (const stat of ['Attack', 'Defense', 'SpecialAttack', 'SpecialDefense', 'Speed']) copy['current' + stat] = original[stat[0].toLowerCase() + stat.slice(1)];
    const drift = require('../drift/driftEffects');
    drift.copyTournamentPacts(original, copy);
    if (drift.states.has(original)) drift.states.set(copy, drift.states.get(original));
    return copy;
}
module.exports = { LABELS, isFuture, schedule, takeDue, damageSource };
