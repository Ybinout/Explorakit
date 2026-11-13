const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{createHash}=require('node:crypto');
const dc2=require('../server/game/world/darkContinent2'),dc=require('../server/game/world/darkContinent'),terrain=require('../server/game/world/mapRepository'),edges=require('../server/game/world/darkContinentEdges'),content=require('../server/game/raids/content'),rotation=require('../server/game/raids/rotation');
const configs=require('../data/game/nextMap.json').maps;
test('all 144 supplied files retain their exact bytes and all 48 authored maps retain their 6×8 arrangement',()=>{
 const manifest=require('../docs/dark-continent2-author-assets.json');assert.equal(manifest.files.length,144);
 for(const f of manifest.files)assert.equal(createHash('sha256').update(fs.readFileSync(f.target)).digest('hex'),f.sha256,f.target);
 for(let n=1;n<=48;n++){const id='DC2_'+String(n).padStart(2,'0'),m=dc2.maps.get(id);assert.equal(m.col,(n-1)%6);assert.equal(m.row,Math.floor((n-1)/6));assert.equal(m.background,id.toLowerCase());assert.equal(terrain.readMap(id).width,28);assert.equal(terrain.readMap(id).height,20);}
});
test('508 author portals preserve destination cells, opposite directions and perpendicular alignment; every map is reachable from the real beach arrival',()=>{
 const reachable=require('../server/game/world/darkContinent2Topology').build();assert.equal(new Set([...reachable].map(k=>k.split(':')[0])).size,48);let links=0;
 const opposite={up:'down',down:'up',left:'right',right:'left'};
 for(const [map]of dc2.maps){const config=configs.find(m=>m.mapName===map);assert.deepEqual(edges.linksFor(map,terrain.readMap),config.mapchange);
  for(const l of config.mapchange){links++;assert(dc2.isMap(l.goto));assert.equal(edges.directionBetween(map,l.goto),l.edgeDirection);const p={currentmap:map,x:l.valX*32+16,y:l.valY*32+16},r=edges.departure(p,l.edgeDirection);assert(r);assert.equal(r.nextMap,l.goto);assert.equal(terrain.loadCollisionData(l.goto)[Math.floor(r.nextY/32)][Math.floor(r.nextX/32)],0);const back=edges.departure({currentmap:r.nextMap,x:r.nextX,y:r.nextY},opposite[l.edgeDirection]);assert.equal(back.nextMap,map);assert.equal(back.nextX,p.x);assert.equal(back.nextY,p.y);if(['left','right'].includes(l.edgeDirection))assert.equal(r.nextY,p.y);else assert.equal(r.nextX,p.x);}
 }
 assert.equal(links,508);for(const p of[dc2.config.arrival,dc2.config.final])assert(reachable.has(p.map+':'+Math.floor(p.x/32)+':'+Math.floor(p.y/32)));
});
test('levels progress geographically toward the pyramid; all wild traits, caps and native Dark restrictions apply',async()=>{
 const wild=require('../server/game/world/wildPokemonFactory'),encounters=require('../server/game/world/darkEncounters');
 for(const [map,m]of dc2.maps){assert(dc.isMap(map));assert.equal(dc.maxLevel(map),1000);assert.deepEqual(dc.levels(map),[m.level.min,m.level.max]);assert(m.level.min>=300&&m.level.max<=1000);assert(m.raidLevel>=300&&m.raidLevel<=1000);
  for(const other of dc2.config.maps){const distance=a=>Math.abs(a.col-3)+a.row;if(distance(other)<distance(m))assert(other.level.min>=m.level.min);}
  for(const roll of[0,.5,.999999]){const p=await wild(map,()=>roll);assert(p.level>=300&&p.level<=1000);assert(p.k>=2);assert.equal(p.currentHp,p.maxHp);assert(p.abilities.length);assert(p.level<=Math.min(1000,m.level.max+5));if(roll===0){assert(encounters.isCorrupted(p,map));assert(Object.values(p.iv).every(v=>v===31));assert(Object.values(p.ev).every(v=>v===250));}else{assert(Object.values(p.iv).every(v=>v>=20&&v<=28));assert.equal(Object.values(p.ev).reduce((a,b)=>a+b),510);}}
  const state=require('../server/game/battle/battleEngine').createBattleState({mapName:map,battleType:'wild'});assert.equal(require('../server/game/battle/wildEscape').canFleeWildBattle({}, {},state),false);assert(configs.find(c=>c.mapName===map).canCapture===false);
 }
 assert.equal(dc2.maps.get('DC2_44').level.min,300);assert.equal(dc2.maps.get('DC2_04').level.max,1000);assert.equal(dc.maxLevel('jungle9'),300);
});
test('new geography adds 48 native raids, with one permanent, reachable level-1000 final rift on the pyramid',()=>{
 const world=content.createDay(1000),all=world.rifts.filter(r=>r.region==='dark2');assert.equal(all.length,48);assert.equal(world.rifts.length,62);const final=all.find(dc2.isFinal);assert(final);assert.equal(content.bossFor(final).level,1000);assert.equal(final.map,'DC2_04');assert.equal(final.x,dc2.config.final.x);assert.equal(final.y,dc2.config.final.y);
 const motion=require('../server/game/raids/worldMotion'),before=structuredClone(final);for(const now of[1e5,1e12]){assert.equal(motion.step(final,now,[],()=>{throw Error('Fixed rift moved');},()=>0),false);assert.deepEqual(motion.position(final,now),{x:final.x,y:final.y});}assert.deepEqual(final,before);
 for(const r of all){assert(require('../server/game/world/darkContinent2Topology').reachable(r.map,r.x,r.y));assert.equal(content.DIFFICULTIES.find(d=>d.id===r.difficulty).level,dc2.maps.get(r.map).raidLevel);assert(require('../server/game/drift/pokemonFactory').legendary.has(r.bossSpecies)||rotation.pool(r.map,world.day).includes(r.bossSpecies));}
 const closed=rotation.closedWorld(world,{phase:'won',rift:final},2000),r=closed.rifts.find(dc2.isFinal);assert(r.closedUntil);rotation.reopen(closed,r.closedUntil,()=>0);assert.deepEqual({x:r.x,y:r.y},{x:final.x,y:final.y});assert(r.fixed);
});
test('upgrading an old world adds new anchors exactly once without changing its IDs, seeds, movement or cooldowns',()=>{
 const w=content.createDay(1000);w.layoutVersion=2;w.rifts=w.rifts.filter(r=>r.region!=='dark2');w.rifts[0].closedUntil=1e9;const old=structuredClone(w.rifts);assert(rotation.upgrade(w));assert.equal(w.layoutVersion,4);assert.equal(w.rifts.length,62);assert.deepEqual(w.rifts.slice(0,14),old);assert.equal(rotation.upgrade(w),false);
});
test('chart is restricted to actual old-island level-300 raids; final pearls repeat in addition to the normal roll',()=>{
 for(const map of['jungle1','jungle9'])assert(dc2.eligibleChart({map,difficulty:'extreme'}));for(const r of[{map:'jungle9',difficulty:'easy'},{map:'safari15',difficulty:'extreme'},{map:'DC2_44',difficulty:'dc2-300'},{map:'jungle9',difficulty:'extreme',training:true}])assert(!dc2.eligibleChart(r));
 const final={anchor:'dark2:final',map:'DC2_04',difficulty:'dc2-final',fixed:true};for(let i=0;i<3;i++){assert.equal(content.rewards(final,()=>.99999).items.find(i=>i.key==='potential_pearl').quantity,2);assert.equal(content.rewards(final,()=>0).items.find(i=>i.key==='potential_pearl').quantity,3);}
 for(const level of[300,400,600,900,1000]){const r=content.rewards('dc2-'+level,()=>.999999),ratio=level/300;assert.equal(r.money,Math.round(1000000*ratio));assert.equal(r.items.find(i=>i.key==='crystal_shard').quantity,1+Math.round(100*ratio));const plates=r.items.filter(i=>i.key.startsWith('dark_plate_'));assert.equal(plates.length,18);assert(plates.every(i=>i.quantity===Math.floor(ratio)));}
 assert.equal(content.rewards('extreme',()=>.99999).money,1000000);
});
test('minimap revelation is personal and does not mutate another account’s response',()=>{
 const {getRegionMap,regionLocation}=require('../server/game/world/regionMap');const before=getRegionMap(),doubt=getRegionMap({revealed:true}),found=getRegionMap({revealed:true,chartOwned:true});assert.equal(before.nodes.length,55);assert.equal(before.darkContinent.label,'Dark Continent');assert.equal(doubt.darkContinent.label,'Dark Continent ?');assert.equal(doubt.darkContinent2,null);assert.equal(found.darkContinent.label,'Île du Dark Continent');assert.equal(found.nodes.length,103);assert(found.width>before.width);assert(found.darkContinent2.width>400);assert.equal(regionLocation('DC2_44'),'DC2_44');assert.equal(getRegionMap().darkContinent2,null);
});
test('new journal objectives use real proofs, retain completion, and the rod/chart are unique keys',()=>{
 const j=require('../server/game/world/questJournal'),catalog=require('../data/game/items.json').items,base={journal_started:'true',journal_visit_dark:'true',dark_horizon_heard:'true'};
 const find=f=>j.derive({flags:{...base,...f}}).entries.find(q=>q.key==='journal_dc2_final');assert(!find({}));assert.equal(find({dc2_arrived:'true'}).status,'active');assert.equal(find({dc2_arrived:'true',dc2_final_won:'true'}).status,'completed');assert.equal(j.visitFlag('DC2_44'),'dc2_arrived');assert.equal(j.visitFlag('DC2_45'),null);
 for(const key of['fishing_rod',dc2.ITEM]){const item=catalog.find(i=>i.key===key);assert.equal(item.category,'key');assert(item.unique||item.purchaseLimit===1);}
});
test('beach guide has a reachable footprint and arrival is in interaction range; no normal travel can enter the new continent',()=>{
 const a=dc.actors('DC2_44')[0],p=dc2.config.arrival;assert.equal(a.name,'dark2_guide');assert(Math.abs(Math.floor(p.x/32)-a.x)+Math.abs(Math.floor(p.y/32)-a.y)<=1);assert.equal(terrain.loadCollisionData(p.map)[a.y][a.x],0);assert.equal(require('../server/game/world/flightTravel').flightDestination(p.map),null);assert.throws(()=>require('../server/game/world/friendFlight').destination({mode:'adventure',map:p.map,x:p.x,y:p.y},{visitedRegions:[p.map]}),/inaccessible/);
});
