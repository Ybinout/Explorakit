const {randomUUID}=require('node:crypto');
function mirrorTeam(team){
    if(!Array.isArray(team?.pokemons)||team.pokemons.length>6)throw Error('Équipe invalide.');
    const pokemons=team.pokemons.filter(p=>p&&!p.isEgg).map(source=>{
        const clone=Object.assign(Object.create(Object.getPrototypeOf(source)),structuredClone(source));
        clone.uuid=randomUUID();
        for(const key of Object.keys(clone))if(key.startsWith('__'))delete clone[key];
        // All permanent properties, current HP, major status and remaining PP are copied.
        return clone;
    });
    if(!pokemons.some(p=>p.currentHp>0))throw Error('Aucun Pokémon apte au combat.');
    return {pokemons};
}
module.exports={mirrorTeam};
