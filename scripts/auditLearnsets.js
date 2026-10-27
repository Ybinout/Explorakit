// Per-species audit against an independent pinned PokeAPI extract. No DB writes.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),ref=require('../data/vendor/pokeapi/learnsets.gen7.json');
const catalog=require('../data/game/moves.json'),levels=require('../data/game/level_up_moves.json').species,machines=require('../data/game/machines.json').machines;
const dex=require('../data/game/pokedex.json'),wild=require('../server/game/world/wildPokemonFactory');
const {getMoveDefinition}=require('../server/game/battle/battleResources');
const baseline='7ce05b59ca2a9037a40e39a7b3f8f7cf1de8138e';
const itemBaseline='7c3e1fbac11cbead341188c185d633e8c6b1eafe';
const oldFile=(name,revision=baseline)=>JSON.parse(execFileSync('git',['show',`${revision}:${name}`],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024}));
const oldLevels=oldFile('data/game/level_up_moves.json').species,oldMachines=oldFile('data/game/machines.json').machines;
assert.deepEqual(require('../data/game/items.json').items.filter(i=>i.category!=='machine'),oldFile('data/game/items.json',itemBaseline).items.filter(i=>i.category!=='machine'),'Unrelated items changed');
for(const old of oldFile('data/game/moves.json'))assert.equal(catalog.find(m=>m.ename===old.ename)?.id,old.id,`Stable move identifier: ${old.ename}`);
function normalize(name){const n=name.toLowerCase().replace(/[^a-z0-9]/g,'');return {vicegrip:'visegrip',hijumpkick:'highjumpkick',smellingsalt:'smellingsalts'}[n]||n;}
const byName=new Map(catalog.map(m=>[normalize(m.ename),m])),byId=new Map(Object.entries(ref.moves).map(([id,m])=>[+id,m]));
const excluded=new Set([671]),errors=[],species=[],unavailable=new Map();
const key=entry=>JSON.stringify(entry),newNames=catalog.filter(m=>m.catalogueRevision===2).map(m=>m.ename);
let runtimeChecks=0,levelAdditions=0,machineAdditions=0;
(async()=>{
 for(const pokemon of dex.filter(p=>p.id<=493)) {
  const source=ref.species[pokemon.id],expected=[];
  for(const [level,id]of source.level){const known=byName.get(normalize(byId.get(id).name));if(known)expected.push([level,known.ename]);else {if(!unavailable.has(id))unavailable.set(id,{move:byId.get(id).name,species:[]});unavailable.get(id).species.push(pokemon.id);if(!excluded.has(id))errors.push(`Missing ${id} for ${pokemon.id}`);}}
  const actual=new Set((levels[pokemon.id]||[]).map(key)),wanted=new Set(expected.map(key));
  for(const entry of wanted)if(!actual.has(entry))errors.push(`Missing level move ${pokemon.id}: ${entry}`);
  for(const entry of actual)if(!wanted.has(entry))errors.push(`Unexpected level move ${pokemon.id}: ${entry}`);
  const before=new Set((oldLevels[pokemon.id]||[]).map(key)),added=expected.filter(e=>!before.has(key(e)));
  const current=Object.keys(machines).filter(k=>machines[k].species.includes(pokemon.id));
  const previous=Object.keys(oldMachines).filter(k=>oldMachines[k].species.includes(pokemon.id));
  const extra=current.filter(k=>!previous.includes(k));levelAdditions+=added.length;machineAdditions+=extra.length;
  species.push({id:pokemon.id,name:pokemon.name.french,levelEntries:actual.size,addedLevelEntries:added,csCount:current.length,addedCS:extra,errors:errors.filter(e=>e.includes(` ${pokemon.id}:`))});
  for(const level of[1,5,20,50,100]){
   const p=await wild.createAtLevel(pokemon.id,level),legal=new Set(expected.filter(e=>e[0]<=p.level).map(e=>e[1]));
   assert(p.abilities.length>=1&&p.abilities.length<=4,`Empty/oversized #${pokemon.id}`);
   assert.equal(new Set(p.abilities).size,p.abilities.length,`Duplicates #${pokemon.id}`);
   for(const name of p.abilities)assert(legal.has(name)&&getMoveDefinition(name),`Illegal initial ${name} #${pokemon.id} level ${level}`);
   assert.equal(p.abilities.length,p.movePp.length);runtimeChecks++;
  }
 }
 for(const [key,m]of Object.entries(machines)) {
  const source=ref.moves[m.moveId],known=source&&byName.get(normalize(source.name));
  if(known?.ename!==m.move)errors.push(`Wrong machine ID/name ${key}`);
  for(const id of m.species){const p=ref.species[id];const technical=ref.technical[m.moveId]?.includes(id);
   const extension=known?.catalogueRevision===2&&p&&(p.egg.includes(m.moveId)||p.machine.includes(m.moveId)||p.tutor.includes(m.moveId)||p.level.some(e=>e[1]===m.moveId));
   const storyException=m.move==='Purify'&&m.moveId===685&&dex.find(p=>p.id===id)?.type.includes('Poison');
   if(!technical&&!extension&&!storyException)errors.push(`Illegal machine ${key} for #${id}`);
  }
 }
 for(const [key,old]of Object.entries(oldMachines)){
  if(!machines[key])errors.push(`Removed existing CS ${key}`);
  if(machines[key]?.price!==old.price)errors.push(`Price changed ${key}`);
  for(const id of old.species)if(!machines[key]?.species.includes(id))errors.push(`Lost existing CS compatibility ${key} #${id}`);
 }
 const report={date:'2026-10-27',baseline,itemBaseline,source:{revision:ref.revision,url:ref.source,sha256:ref.sha256},scope:'493 playable base species; USUM natural level-up progression, legal TM/tutor transfers through generation 7, with Purify explicitly available to all Poison species. Tables for later existing species are retained.',
  summary:{species:species.length,runtimeEncounterChecks:runtimeChecks,referenceSpecies:Object.keys(ref.species).length,catalogueMoves:catalog.length,addedMoves:newNames.length,levelEntriesAdded:levelAdditions,machines:Object.keys(machines).length,previousMachines:Object.keys(oldMachines).length,newCompatibilities:machineAdditions,errors:errors.length},
  addedMoves:newNames,excluded:[...unavailable].map(([id,info])=>({id,...info,reason:excluded.has(id)?'Spotlight requires double battles, which RiftMon does not expose.':'Unimplemented'})),errors,species};
 if(process.argv.includes('--write'))fs.writeFileSync(path.join(root,'docs/LEARNSET_REVIEW.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report.summary));assert.equal(errors.length,0,errors.slice(0,20).join('\n'));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
