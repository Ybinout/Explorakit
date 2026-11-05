// Independent per-species checks against the already pinned PokeAPI extract.
const assert=require('node:assert/strict');
const reference=require('../data/vendor/pokeapi/learnsets.gen7.json'),dex=require('../data/game/pokedex.json');
const levels=require('../data/game/level_up_moves.json').species,catalog=require('../data/game/moves.json');
const abilities=require('../server/game/abilities/abilityDex'),coverage=require('../server/game/abilities/abilityCoverage');
const factory=require('../server/game/world/wildPokemonFactory');
const normalize=name=>String(name).toLowerCase().replace(/[^a-z0-9]/g,'');
const aliases={vicegrip:'visegrip',hijumpkick:'highjumpkick',smellingsalt:'smellingsalts',celebration:'celebrate'};
const key=name=>aliases[normalize(name)]||normalize(name),moves=new Map(catalog.map(m=>[key(m.ename),m]));
async function audit(){
 const records=[],studied=new Set(),errors=[];let generated=0;
 for(const p of dex.filter(p=>p.id>=494&&p.id<=649)){
  const expected=reference.species[p.id].level.map(([level,id])=>{const source=reference.moves[id],move=moves.get(key(source.name));if(!move)errors.push(`Missing move ${source.name} for #${p.id}`);return[level,move?.ename];}).filter(([,m])=>m);
  assert.deepEqual(new Set((levels[p.id]||[]).map(JSON.stringify)),new Set(expected.map(JSON.stringify)),'Natural learning #'+p.id);
  const slots=abilities.getSpeciesAbilitySlots(p.id);for(const slot of slots){studied.add(slot.name);if(!['single_battle','double_only','overworld'].includes(coverage.status(slot.name)))errors.push(`Unimplemented ability ${slot.name} #${p.id}`);}
  for(const level of[1,5,20,60,75,90,100]){
   const wild=await factory.createAtLevel(p.id,level),legal=new Set(expected.filter(([at])=>at<=level).map(([,name])=>name));
   assert.equal(wild.level,level);assert(wild.currentHp>0&&wild.abilities.length>0&&wild.abilities.length<=4);
   for(const name of wild.abilities)assert(legal.has(name),`Illegal natural move ${name} #${p.id} at ${level}`);assert(slots.some(s=>s.name===wild.passiveAbility));generated++;
  }
  records.push({id:p.id,french:p.name.french,english:p.name.english,growthRate:p.exp/1000000,levelEntries:expected.length,abilitySlots:slots});
 }
 assert.deepEqual(errors,[]);
 return{scope:'All 156 newly playable generation-five base species; current RiftMon single-battle/Gen7 conventions',species:records.length,abilities:studied.size,runtimeEncounters:generated,errors,records};
}
if(require.main===module)audit().then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error(e.stack);process.exitCode=1;});module.exports={audit};
