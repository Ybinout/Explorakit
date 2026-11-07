const { getItemDefinition, getMoveDefinition } = require('../battle/battleResources');
const { evolvable } = require('../../../data/game/stone_evolutions.json');
const canEvolve = new Set(evolvable);
function enabled(pokemon, state) {
    return Boolean(pokemon?.heldItem && require('./heldItemPolicy').canHold(pokemon,pokemon.heldItem) && !(pokemon.__battle?.embargoTurns > 0) && !(state?.field?.magicRoomTurns > 0)
        && !(pokemon.passiveAbility === 'Klutz' && !pokemon.__battle?.abilitySuppressed));
}
function effect(pokemon, state) { return enabled(pokemon, state) ? getItemDefinition(pokemon.heldItem)?.battle_effect : null; }
function statMultiplier(pokemon, stat, state) {
    // Like the training gain, the Macho Brace penalty is not bypassed by Klutz.
    if (stat === 'speed' && require('./heldItemPolicy').canHold(pokemon,pokemon?.heldItem) && pokemon?.heldItem === 'macho_brace'
        && !(pokemon.__battle?.embargoTurns > 0) && !(state?.field?.magicRoomTurns > 0)) return .5;
    const key = effect(pokemon, state);
    if (key === `choice_corrupted_${stat}`) return getItemDefinition(pokemon.heldItem).statMultiplier;
    if (key === `choice_${stat}` || (key === 'assault_vest' && stat === 'specialDefense')) return 1.5;
    if (key === 'eviolite' && ['defense','specialDefense'].includes(stat) && canEvolve.has(pokemon.data?.id)) return 1.5;
    return 1;
}
function damageMultiplier(pokemon, effectiveness, state) {
    const key = effect(pokemon, state);
    return key === 'corrupted_life_orb' ? 1.2 : key === 'life_orb' ? 1.3 : key === 'expert_belt' && effectiveness > 1 ? 1.2 : 1;
}
function powerMultiplier(pokemon, move, state) {
    const key = effect(pokemon, state), category = move?.combat?.damage_class
        || (move?.category === 'phy' ? 'physical' : move?.category === 'spe' ? 'special' : 'status');
    if (key === 'type_power' && getItemDefinition(pokemon.heldItem)?.boost_type === move?.type) return 1.2;
    return key === 'physical_power' && category === 'physical' || key === 'special_power' && category === 'special' ? 1.1 : 1;
}
function drainAmount(pokemon, amount, state) { return Math.max(1,Math.floor(amount*(effect(pokemon,state)==='big_root'?1.3:1))); }
function fieldDuration(pokemon, kind, state, turns=5) {
    if(effect(pokemon,state)==='weather_rock' && getItemDefinition(pokemon.heldItem)?.weather===kind) return 8;
    if(effect(pokemon,state)==='light_clay' && ['reflect','light_screen','aurora_veil'].includes(kind)) return 8;
    return turns;
}
function skipsCharge(pokemon, move, state) { return effect(pokemon,state)==='power_herb' && move?.combat?.power_type==='charge' && move.ename!=='Sky Drop'; }
function protectsContact(pokemon,state) { return effect(pokemon,state)==='protective_pads'; }
function clearNegativeStages(pokemon) {
    const stages=pokemon.__battle?.statStages||{},negative=Object.keys(stages).filter(key=>stages[key]<0);
    for(const key of negative)stages[key]=0;
    return negative.length>0;
}
function clearMentalEffects(pokemon) {
    const data=pokemon.__battle||{},keys=['infatuationTurns','tauntTurns','encoreTurns','disableTurns','healBlockTurns'];
    if(!keys.some(key=>data[key]>0)&&!data.tormented)return false;
    for(const key of keys)data[key]=0;
    data.tormented=false;data.encoreMove=null;data.disabledMove=null;return true;
}
function accuracyMultiplier(pokemon, state) { return effect(pokemon, state) === 'accuracy_boost' ? 1.1 : 1; }
function criticalStage(pokemon, state) { return effect(pokemon, state) === 'critical_boost' ? 1 : 0; }
// Training is not a battle stat: suppression and Klutz do not change these EVs.
function effortMultiplier(pokemon) { return pokemon?.heldItem === 'macho_brace' && require('./heldItemPolicy').canHold(pokemon,pokemon.heldItem) ? 2 : 1; }
function allowsMove(pokemon, name, state) {
    if (name === 'Struggle') return true;
    const key = effect(pokemon, state);
    if (key === 'assault_vest' && getMoveDefinition(name)?.combat?.damage_class === 'status') return false;
    return !key?.startsWith('choice_') || !pokemon.__battle?.choiceMove || pokemon.__battle.choiceMove === name;
}
function lockMove(pokemon, name, state) {
    if (name !== 'Struggle' && effect(pokemon, state)?.startsWith('choice_')) pokemon.__battle.choiceMove ||= name;
}
function boundToSpecies(pokemon,recipient) {const item=getItemDefinition(pokemon?.heldItem),ids=[pokemon?.data?.id,recipient?.data?.id];return item?.abilityPlate===true&&ids.includes(493)||item?.battle_effect==='drive'&&ids.includes(649);}
module.exports = { boundToSpecies,enabled, effect, statMultiplier, damageMultiplier, powerMultiplier, drainAmount, fieldDuration, skipsCharge, protectsContact, clearNegativeStages, clearMentalEffects, accuracyMultiplier, criticalStage, effortMultiplier, allowsMove, lockMove };
