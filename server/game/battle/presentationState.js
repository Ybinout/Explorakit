// Visual history only: weak references never enter saves or public player DTOs.
const viewers = new WeakMap();
function reset(viewer) { viewers.delete(viewer); }
function transitions(viewer, own, enemy) {
    const previous=viewers.get(viewer)||{}, next={}, events=[];
    for(const [side,pokemon] of [['player',own],['opponent',enemy]]){
        const old=previous[side],changed=old&&old.pokemon?.uuid!==pokemon?.uuid;
        const ko=old&&!old.fainted&&Number(old.pokemon?.currentHp)<=0;
        if(ko)events.push({side,kind:'faint',uuid:old.pokemon.uuid,name:old.pokemon.truename||old.pokemon.name});
        else if(changed&&!old.fainted&&pokemon)events.push({side,kind:'recall',uuid:old.pokemon.uuid,name:old.pokemon.truename||old.pokemon.name});
        if(changed&&pokemon)events.push({side,kind:'enter',uuid:pokemon.uuid,name:pokemon.truename||pokemon.name});
        if(pokemon)next[side]={pokemon,fainted:Number(pokemon.currentHp)<=0};
    }
    viewers.set(viewer,next);return events;
}
module.exports={reset,transitions};
