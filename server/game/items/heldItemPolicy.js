const {getItemDefinition}=require('../battle/battleResources');
const MESSAGE='Un objet corrompu est réservé aux Pokémon corrompus ; ceux-ci ne peuvent tenir que des objets corrompus, hormis le Kit de survie et les baies mutées.';
function canHold(pokemon,itemKey){const kind=getItemDefinition(itemKey)?.berryKind;if(kind&&kind!=='mutation')return false;return !itemKey||getItemDefinition(itemKey)?.darkSurvival===true||getItemDefinition(itemKey)?.berryKind==='mutation'||Boolean(pokemon?.corruption?.permanent)===Boolean(getItemDefinition(itemKey)?.corruptedHeldItem);}
function assertCanHold(pokemon,itemKey){if(!canHold(pokemon,itemKey))throw Object.assign(Error(MESSAGE),{statusCode:400});}
module.exports={canHold,assertCanHold,MESSAGE};
