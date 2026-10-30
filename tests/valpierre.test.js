const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const world=require('../data/game/nextMap.json').maps,catalog=require('../data/game/progression.json');
const maps=require('../server/game/world/mapRepository'),{isPnjBlockingTile}=require('../server/game/world/pnjStore');
function reachable(map,start){const coll=maps.loadCollisionData(map),changes=maps.changeMapData(map),seen=new Set(),q=[start];while(q.length){const [x,y]=q.shift(),key=`${x}:${y}`;if(seen.has(key)||coll[y]?.[x]!==0||isPnjBlockingTile(map,x,y))continue;seen.add(key);if(changes[y]?.[x])continue;for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]])q.push([x+dx,y+dy]);}return seen;}
test('Valpierre uses the exact revised author export and mirrors every layer in TMX',()=>{
 const path=require('node:path'),crypto=require('node:crypto'),manifest=require('../docs/valpierre-routes-author-assets.json');
 for(const file of ['data/maps/ville_safe1.json','vue-explorakit/src/assets/ville_safe1.png','vue-explorakit/src/assets/ville_safe1_f.png'])assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'..',file))).digest('hex'),manifest[file]);
 const map=require('../data/maps/ville_safe1.json'),tmx=fs.readFileSync(path.join(__dirname,'../data/maps/ville_safe1.tmx'),'utf8');
 for(const layer of map.layers.filter(l=>l.type==='tilelayer')){const csv=tmx.match(new RegExp('<layer[^>]*name="'+layer.name+'"[^>]*>[\\s\\S]*?<data[^>]*>([\\s\\S]*?)</data>'));assert(csv,layer.name);assert.deepEqual(csv[1].trim().split(/[,\s]+/).map(Number),layer.data,layer.name);}
 assert.equal(map.layers.find(l=>l.name==='coll').data.filter(Boolean).length,152);
 assert(maps.changeMapData('ville_safe1')[6][0]);assert.equal(maps.loadCollisionData('ville_safe1')[6][0],0);
 assert.notEqual(maps.loadCollisionData('ville_safe1')[11][4],0,'the lake remains blocked');
 for(const[x,y]of[[14,15],[22,15],[4,5],[23,5]])assert(maps.changeMapData('ville_safe1')[y][x],'painted doorway');

});
test('east route 4 and Valpierre west connect both ways, with safe non-transition arrivals',()=>{
 for(const [map,x,y,target]of [['route4',27,3,'ville_safe1'],['route4',27,6,'ville_safe1'],['ville_safe1',0,7,'route4']]){
  assert(maps.changeMapData(map)[y][x]);const exit=maps.getNextMap(map,x,y);assert.equal(exit.nextMap,target);const tx=Math.floor(exit.nextX/32),ty=Math.floor(exit.nextY/32);assert.equal(maps.loadCollisionData(target)[ty][tx],0);assert.equal(maps.changeMapData(target)[ty][tx],0);
 }
 // The pre-existing southern route and cave return remain connected.
 assert.equal(maps.getNextMap('route4',18,19).nextMap,'gen_route8');assert.equal(maps.getNextMap('route4',0,14).nextMap,'cave2');
});
test('every Valpierre door, resident and return is reachable without crossing walls or another portal',()=>{
 const city=world.find(m=>m.mapName==='ville_safe1'),seen=reachable('ville_safe1',[1,7]);
 for(const source of world.filter(m=>m.mapName.startsWith('ville_safe1'))){
  for(const link of source.mapchange){const grid=maps.changeMapData(source.mapName),cells=[];grid.forEach((row,y)=>row.forEach((v,x)=>{if(v&&maps.getNextMap(source.mapName,x,y)?.nextMap===link.goto)cells.push([x,y]);}));assert(cells.length,source.mapName+' -> '+link.goto);
   const exit=maps.getNextMap(source.mapName,...cells[0]),x=Math.floor(exit.nextX/32),y=Math.floor(exit.nextY/32);assert.equal(maps.loadCollisionData(exit.nextMap)[y][x],0,link.goto);assert(!maps.changeMapData(exit.nextMap)[y][x],link.goto+' loop');assert(!isPnjBlockingTile(exit.nextMap,x,y));
   if(source.mapName==='ville_safe1')assert(cells.some(([x,y])=>seen.has(`${x}:${y}`)),link.goto+' unreachable');
   else {const door=city.mapchange.find(c=>c.goto===source.mapName);if(!door)assert(source.legacyOnly,'only retired interiors may lack a facade');const arrival=door?maps.getNextMap('ville_safe1',door.valX,door.valY):{nextX:432,nextY:528};const access=reachable(source.mapName,[Math.floor(arrival.nextX/32),Math.floor(arrival.nextY/32)]);assert(cells.some(([x,y])=>access.has(`${x}:${y}`)),source.mapName+' cannot exit');}
  }
 }
 const residents=JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'../data/game/pnjs.jsonc'))).pnjs.filter(p=>p.name.startsWith('valpierre_'));
 for(const p of residents){const coll=maps.loadCollisionData(p.map);assert.equal(coll[p.y][p.x],0,p.name+' feet');assert.equal(coll[p.y-1][p.x],0,p.name+' head');const entry=city.mapchange.find(c=>c.goto===p.map);const start=entry?maps.getNextMap('ville_safe1',entry.valX,entry.valY):{nextX:48,nextY:240};const access=reachable(p.map,[Math.floor(start.nextX/32),Math.floor(start.nextY/32)]);assert([[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>access.has(`${p.x+dx}:${p.y+dy}`)),p.name+' cannot speak');}
});
test('Hoze is the once-only main gym in Valpierre and the old optional guardian stays archived',()=>{
 const {getSentenceForName}=require('../server/game/world/interactionRepository');
 assert.equal(getSentenceForName('champion_hoze',{flags:{}})[1],'champion_hoze_locked');
 assert.equal(getSentenceForName('champion_hoze',{flags:{moonpunch_defeated:'true'}})[1],'champion_hoze');
 assert.equal(getSentenceForName('valpierre_gardien',{flags:{moonpunch_defeated:'true'}})[1],'valpierre_gardien_locked');
 const residents=JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'../data/game/pnjs.jsonc'))).pnjs;
 assert.equal(residents.find(p=>p.name==='hoze').map,'ville_safe1_arene');
 assert.equal(residents.some(p=>p.name==='valpierre_gardien'),false);
 assert(catalog.storySteps.some(step=>step.flag==='hoze_defeated'&&step.map==='ville_safe1_arene'));assert(catalog.npcBattles.champion_hoze.once);assert.equal(catalog.npcBattles.valpierre_gardien.enabled,false);
 assert.equal(require('../server/game/world/shopCatalog').isShopMap('ville_safe1_shop'),true);
});
test('cave scenery covers Adventure and expedition caves, but Colosseum always keeps its arena',async()=>{
 const {battleEnvironment}=await import('../vue-explorakit/src/services/battleEnvironment.js');for(const name of ['cave1','cave2','cave_ice'])assert.equal(battleEnvironment(name),'cave');for(const name of ['route4','ville_safe1',null,'gen_arene1'])assert.equal(battleEnvironment(name),'grass');assert.equal(battleEnvironment('cave1',true),'colosseum');
});
