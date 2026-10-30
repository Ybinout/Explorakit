const {normalizeMovePp}=require('../battle/battleResources');
// Return only the two slot-based fields. Never heal PP or alter pending learning.
function reorderMoves(pokemon, payload = {}) {
    const moves=pokemon?.abilities, order=payload?.orderedIndexes, expected=payload?.expectedMoves;
    if(pokemon?.isEgg || !Array.isArray(moves) || !moves.length || moves.length>4)
        throw Error('Ce Pokémon ne peut pas réorganiser ses capacités.');
    if(!Array.isArray(expected) || expected.length!==moves.length || expected.some((name,i)=>name!==moves[i]))
        throw Error('Les capacités ont changé. Rouvre la fiche avant de réessayer.');
    if(!Array.isArray(order) || order.length!==moves.length || new Set(order).size!==moves.length ||
        order.some(i=>!Number.isInteger(i) || i<0 || i>=moves.length))throw Error('Ordre de capacités invalide.');
    const copy={...pokemon,movePp:[...(pokemon.movePp || [])]};
    const pp=normalizeMovePp(copy);
    return {abilities:order.map(i=>moves[i]),movePp:order.map(i=>pp[i])};
}
module.exports={reorderMoves};
