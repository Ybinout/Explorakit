const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const maps=require('../server/game/world/mapRepository'),pnjs=require('../server/game/world/pnjStore');
const world=require('../data/game/nextMap.json').maps;
function reachable(map,start){const c=maps.loadCollisionData(map),t=maps.changeMapData(map),seen=new Set(),q=[start];while(q.length){const [x,y]=q.shift(),key=`${x}:${y}`;if(seen.has(key)||c[y]?.[x]!==0||pnjs.isPnjBlockingTile(map,x,y))continue;seen.add(key);if(t[y]?.[x])continue;for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]])q.push([x+dx,y+dy]);}return seen;}
test('Routes 9/10 preserve six author files and mirror every layer in TMX',()=>{
 for(const [file,hash]of Object.entries(require('../docs/routes9-10-author-assets.json')))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'..',file))).digest('hex'),hash,file);
 for(const name of ['gen_route7','gen_route6']){const m=require('../data/maps/'+name+'.json'),xml=fs.readFileSync(path.join(__dirname,'../data/maps',name+'.tmx'),'utf8');assert.equal(m.layers.length,14);for(const l of m.layers){const csv=xml.match(new RegExp('<layer[^>]*name="'+l.name+'"[^>]*>[\\s\\S]*?<data[^>]*>([\\s\\S]*?)</data>'));assert(csv,l.name);assert.deepEqual(csv[1].trim().split(/[,\s]+/).map(Number),l.data);}}
});
test('the two roads, grass and all exits are reachable without crossing walls or portals',()=>{
 for(const [name,start]of [['gen_route7',[23,1]],['gen_route6',[6,1]]]){const seen=reachable(name,start),portals=maps.changeMapData(name),battle=maps.battleMapData(name);portals.forEach((row,y)=>row.forEach((v,x)=>{if(v)assert(seen.has(`${x}:${y}`),`${name} unreachable exit ${x}:${y}`);}));assert(battle.some((row,y)=>row.some((v,x)=>v&&seen.has(`${x}:${y}`))));for(const p of pnjs.getPnjsForMap(name)){assert.equal(maps.loadCollisionData(name)[p.y][p.x],0);assert.equal(maps.loadCollisionData(name)[p.y-1][p.x],0);assert([[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>seen.has(`${p.x+dx}:${p.y+dy}`)));}}
 for(const [name,x,y,target,arrival]of [['gen_ville5',23,19,'gen_route7',[23,1]],['gen_route7',23,0,'gen_ville5',[23,18]],['gen_route7',6,19,'gen_route6',[6,1]],['gen_route6',6,0,'gen_route7',[6,18]],['gen_route6',20,7,'gen_shop_route10',[13,16]],['gen_shop_route10',13,17,'gen_route6',[20,8]]]){const next=maps.getNextMap(name,x,y);assert.equal(next.nextMap,target);assert.deepEqual([Math.floor(next.nextX/32),Math.floor(next.nextY/32)],arrival);assert.equal(maps.loadCollisionData(target)[arrival[1]][arrival[0]],0);assert.equal(maps.changeMapData(target)[arrival[1]][arrival[0]],0);}
});
test('Route 10 now opens Clairfontaine, old region stays compatible and the shop works in all modes',async()=>{
 const next=maps.getNextMap('gen_route6',14,19);assert.equal(next.blockedMessage,undefined);assert.equal(next.nextMap,'ville3');
 assert(world.filter(m=>m.mapName==='gen_ville4'||m.mapName==='gen_route5').every(m=>m.legacyOnly));
 for(const m of world)for(const l of m.mapchange.filter(l=>['gen_route6','gen_route7'].includes(l.goto))){const n=maps.getNextMap(m.mapName,l.valX??14,l.valY??10);assert.equal(maps.loadCollisionData(l.goto)[Math.floor(n.nextY/32)]?.[Math.floor(n.nextX/32)],0,m.mapName);}
 assert(require('../server/game/world/shopCatalog').isShopMap('gen_shop_route10'));
 assert.equal(maps.resolveMapSourceName('gen_shop_route10'),'gen_shop1');
 assert(pnjs.getPnjsForMap('gen_shop_route10').some(p=>require('../server/game/world/interactionRepository').getEndSentenceInformation(p.interactionName)==='shop'));
 const {getMapLocationLabel}=await import('../vue-explorakit/src/services/mapLocations.js');for(const lang of ['fr','en']){assert.equal(getMapLocationLabel('gen_route7',lang),'Route 9');assert.equal(getMapLocationLabel('gen_route6',lang),'Route 10');}
});
