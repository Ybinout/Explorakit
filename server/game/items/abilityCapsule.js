const {getSpeciesAbilitySlots}=require('../abilities/abilityDex');

function alternatives(pokemon){
    if(!pokemon || pokemon.isEgg)return [];
    const names=[...new Set(getSpeciesAbilitySlots(pokemon.data?.id).filter(slot=>!slot.special).map(slot=>slot.name))];
    const current=names.find(name=>name.toLowerCase()===String(pokemon.passiveAbility||'').trim().toLowerCase());
    return current?names.filter(name=>name!==current):[];
}
function result(pokemon,random=Math.random){
    if(!pokemon || pokemon.isEgg || !(pokemon.currentHp>0))throw Error('Choisis un Pokémon apte à s’entraîner.');
    const choices=alternatives(pokemon);
    if(!choices.length)throw Error('Ce Pokémon n’a aucun autre talent disponible. La Pilule Talent n’a pas été utilisée.');
    const roll=random();if(!Number.isFinite(roll)||roll<0||roll>=1)throw Error('Tirage de talent invalide.');
    const after=choices[Math.floor(roll*choices.length)];
    return{currentHp:pokemon.currentHp,status:pokemon.status,passiveAbility:after,trainingChange:{kind:'ability',before:pokemon.passiveAbility,after}};
}
function decorate(item,team){return item.fieldUse?.abilityReroll?{...item,abilityOptions:Object.fromEntries(team.map(p=>[p.uuid,alternatives(p)]))}:item;}
module.exports={alternatives,result,decorate};
