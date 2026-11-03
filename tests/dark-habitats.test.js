const test=require('node:test'),assert=require('node:assert/strict');
const dc=require('../server/game/world/darkContinent'),maps=require('../data/game/nextMap.json').maps;
const wild=require('../server/game/world/wildPokemonFactory'),fish=require('../server/game/world/fishingEncounters');
test('each jungle has six species, all 36 remain available and each row has its own exclusive encounters',async()=>{
 const all=new Set();
 for(let col=0;col<3;col++){
  const zones=[1,4,7].map(n=>maps.find(m=>m.mapName==='jungle'+(n+col))),columnSpecies=new Set(zones.flatMap(m=>m.wildpokemon));
  assert.deepEqual([...columnSpecies].sort((a,b)=>a-b),[...dc.COLUMNS[col]].sort((a,b)=>a-b));
  for(const zone of zones){
   assert.equal(zone.wildpokemon.length,6);assert.equal(new Set(zone.wildpokemon).size,6);assert(zone.wildpokemon.some(id=>zones.every(m=>m===zone||!m.wildpokemon.includes(id))));
   for(const [index,id]of zone.wildpokemon.entries()){
    let draw=0;const p=await wild(zone.mapName,()=>++draw===1?(index+.5)/zone.wildpokemon.length:.5);assert.equal(p.data.id,id);all.add(id);
   }
  }
 }
 assert.equal(all.size,36);const first=maps.find(m=>m.mapName==='jungle1');assert(!first.wildpokemon.includes(212));assert(!first.wildpokemon.includes(94));
});
test('the first waters do not contain every aquatic species; central and eastern waters unlock distinct encounters',()=>{
 const [west,center,east]=fish.darkPools.map(p=>new Set(p.map(([id])=>id))),all=new Set([...west,...center,...east]);
 assert.equal(all.size,8);assert.equal(west.size,5);assert(center.size>=5&&east.size>=5);assert(!west.has(260));assert(!west.has(395));assert(!west.has(230));assert(center.has(260));assert(east.has(395)&&east.has(230));
 for(let n=1;n<=9;n++){
  const map='jungle'+n,pool=fish.darkPools[dc.column(map)];for(let j=0;j<1000;j++){let draw=0;const p=fish.fishingEncounter(map,()=>++draw===1?j/1000:.5);assert(pool.some(([id])=>id===p.id));}
 }
});
test('ordinary plates roll at exactly 3% on jungle1/4/7, with central/eastern chances and corrupted guarantees preserved',async()=>{
 const ordinary={data:{type:['Water']}};
 for(let n=1;n<=9;n++){
  const map='jungle'+n,chance=[.03,.10,.14][dc.column(map)];assert.equal(dc.lootProfile(map).plateChance,chance);
  assert(dc.loot(ordinary,()=>chance-.000001,map).some(i=>i.plateType));assert(!dc.loot(ordinary,()=>chance,map).some(i=>i.plateType));
  const rare=await wild(map,()=>0),found=dc.loot(rare,()=>.99,map),plates=found.filter(i=>i.plateType);assert.equal(plates.reduce((n,i)=>n+i.quantity,0),5);for(const key of['crystal_shard','clear_crystal','aurora_prism'])assert(found.find(i=>i.key===key).quantity>=5);
 }
});
test('talking requires adjacency to the actual body/feet and a distant prospecter cannot open the guide panel',async()=>{
 const actor=dc.actors('jungle1').find(a=>a.name==='dark_researcher');
 for(const [x,y]of [[8,6],[10,6],[9,7],[8,5],[10,5]])assert.equal(dc.interactionActor({currentmap:'jungle1',x:x*32+16,y:y*32+16,direction:'down'}).name,'dark_researcher');
 const events=[],p={currentmap:'jungle1',x:actor.x*32+16,y:(actor.y+2)*32+16},handler=require('../server/realtime/handlers/darkContinentHandlers').createHandlers({socket:{emit:(event,data)=>events.push({event,data})},account:{on(){}},getPlayer:()=>p,getState:()=>({}),canUse:()=>true});
 assert.equal(await handler.interact(),false);assert.equal(events.length,0);
});
