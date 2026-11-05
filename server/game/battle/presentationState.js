// Visual history only: weak references never enter saves or public player DTOs.
const viewers = new WeakMap();
const {gender}=require('../items/stoneEvolution');
function genders(own,enemy) {
    const visible=p=>p?.storyActor||p?.isEgg?null:gender(p);
    return {player:visible(own),opponent:enemy?.__battle?.illusion?.gender||visible(enemy)};
}
function reset(viewer) { viewers.delete(viewer); }
function transitions(viewer, own, enemy, { initial = false } = {}) {
    const previous=viewers.get(viewer)||{}, next={}, events=[];
    for(const [side,pokemon] of [['player',own],['opponent',enemy]]){
        const old=previous[side],changed=old&&old.pokemon?.uuid!==pokemon?.uuid;
        const ko=old&&!old.fainted&&Number(old.pokemon?.currentHp)<=0;
        if(ko)events.push({side,kind:'faint',uuid:old.pokemon.uuid,name:(side==='opponent'?old.pokemon.__battle?.illusion?.name:null)||old.pokemon.truename||old.pokemon.name});
        else if(changed&&!old.fainted&&pokemon)events.push({side,kind:'recall',uuid:old.pokemon.uuid,name:(side==='opponent'?old.pokemon.__battle?.illusion?.name:null)||old.pokemon.truename||old.pokemon.name});
        if((changed||!old&&initial)&&pokemon&&Number(pokemon.currentHp)>0)events.push({side,kind:'enter',uuid:pokemon.uuid,name:(side==='opponent'?pokemon.__battle?.illusion?.name:null)||pokemon.truename||pokemon.name});
        if(pokemon)next[side]={pokemon,fainted:Number(pokemon.currentHp)<=0};
    }
    viewers.set(viewer,next);return events;
}
// Appearance-only projection: never mutate the actual ability or combat types.
function opponentPokemon(pokemon) {
    if(!pokemon)return null;
    const disguise=pokemon.__battle?.illusion;
    if(disguise){
        const types=Array.isArray(disguise.types)?disguise.types:null;
        return {...pokemon,passiveAbility:disguise.passiveAbility==='Illusion'?null:disguise.passiveAbility||null,
            ...(types?.length?{type1:types[0],type2:types[1]||null,data:{...pokemon.data,type:[...types]}}:{})};
    }
    // The first entry snapshot can precede initialization of the disguise.
    return pokemon.passiveAbility==='Illusion'&&!Object.hasOwn(pokemon.__battle||{},'illusion')
        ? {...pokemon,passiveAbility:null}:pokemon;
}
module.exports={reset,transitions,genders,opponentPokemon};
