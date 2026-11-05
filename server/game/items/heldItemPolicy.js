const {getItemDefinition}=require('../battle/battleResources');
const MESSAGE='Un Pokémon corrompu ne peut tenir qu’un objet corrompu.';
function canHold(pokemon,itemKey){return !itemKey||!pokemon?.corruption?.permanent||getItemDefinition(itemKey)?.corruptedHeldItem===true;}
function assertCanHold(pokemon,itemKey){if(!canHold(pokemon,itemKey))throw Object.assign(Error(MESSAGE),{statusCode:400});}
module.exports={canHold,assertCanHold,MESSAGE};
