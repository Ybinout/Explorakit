// Gen 7 rampaging moves: only the first action costs PP; an interruption
// cancels the lock, with fatigue on the scheduled final action (except sleep).
const NAMES=Object.freeze({Outrage:'Colère',Thrash:'Mania','Petal Dance':'Danse Fleurs'});
function current(pokemon) {
    const d=pokemon?.__battle;
    return pokemon?.currentHp>0&&Object.hasOwn(NAMES,d?.rampageMove)&&Number.isInteger(d.rampageTurns)&&d.rampageTurns>0&&d.rampageTurns<=2
        ? {move:d.rampageMove,turns:d.rampageTurns}:null;
}
function clear(pokemon) {
    if(!pokemon?.__battle)return;
    delete pokemon.__battle.rampageMove;
    delete pokemon.__battle.rampageTurns;
}
function finish(pokemon,name,{before=current(pokemon),hit=false,eligible=true,random=Math.random,confuse=()=>{},messages=[]}={}) {
    if(!eligible||!Object.hasOwn(NAMES,name))return;
    if(!(pokemon?.currentHp>0)||pokemon.status==='sleep'){clear(pokemon);return;}
    if(before?.move===name) {
        if(hit&&before.turns>1){pokemon.__battle.rampageTurns=before.turns-1;return;}
        clear(pokemon);
        if(before.turns===1)confuse();
        return;
    }
    if(hit) {
        pokemon.__battle ||= {};
        pokemon.__battle.rampageMove=name;
        pokemon.__battle.rampageTurns=random()<.5?1:2;
        messages.push(`${pokemon.truename||pokemon.name||'Le Pokémon'} se déchaîne avec ${NAMES[name]} !`);
    }
}
module.exports={NAMES,current,clear,finish};
