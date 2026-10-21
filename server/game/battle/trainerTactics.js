const ai = require('../drift/colosseumAI');

// Server-only plan, independent of slot swaps; the checkpoint codec preserves
// non-enumerable properties, while JSON/Socket snapshots do not expose them.
function attachPlan(team, definition) {
    if (!definition.strategy) return;
    const { name, acePokemonId, entryLines = {}, ai: policy } = definition.strategy;
    Object.defineProperty(team, '__trainerPlan', { configurable: true, value: {
        name, ai: policy,
        aceUuid: team.pokemons.find(p => p.data.id === acePokemonId)?.uuid,
        entryLines: Object.fromEntries(team.pokemons.filter(p => entryLines[p.data.id])
            .map(p => [p.uuid, entryLines[p.data.id]]))
    } });
}
function createMemory() { return { seen: {}, lastSwitchRound: -10, announced: new Set() }; }
function eligibleIndexes(team) {
    const alive = team.pokemons.map((p, i) => p.currentHp > 0 ? i : -1).filter(i => i >= 0);
    const ace = team.__trainerPlan?.aceUuid;
    const ordinary = alive.filter(i => team.pokemons[i].uuid !== ace);
    return ordinary.length ? ordinary : alive;
}
function replacementIndex(team) { return eligibleIndexes(team)[0] ?? -1; }
function chooseAction(team, opponent, field, memory, round) {
    const resources = require('./battleResources');
    if (resources.getChargingMove(team.pokemons[0])) return {action:'attack',number:resources.getUsableMoveIndexes(team.pokemons[0],field)[0]};
    if (team.__trainerPlan?.ai !== 'expert') return null;
    // Keep the active Pokémon in the simulation. A reserved ace is excluded
    // only from voluntary switches, never made immune to a forced switch.
    const indexes = [0, ...eligibleIndexes(team).filter(i => i !== 0)];
    const decision = ai.chooseAction({ team: indexes.map(i => team.pokemons[i]), opponent,
        field, ownSide: field.sides.enemy, enemySide: field.sides.player,
        memory, round, wave: 16, version: 5 });
    return decision?.action === 'change' ? { ...decision, number: indexes[decision.number] } : decision;
}
function observe(team, memory, actor, move, result) {
    if (team.__trainerPlan?.ai !== 'expert') return;
    ai.observe(memory, actor, move, result);
}
function decorateTransitions(events, team, memory) {
    const plan = team?.__trainerPlan;
    if (!plan) return events;
    memory.announced ||= new Set();
    return events.map(event => {
        const text = plan.entryLines[event.uuid];
        if (event.side !== 'opponent' || event.kind !== 'enter' || !text || memory.announced.has(event.uuid)) return event;
        memory.announced.add(event.uuid);
        return { ...event, trainerSpeech: { name: plan.name, text } };
    });
}
module.exports = { attachPlan, createMemory, replacementIndex, chooseAction, observe, decorateTransitions };
