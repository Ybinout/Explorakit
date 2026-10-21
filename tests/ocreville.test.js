const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const maps=require('../server/game/world/mapRepository'),{isPnjBlockingTile,getPnjsForMap}=require('../server/game/world/pnjStore');
const world=require('../data/game/nextMap.json').maps,fingerprints=require('../docs/ocreville-author-assets.json');
function reachable(map,start){const c=maps.loadCollisionData(map),t=maps.changeMapData(map),seen=new Set(),q=[start];while(q.length){const [x,y]=q.shift(),k=`${x}:${y}`;if(seen.has(k)||c[y]?.[x]!==0||isPnjBlockingTile(map,x,y))continue;seen.add(k);if(t[y]?.[x])continue;for(const [dx,dy]of [[0,1],[0,-1],[1,0],[-1,0]])q.push([x+dx,y+dy]);}return seen;}
function safe(link){const p=maps.getNextMap(link.map,...link.tile);assert(p,link.map);const x=Math.floor(p.nextX/32),y=Math.floor(p.nextY/32);assert.equal(maps.loadCollisionData(p.nextMap)[y]?.[x],0,JSON.stringify(link));assert(!maps.changeMapData(p.nextMap)[y]?.[x],JSON.stringify(link)+' loops');assert(!isPnjBlockingTile(p.nextMap,x,y));return p;}
test('Route 8 and Ocreville preserve all six original author files and every TMX layer',()=>{
 for(const [file,hash]of Object.entries(fingerprints))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'..',file))).digest('hex'),hash,file);
 for(const name of ['gen_route8','gen_ville5']){const m=require('../data/maps/'+name+'.json'),xml=fs.readFileSync(path.join(__dirname,'../data/maps',name+'.tmx'),'utf8');for(const l of m.layers){const csv=xml.match(new RegExp('<layer[^>]*name="'+l.name+'"[^>]*>[\\s\\S]*?<data[^>]*>([\\s\\S]*?)</data>'));assert(csv,l.name);assert.deepEqual(csv[1].trim().split(/[,\s]+/).map(Number),l.data);}}
});
test('north/south route connections lead both ways to safe non-portal tiles',()=>{
 for(const [map,x,y,target]of [['route4',18,19,'gen_route8'],['gen_route8',18,0,'route4'],['gen_route8',23,19,'gen_ville5'],['gen_ville5',23,0,'gen_route8'],['gen_ville5',23,19,'gen_route7'],['gen_route7',23,0,'gen_ville5']]){assert(maps.changeMapData(map)[y][x]);assert.equal(safe({map,tile:[x,y]}).nextMap,target);}
 for(const name of ['gen_route8','gen_ville5']){const seen=reachable(name,name==='gen_route8'?[18,1]:[23,1]);const portals=maps.changeMapData(name);portals.forEach((row,y)=>row.forEach((v,x)=>{if(v)safe({map:name,tile:[x,y]});}));for(const link of world.find(m=>m.mapName===name).mapchange){assert([...seen].some(k=>{const [x,y]=k.split(':').map(Number);return portals[y]?.[x]&&maps.getNextMap(name,x,y)?.nextMap===link.goto;}),name+' -> '+link.goto+' unreachable');}}
});
test('six Ocreville doors have reachable interiors and a return to the same doorstep',()=>{
 const city=world.find(m=>m.mapName==='gen_ville5');for(const l of city.mapchange.filter(l=>l.valX!==null)){
  const entry=safe({map:city.mapName,tile:[l.valX,l.valY]}),inside=reachable(l.goto,[Math.floor(entry.nextX/32),Math.floor(entry.nextY/32)]),portals=maps.changeMapData(l.goto),cells=[];
  portals.forEach((row,y)=>row.forEach((v,x)=>{if(v&&inside.has(`${x}:${y}`))cells.push([x,y]);}));assert(cells.length,l.goto+' cannot exit');
  if(l.goto==='centre'){const center=require('../server/game/world/pokemonCenterTravel'),origin={map:city.mapName,x:l.valX*32+16,y:(l.valY+1)*32+16},point=center.getPokemonCenterEntryReturn(city.mapName,l.valX,l.valY,origin);assert.deepEqual(center.getPokemonCenterExit(point),origin);}
  else{const exit=safe({map:l.goto,tile:cells[0]});assert.equal(exit.nextMap,city.mapName);assert.deepEqual([Math.floor(exit.nextX/32),Math.floor(exit.nextY/32)],[l.valX,l.valY+1]);}
 }
});
test('residents and Raphael remain accessible, and blocked old spawns never fall onto a portal',()=>{
 const {sanitizeSpawnPosition}=require('../server/realtime/playerState');for(const name of ['gen_route8','gen_ville5']){
  const c=maps.loadCollisionData(name),seen=reachable(name,name==='gen_route8'?[18,1]:[23,1]);for(const p of getPnjsForMap(name)){assert.equal(c[p.y][p.x],0,p.name);assert.equal(c[p.y-1][p.x],0,p.name);assert([[1,0],[-1,0],[0,1]].some(([dx,dy])=>seen.has(`${p.x+dx}:${p.y+dy}`)),p.name+' unreachable');}
  const fixed=sanitizeSpawnPosition(16,16,c,name);assert.equal(c[Math.floor(fixed.y/32)][Math.floor(fixed.x/32)],0);assert(!maps.changeMapData(name)[Math.floor(fixed.y/32)][Math.floor(fixed.x/32)]);
 }
 assert.equal(getPnjsForMap('gen_arene5').filter(p=>p.name==='raphael').length,1);assert(!getPnjsForMap('gen_arene4').some(p=>p.name==='raphael'));assert(reachable('gen_arene5',[13,16]).has('13:6'));
});
test('Hoze opens Raphael then Ana at Clairfontaine, with old records preserved',()=>{
 const {getSentenceForName}=require('../server/game/world/interactionRepository'),{deriveStoryQuest}=require('../server/game/world/storyProgression'),catalog=require('../data/game/progression.json');
 const state={flags:{hoze_defeated:'true'}};assert.equal(deriveStoryQuest(state).progress,4);assert.equal(deriveStoryQuest(state).target,7);assert.equal(deriveStoryQuest(state).map,'gen_arene5');assert.equal(getSentenceForName('champion_raphael',state)[1],'champion_raphael');
 assert.equal(getSentenceForName('champion_raphael',{flags:{}})[1],'champion_raphael_locked');assert.equal(catalog.npcBattles.champion_raphael.battleKey,'story_champion_raphael');
 state.flags.raphael_defeated='true';state.completedNpcBattles=[{battleKey:'story_champion_raphael'}];assert.equal(getSentenceForName('champion_raphael',state)[1],'champion_raphael_after');assert.equal(deriveStoryQuest(state).status,'active');assert.equal(deriveStoryQuest(state).map,'ville3_arene');assert.equal(getSentenceForName('champion_ana',state)[1],'champion_ana');assert.equal(state.flags.moonpunch_defeated,undefined);
});
