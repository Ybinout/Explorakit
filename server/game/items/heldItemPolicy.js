const {getItemDefinition}=require('../battle/battleResources');
const MESSAGE='Un objet corrompu est réservé aux Pokémon corrompus ; ceux-ci ne peuvent tenir que des objets corrompus.';
function canHold(pokemon,itemKey){return !itemKey||Boolean(pokemon?.corruption?.permanent)===Boolean(getItemDefinition(itemKey)?.corruptedHeldItem);}
function assertCanHold(pokemon,itemKey){if(!canHold(pokemon,itemKey))throw Object.assign(Error(MESSAGE),{statusCode:400});}
module.exports={canHold,assertCanHold,MESSAGE};
