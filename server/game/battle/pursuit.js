// Used only by execution, after choices have been committed. Never pass the
// live turn plan to the AI: it considers switches as independent hypotheses.
const { pendingMove } = require('./turnActions');
const SWITCHING = Symbol('pursuitSwitching');
function switching(state,pokemon) { return Boolean(pokemon?.uuid && state?.[SWITCHING] === pokemon.uuid); }
function intercept(state, outgoing, pursuer, attack) {
    if (!(outgoing?.currentHp > 0) || !(pursuer?.currentHp > 0)
        || pendingMove(state,pursuer) !== 'Pursuit') return false;
    const previous = Object.getOwnPropertyDescriptor(state,SWITCHING);
    // An in-flight interception must never become durable history in a save
    // emitted by an animation callback or checkpoint taken during the attack.
    Object.defineProperty(state,SWITCHING,{value:outgoing.uuid,writable:true,configurable:true,enumerable:false});
    // A Pokémon recalled voluntarily no longer maintains Destiny Bond.
    if (outgoing.__battle) outgoing.__battle.destinyBond = false;
    const restore = () => {
        if (previous === undefined) delete state[SWITCHING];
        else Object.defineProperty(state,SWITCHING,previous);
    };
    try {
        const result = attack();
        if (result && typeof result.then === 'function') return result.finally(restore).then(() => true);
        restore(); return true;
    } catch (error) { restore(); throw error; }
}
module.exports = { intercept, switching, SWITCHING };
