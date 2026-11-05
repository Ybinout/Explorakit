// Inventory the currently playable Gen1–5 species; no SQL or game mutations.
const dex=require('../data/game/pokedex.json');
const abilityDex=require('../server/game/abilities/abilityDex');
const coverage=require('../server/game/abilities/abilityCoverage');
const {FAMILY_ABILITIES}=require('../server/game/abilities/abilityEngine');
const {REACTION_ABILITIES}=require('../server/game/abilities/abilityReactions');
const {ABILITIES}=require('../server/game/abilities/abilityForms');
const modules=require('../server/game/corruption/modules');
const labels=require('../data/game/corruption_labels.fr.json').abilities;
const corrections={
 Protean:['activation after the action gate','read-only move-display metadata','future attacks and calling moves do not change type'],
 Levitate:['Ground status moves such as Sand Attack are not blocked'],
 Synchronize:['Gen7 toxic poison stays toxic','reflection no longer inherits the original move type; Safeguard and abilities still apply'],
 'Poison Touch':['Shield Dust blocks the contact poison'],
 'Shield Dust':['also prevents Poison Touch'],
 'Sticky Hold':['Mold Breaker can bypass it for Thief and Covet'],
 'Mold Breaker':['Thief and Covet follow the same Sticky Hold bypass as Knock Off'],
 'Magic Guard':['Powder damage prevented','toxic counter still advances while damage is prevented'],
 'Poison Heal':['toxic counter still advances while poison damage is replaced by healing'],
 Analytic:['opposing switches and other non-attack actions count as having no remaining move'],
 Forewarn:['OHKO, counter and variable-power attacks ranked correctly','status-only sets give no false threat']
};
function buildReport(){
 const species=dex.filter(p=>p.id<=649),names=[...new Set(species.flatMap(p=>abilityDex.getSpeciesAbilitySlots(p.id).map(a=>a.name)))].sort(),errors=[];
 const abilities=names.map(name=>{
  const scope=coverage.status(name),owners=species.filter(p=>abilityDex.getSpeciesAbilitySlots(p.id).some(a=>a.name===name));
  if(scope==='missing')errors.push('Unclassified ability: '+name);
  if(!abilityDex.getAbilityDefinition(name))errors.push('Missing definition: '+name);
  const families=Object.entries(FAMILY_ABILITIES).filter(([,list])=>list.includes(name)).map(([family])=>family);
  if(REACTION_ABILITIES.includes(name))families.push('reactions');if(ABILITIES.includes(name))families.push('forms');
  return{name,french:labels[name]||name,scope,species:owners.map(p=>p.id),hiddenFor:owners.filter(p=>abilityDex.getSpeciesAbilitySlots(p.id).some(a=>a.name===name&&a.hidden)).map(p=>p.id),families,
   corruptionPlateTypes:Object.keys(modules.pools).filter(type=>modules.pools[type].ability.some(key=>modules.get(key).corruptionModule.ability===name)),
   lifecycleTest:scope==='single_battle'?'tests/ability-review-2026.test.js: Complete shared lifecycle, snapshot and permanent identity: '+name:null,
   corrections:corrections[name]||[]};
 });
 return{scope:'649 species, generations 1–5; existing Gen7 battle mechanics and hidden abilities',speciesChecked:species.length,totalStudied:abilities.length,
  overworld:abilities.filter(a=>a.scope==='overworld').map(a=>a.name),singleBattle:abilities.filter(a=>a.scope==='single_battle').length,doublesOnly:abilities.filter(a=>a.scope==='double_only').map(a=>a.name),overworldPending:abilities.filter(a=>a.scope==='overworld_pending').map(a=>a.name),
  correctedAbilities:abilities.filter(a=>a.corrections.length).map(a=>a.name),abilities,errors};
}
if(require.main===module){const report=buildReport();console.log(JSON.stringify(report,null,2));if(report.errors.length)process.exitCode=1;}
module.exports={buildReport};
