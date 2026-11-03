const test=require('node:test'),assert=require('node:assert/strict');
const dc=require('../server/game/world/darkContinent'),maps=require('../data/game/nextMap.json').maps;
const wild=require('../server/game/world/wildPokemonFactory'),fish=require('../server/game/world/fishingEncounters');
test('types unlock cumulatively west to east, including both types; only fully evolved ordinary species open in the east',async()=>{
 const habitats=require('../server/game/world/darkHabitats'),dex=require('../data/game/pokedex.json'),legend=require('../server/game/world/legendaryEncounters');
 const rules=[...require('../data/game/evolutions.json').rules,...require('../data/game/stone_evolutions.json').rules],evolving=new Set(rules.map(r=>r.from)),evolved=new Set(rules.map(r=>r.to));
 const expected=dex.filter(p=>p.id<=493&&!legend.isLegendary(p.id)&&evolved.has(p.id)&&!evolving.has(p.id));
 const all=new Set([...habitats.LAND[2],...habitats.WATER[2]]);for(const id of [1,2,4,5,7,8,25,58,64,67,82,93,95,112,117,123,125,126,133,233,281,315,356])assert(!all.has(id),'base/intermediate '+id);for(const id of [3,6,9,65,68,94,130,212,230,282,407,445,462,464,474,477])assert(all.has(id),'final evolution '+id);
 for(let col=0;col<3;col++){
  const allowed=new Set(habitats.TYPE_STAGES.slice(0,col+1).flat()),zones=[1,4,7].map(n=>maps.find(m=>m.mapName==='jungle'+(n+col))),species=new Set(zones.flatMap(m=>m.wildpokemon));
  assert.deepEqual([...species].sort((a,b)=>a-b),[...dc.COLUMNS[col]].sort((a,b)=>a-b));
  for(const zone of zones){assert.deepEqual(zone.wildpokemon,habitats.landPool(zone.mapName));assert.equal(new Set(zone.wildpokemon).size,zone.wildpokemon.length);
   for(const [index,id]of zone.wildpokemon.entries()){
    let draw=0;const p=await wild(zone.mapName,()=>++draw===1?(index+.5)/zone.wildpokemon.length:.5);assert.equal(p.data.id,id);assert(!p.data.type.includes('Water'));assert(p.data.type.every(t=>allowed.has(t)));assert(p.abilities.length>=1&&p.abilities.length<=4);assert.equal(p.currentHp,p.maxHp);
   }
  }
  const aquatic=fish.darkPools[col].map(([id])=>id),all=[...species,...aquatic];
  assert.deepEqual(new Set(all.flatMap(id=>dex.find(p=>p.id===id).type)),allowed);
  if(col===2){assert.deepEqual(new Set(all),new Set(expected.map(p=>p.id)));for(const zone of zones)assert.deepEqual(zone.wildpokemon,dc.COLUMNS[2]);}
  else assert(zones.some(m=>JSON.stringify(m.wildpokemon)!==JSON.stringify(zones[0].wildpokemon)));
 }
});
test('Water species are exclusive to fishing; dual types obey the same progressive unlocks',()=>{
 const habitats=require('../server/game/world/darkHabitats'),dex=require('../data/game/pokedex.json');
 for(let col=0;col<3;col++){
  const allowed=new Set(habitats.TYPE_STAGES.slice(0,col+1).flat()),ids=fish.darkPools[col].map(([id])=>id);
  assert.deepEqual(ids,habitats.WATER[col]);assert(ids.length>=5);
  for(const id of ids){const p=dex.find(p=>p.id===id);assert(p.type.includes('Water'));assert(p.type.every(t=>allowed.has(t)));}
  if(col>0)assert(fish.darkPools[col-1].every(([id])=>ids.includes(id)));
  for(let row=0;row<3;row++)for(const [index,id]of ids.entries()){
   const map='jungle'+(row*3+col+1);let draw=0;const encounter=fish.fishingEncounter(map,()=>++draw===1?(index+.5)/ids.length:.5);assert.equal(encounter.id,id);
  }
 }
});
test('ordinary plates roll at exactly 3% on jungle1/4/7, with central/eastern chances and corrupted guarantees preserved',async()=>{
 const ordinary={data:{type:['Water']}};
 for(let n=1;n<=9;n++){
  const map='jungle'+n,chance=map==='jungle9'?.20:[.03,.10,.14][dc.column(map)];assert.equal(dc.lootProfile(map).plateChance,chance);
  assert(dc.loot(ordinary,()=>chance-.000001,map).some(i=>i.plateType));assert(!dc.loot(ordinary,()=>chance,map).some(i=>i.plateType));
  const rare=await wild(map,()=>0),found=dc.loot(rare,()=>.99,map),plates=found.filter(i=>i.plateType);assert.equal(plates.reduce((n,i)=>n+i.quantity,0),5);for(const [index,key]of ['crystal_shard','clear_crystal','aurora_prism'].entries()){const quantity=found.find(i=>i.key===key).quantity;assert(quantity>=5);assert.equal(quantity,[[16,12,7],[26,18,10],[32,22,14]][dc.column(map)][index]);}
 }
});
test('talking requires adjacency to the actual body/feet and a distant prospecter cannot open the guide panel',async()=>{
 const actor=dc.actors('jungle1').find(a=>a.name==='dark_researcher');
 for(const [x,y]of [[8,6],[10,6],[9,7],[8,5],[10,5]])assert.equal(dc.interactionActor({currentmap:'jungle1',x:x*32+16,y:y*32+16,direction:'down'}).name,'dark_researcher');
 const events=[],p={currentmap:'jungle1',x:actor.x*32+16,y:(actor.y+2)*32+16},handler=require('../server/realtime/handlers/darkContinentHandlers').createHandlers({socket:{emit:(event,data)=>events.push({event,data})},account:{on(){}},getPlayer:()=>p,getState:()=>({}),canUse:()=>true});
 assert.equal(await handler.interact(),false);assert.equal(events.length,0);
});
