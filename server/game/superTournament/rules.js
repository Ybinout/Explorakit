const {getItemDefinition}=require('../battle/battleResources');

// Registration clauses apply to the Adventure party before sealing its copy.
// Empty held-item slots are allowed in any number; forms share their species ID.
function validateRegistration(team){
 const party=team?.pokemons;
 if(!Array.isArray(party)||!party.length||party.length>6||party.some(p=>!p||p.isEgg))throw Error('Inscris une équipe de un à six Pokémon, sans Œuf.');
 const species=new Set(),items=new Set();
 for(const pokemon of party){
  const id=Number(pokemon.data?.id??pokemon.pokemonId);
  if(!Number.isSafeInteger(id)||id<1)throw Error('L’espèce d’un Pokémon de cette équipe est inconnue.');
  if(species.has(id))throw Error(`Une seule fois chaque espèce dans l’équipe : ${pokemon.name||pokemon.truename||`Pokémon n°${id}`} est présent deux fois.`);
  species.add(id);
  const item=typeof pokemon.heldItem==='string'?pokemon.heldItem.trim().toLowerCase():'';
  if(!item)continue;
  if(items.has(item))throw Error(`Un seul exemplaire de chaque objet tenu : ${getItemDefinition(item)?.name||item} est équipé plusieurs fois.`);
  items.add(item);
 }
}
module.exports={validateRegistration};
