// Effective battle typing. Roost must not overwrite persistent type changes.
function currentTypes(pokemon) {
    const data = pokemon?.__battle;
    const types = (data?.tempTypes?.length ? data.tempTypes
        : data?.formTypes?.length ? data.formTypes : [pokemon?.type1, pokemon?.type2]).filter(Boolean);
    if (!data?.roost) return types;
    const groundedTypes = types.filter(type => type !== 'Flying');
    return groundedTypes.length ? groundedTypes : ['Normal'];
}
module.exports = {currentTypes};
