// Private, per-turn intentions. Never infer a pending action from lastMoveUsed:
// a status move, switch, item or an action already spent must not trigger Sucker Punch.
const { getUsableMoveIndexes } = require('./battleResources');
function planTurnActions(state, actions) {
    state.turnActions = {
        turn: state.turn,
        entries: actions.filter(a => a.pokemon?.uuid).map(a => ({
            uuid: a.pokemon.uuid, action: a.action,
            moveName: a.action === 'attack' && getUsableMoveIndexes(a.pokemon, state).length === 0 ? 'Struggle' : a.moveName,
            acted: false
        }))
    };
}
function spendTurnAction(state, pokemon) {
    const plan = state?.turnActions;
    if (plan?.turn !== state.turn) return;
    const entry = plan.entries.find(a => a.uuid === pokemon?.uuid);
    if (entry) entry.acted = true;
}
// A replacement after a direct K.O. can open a new choice before the field's
// end-of-round counter advances. The current queue is authoritative in that case.
function hasActedThisTurn(state, pokemon) {
    const plan = state?.turnActions;
    const entry = plan?.turn === state?.turn
        ? plan?.entries.find(action => action.uuid === pokemon?.uuid) : null;
    return entry ? entry.acted : pokemon?.__battle?.lastActionTurn === state?.turn;
}
function pendingMove(state, pokemon) {
    const plan = state?.turnActions;
    if (plan?.turn !== state.turn) return null;
    if (pokemon?.__battle?.rechargeMove) return null;
    return plan.entries.find(a => a.uuid === pokemon?.uuid && a.action === 'attack' && !a.acted)?.moveName || null;
}
module.exports = { planTurnActions, spendTurnAction, pendingMove, hasActedThisTurn };
