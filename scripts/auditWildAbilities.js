// Read-only audit of the local generation-7 rules, not a random Monte Carlo test.
const {getSpeciesAbilitySlots,chooseSpeciesAbility,HIDDEN_ABILITY_CHANCE,getAbilityDefinition}=require('../server/game/abilities/abilityDex');
const availability=require('./auditPokemonAvailability');
const reference=require('../vue-explorakit/src/data/pokemonReference.fr.json');
const dex=require('../data/game/pokedex.json');
const coverage=require('../server/game/abilities/abilityCoverage');

let available;
function availablePokemon(){return available||(available=availability.buildReport());}
function wildSpecies(){return availablePokemon().entries.filter(p=>p.method==='capture').map(p=>p.id).sort((a,b)=>a-b);}
function buildReport(){
 const wild=new Set(wildSpecies()),errors=[],species=[];
 const used=new Set(availablePokemon().entries.filter(p=>p.method!=='missing').map(p=>p.id));
 for(const pokemon of dex.filter(p=>used.has(p.id))){
  const slots=getSpeciesAbilitySlots(pokemon.id),normal=slots.filter(a=>!a.hidden&&!a.special),hidden=slots.filter(a=>a.hidden);
  if(!normal.length){errors.push(`#${pokemon.id}: no ordinary ability`);continue;}
  const possibilities=[];
  for(const group of [normal,hidden])for(const [index,slot]of group.entries()){
   const draws=hidden.length?[slot.hidden?0:.5,(index+.5)/group.length]:[(index+.5)/group.length];
   const actual=chooseSpeciesAbility(pokemon.id,()=>{if(!draws.length)throw Error('Unexpected ability draw');return draws.shift();});
   if(actual!==slot.name)errors.push(`#${pokemon.id}: ${slot.name} cannot be selected`);
   if(!getAbilityDefinition(slot.name))errors.push(`#${pokemon.id}: missing ability ${slot.name}`);
   if(!reference.abilities[slot.name])errors.push(`#${pokemon.id}: missing description ${slot.name}`);
   if(coverage.status(slot.name)==='missing')errors.push(`#${pokemon.id}: unclassified effect ${slot.name}`);
   const chance=hidden.length?(slot.hidden?HIDDEN_ABILITY_CHANCE/hidden.length:(1-HIDDEN_ABILITY_CHANCE)/normal.length):1/normal.length;
   possibilities.push({name:slot.name,hidden:slot.hidden,slot:slot.slot,chance,effectScope:coverage.status(slot.name)});
  }
  // Enumerate independent equiprobable bins for BOTH draws, including the
  // hidden boundary. This also detects a shared-draw bias between normal slots.
  const counts=new Map(),indexBins=normal.length*Math.max(1,hidden.length);let total=0;
  for(let branch=0;branch<100;branch++)for(let pick=0;pick<indexBins;pick++){
   const draws=hidden.length?[(branch+.5)/100,(pick+.5)/indexBins]:[(pick+.5)/indexBins];
   const name=chooseSpeciesAbility(pokemon.id,()=>draws.shift());counts.set(name,(counts.get(name)||0)+1);total++;
  }
  for(const name of new Set(possibilities.map(a=>a.name))){const expected=possibilities.filter(a=>a.name===name).reduce((n,a)=>n+a.chance,0);if(Math.abs((counts.get(name)||0)/total-expected)>1e-12)errors.push(`#${pokemon.id}: biased probability for ${name}`);}
  if([...counts.keys()].some(name=>!possibilities.some(a=>a.name===name)))errors.push(`#${pokemon.id}: illegal ability roll`);
  species.push({id:pokemon.id,name:pokemon.name.french,encounteredInWild:wild.has(pokemon.id),abilities:possibilities});
 }
 for(const id of wild)if(!species.some(p=>p.id===id))errors.push(`Wild species #${id} missing from ability data`);
 return{scope:availablePokemon().scope,ruleGeneration:7,hiddenAbilityChance:HIDDEN_ABILITY_CHANCE,speciesChecked:species.length,wildSpecies:wild.size,evolutionOnly:availablePokemon().evolutionOnly,wildSlots:species.filter(p=>p.encounteredInWild).reduce((n,p)=>n+p.abilities.length,0),wildHiddenSpecies:species.filter(p=>p.encounteredInWild&&p.abilities.some(a=>a.hidden)).length,missingAbilities:errors.length,errors,species};
}
if(require.main===module){const report=buildReport();console.log(JSON.stringify(report,null,2));if(report.errors.length)process.exitCode=1;}
module.exports={buildReport,wildSpecies,availablePokemon};
