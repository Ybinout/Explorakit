const fs=require('node:fs'),path=require('node:path');
const names=require('../vue-explorakit/src/data/gameNames.fr.json');
fs.writeFileSync(path.resolve(__dirname,'../data/game/corruption_labels.fr.json'),JSON.stringify({moves:names.moves,abilities:names.abilities},null,2)+'\n');
const {registry}=require('../server/game/corruption/modules');
const file=path.resolve(__dirname,'../vue-explorakit/src/data/corruptionModules.json');
fs.writeFileSync(file,JSON.stringify(Object.fromEntries(registry),null,2)+'\n');
console.log(`${registry.size} module definitions exported.`);

fs.copyFileSync(path.resolve(__dirname,'../data/game/corruption_recipes.json'),path.resolve(__dirname,'../vue-explorakit/src/data/corruptionRecipes.json'));

fs.writeFileSync(path.resolve(__dirname,'../vue-explorakit/src/data/corruptionBalance.json'),JSON.stringify({...require('../data/game/corruption_balance.json'),restrictedSpecies:[...require('../server/game/drift/pokemonFactory').legendary]},null,2)+'\n');

// Exact acquisition pools; provenance is informational, never a separate RNG.
const {pools}=require('../server/game/corruption/modules');
const dex=require('../data/game/pokedex.json'),{getSpeciesAbilitySlots}=require('../server/game/abilities/abilityDex');
const poolView=Object.fromEntries(Object.entries(pools).map(([type,pool])=>[type,pool.ability.map(key=>{const item=registry.get(key),ability=item.corruptionModule.ability;return {key,ability,name:names.abilities[ability]||ability,species:dex.filter(p=>p.id<=649&&p.type.includes(type)&&getSpeciesAbilitySlots(p.id).some(a=>a.name===ability)).map(p=>({id:p.id,name:p.name.french||p.name.english}))};})]));
fs.writeFileSync(path.resolve(__dirname,'../vue-explorakit/src/data/corruptionAbilityPools.json'),JSON.stringify(poolView,null,2)+'\n');
