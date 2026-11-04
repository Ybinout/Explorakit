const content = require('../superTournament/content');
const {pnjTeams} = require('../world/pnjTeamFactory');
const {getTotalExperienceForLevel} = require('../models/progression');
const {healTeam} = require('../world/playerRecovery');
const roles = ['Éclaireur','Dresseur','Dresseuse','Dresseur','Trio NRV','Trio NRV','Trio NRV','Champion','Champion','Dresseur','Champion','Championne','Championne','Dresseur','Champion','Dresseuse'];
const additions = {
 dia1:[21,161,263,264,400,262], aspha_route2:[58,229,262], town_lina:[39,35,36,468], town_bastien:[55,18,128],
 nrv_noz:[198,215,452,229,359], nrv_tom:[405,254,466,181], nrv_cry:[271,365,423,134], moonpunch:[67,55,186],
 champion_hoze:[9,212,248], gwenn_route8:[128,121,3,59], champion_raphael:[160,55,359],
 champion_ana:[53,78,148], champion_wanda:[68,65,6], gwenn_rochebrume:[227,430,428],
 champion_7p:[94,80,135], lucie_corrupted:[395,68,196]
};
// The House has its own mature rosters. Never evolve the authored Adventure
// or Tower parties: some of their early forms are deliberate story choices.
const dex=new Set(require('../../../data/game/pokedex.json').filter(p=>p.id<=493).map(p=>p.id));
const next=new Map(),finalCache=new Map();
for(const r of [...require('../../../data/game/evolutions.json').rules,...require('../../../data/game/stone_evolutions.json').rules])
 if(dex.has(r.from)&&dex.has(r.to))next.set(r.from,[...new Set([...(next.get(r.from)||[]),r.to])]);
function finals(id){if(!finalCache.has(id))finalCache.set(id,next.has(id)?[...new Set(next.get(id).flatMap(finals))]:[id]);return finalCache.get(id);}
function matureRoster(candidates,preferred=[]){
 const mature=[...preferred,...candidates].filter(id=>!next.has(id));
 return [...new Set(candidates.map(id=>{const forms=finals(id);return mature.find(id=>forms.includes(id))||forms[0];}))].slice(0,6);
}
const catalogue = content.roster.map((entry,i)=>({...entry,index:i,role:roles[i],
 species:matureRoster([...(pnjTeams.get(entry.source)?.team||[]).map(p=>p.pokemonId),...entry.species,...(additions[entry.key]||[])],entry.species)}));
catalogue.push({key:'mathilde_pikapika',source:'mathilde_pikapika',name:'Mathilde Pikapika',role:'Dresseuse',portrait:'mathilde-v1.png',species:matureRoster([25,26,172,125,135,181,462,405])},
 {key:'professor_final',source:'professor_final',name:'Le Professeur',role:'Dresseur',portrait:'prof.png',species:matureRoster(pnjTeams.get('professor_final').team.map(p=>p.pokemonId))});
function list(){return catalogue.map(({key,name,role,portrait,species})=>({key,name,role,portrait,species}));}
function create(key, playerTeam, level, {uniqueItems=false}={}) {
 const entry=catalogue.find(t=>t.key===key);if(!entry)throw Object.assign(Error('Dresseur inconnu.'),{statusCode:409});
 // Tournament sets already use the shared strategic move/ability/item engine.
 // Mature the House's roster, preserving each original Pokémon's training.
 const source=require('../world/pnjTeamFactory').getPnjTeam(entry.source);
 const fallback=Number.isInteger(entry.index)?content.createTeam(entry.index).pokemons:[];
 const Pokemon=require('../models/Pokemon'),sets=require('../superTournament/teamSets');
 const pokemons=playerTeam.map((own,i)=>{
  const species=entry.species[i],original=source?.pokemons.find(p=>p.data.id===species)||source?.pokemons.find(p=>finals(p.data.id).includes(species))||fallback.find(p=>p.data.id===species);
  const setup=sets[species]||{},target=level||Math.max(1,own.level);
  const evolved=original&&original.data.id!==species;
  const p=evolved?new Pokemon(species,null,null,0,{...original.iv},original.nature,original.k,{...original.ev}):original?require('../drift/checkpointCodec').decode(require('../drift/checkpointCodec').encode(original)):new Pokemon(species,null,target,0);
  // An evolved species needs its own legal moves, talent and suitable held item.
  // In particular, a Raichu must not keep Pikachu's Light Ball.
  const planned=evolved||!original?require('../drift/colosseumSets').plan(species,16,i):null;
  if(planned){p.abilities=[...planned.moves];p.passiveAbility=planned.ability;p.heldItem=planned.item;}
  p.experience=getTotalExperienceForLevel(target,p.experienceRate);p.level=p.calculateLevelFromExperience(p.experience);p.recalculateStats();
  const trained=fallback.find(p=>p.data.id===species);if(trained)p.abilities=[...trained.abilities];
  // Fill missing sets through the existing legal move factory; never an empty AI turn.
  if(!p.abilities?.length){const built=require('../drift/pokemonFactory').create(species,target,true);p.abilities=[...built.abilities];}
  if(setup.abilities?.length)p.abilities=[...setup.abilities];
  if(setup.passiveAbility)p.passiveAbility=setup.passiveAbility;
  p.heldItem=setup.heldItem||p.heldItem||(['leftovers','life_orb','expert_belt','focus_sash','sitrus_berry','lum_berry'][i]);
  return p;
 });
 if(uniqueItems){const used=new Set();for(const p of pokemons){if(used.has(p.heldItem))p.heldItem=['leftovers','life_orb','expert_belt','focus_sash','sitrus_berry','lum_berry'].find(key=>!used.has(key));used.add(p.heldItem);}}
 const team={pokemons};healTeam(team);return team;
}
function music(key){return catalogue.find(t=>t.key===key)?.music||(key==='professor_final'?'lucie':'trainer');}
module.exports={list,create,music};
