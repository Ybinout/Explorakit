// Permanent stats only: damage, combat stages and temporary speed/attack boosts
// must never appear as growth. Snapshot values rather than holding team references.
const STATS = { hp:'maxHp', attack:'attack', defense:'defense', specialAttack:'specialAttack', specialDefense:'specialDefense', speed:'speed' };
function growthSnapshot(pokemon) {
    const stats=Object.fromEntries(Object.entries(STATS).map(([key,field])=>[key,pokemon?.[field]]));
    if (!Object.values(stats).every(Number.isFinite)) return null;
    return { level:pokemon.level, species:pokemon.data?.id, stats };
}
function levelGrowth(pokemon,before) {
    const after=growthSnapshot(pokemon);
    if(!before || !after || !(after.level>before.level)) return null;
    return { uuid:pokemon.uuid, name:pokemon.truename || pokemon.name, pokemonId:after.species,
        previousLevel:before.level,level:after.level,evolved:before.species!==after.species,
        stats:Object.fromEntries(Object.keys(STATS).map(key=>[key,{before:before.stats[key],after:after.stats[key],gain:after.stats[key]-before.stats[key]}])) };
}
module.exports={growthSnapshot,levelGrowth};
