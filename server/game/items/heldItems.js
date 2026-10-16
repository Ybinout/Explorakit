const { getItemDefinition, getMoveDefinition } = require('../battle/battleResources');
const { evolvable } = require('../../../data/game/stone_evolutions.json');
const canEvolve = new Set(evolvable);
function enabled(pokemon, state) {
    return Boolean(pokemon?.heldItem && !(pokemon.__battle?.embargoTurns > 0) && !(state?.field?.magicRoomTurns > 0)
        && !(pokemon.passiveAbility === 'Klutz' && !pokemon.__battle?.abilitySuppressed));
}
function effect(pokemon, state) { return enabled(pokemon, state) ? getItemDefinition(pokemon.heldItem)?.battle_effect : null; }
function statMultiplier(pokemon, stat, state) {
    const key = effect(pokemon, state);
    if (key === `choice_${stat}` || (key === 'assault_vest' && stat === 'specialDefense')) return 1.5;
    if (key === 'eviolite' && ['defense','specialDefense'].includes(stat) && canEvolve.has(pokemon.data?.id)) return 1.5;
    return 1;
}
function damageMultiplier(pokemon, effectiveness, state) {
    const key = effect(pokemon, state);
    return key === 'life_orb' ? 1.3 : key === 'expert_belt' && effectiveness > 1 ? 1.2 : 1;
}
function allowsMove(pokemon, name, state) {
    if (name === 'Struggle') return true;
    const key = effect(pokemon, state);
    if (key === 'assault_vest' && getMoveDefinition(name)?.combat?.damage_class === 'status') return false;
    return !key?.startsWith('choice_') || !pokemon.__battle?.choiceMove || pokemon.__battle.choiceMove === name;
}
function lockMove(pokemon, name, state) {
    if (name !== 'Struggle' && effect(pokemon, state)?.startsWith('choice_')) pokemon.__battle.choiceMove ||= name;
}
module.exports = { enabled, effect, statMultiplier, damageMultiplier, allowsMove, lockMove };
