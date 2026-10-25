const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const maps=require('../server/game/world/mapRepository'),pnjs=require('../server/game/world/pnjStore');
const {maps:world}=require('../data/game/nextMap.json');
const shops=[...require('../server/game/world/shopCatalog').SHOP_MAPS].filter(name=>!name.startsWith('tour_'));
function reachable(name){const c=maps.loadCollisionData(name),seen=new Set(['13,15']),queue=[[13,15]];for(let i=0;i<queue.length;i++){const[x,y]=queue[i];for(const[dx,dy]of [[0,1],[0,-1],[1,0],[-1,0]]){const nx=x+dx,ny=y+dy,k=`${nx},${ny}`;if(seen.has(k)||c[ny]?.[nx]!==0||pnjs.isPnjBlockingTile(name,nx,ny))continue;seen.add(k);queue.push([nx,ny]);}}return seen;}
test('every market has a connected entrance, reachable clerk and correct city exit',()=>{
 assert.equal(shops.length,9);
 const entries=world.flatMap(m=>m.mapchange.filter(t=>shops.includes(t.goto)).map(t=>({m,t})));assert.equal(entries.length,8);
 for(const name of shops){const c=maps.loadCollisionData(name),t=maps.changeMapData(name),seen=reachable(name);
  assert(seen.has('13,9'),name+' approach');assert(seen.has('13,16'),name+' exit');assert(seen.has('14,16'));
  assert.equal(t[15][13],0,'arrival must not trigger departure');assert(t[16][13]);
  for(const p of pnjs.getPnjsForMap(name)){assert.equal(c[p.y][p.x],0);assert.equal(c[p.y-1][p.x],0);assert.equal(p.roamRadius,0);assert(seen.has(`${p.x},${p.y+1}`));assert.equal(require('../server/game/world/interactionRepository').getEndSentenceInformation(p.interactionName),'shop');}
  for(const[x,y]of [[6,10],[21,10],[13,4],[13,17],[7,6],[20,6],[7,11],[20,11],[10,8],[17,8],[7,14],[20,14]])assert(c[y][x],name+' wall/furniture '+x+','+y);
  for(const[x,y]of [[16,16],[880,624],[432,560],[432,176]]){const safe=require('../server/realtime/playerState').sanitizeSpawnPosition(x,y,c,name);assert(seen.has(`${Math.floor(safe.x/32)},${Math.floor(safe.y/32)}`),name+' old save recovery');}
 }
 for(const {m,t}of entries){const next=maps.getNextMap(m.mapName,t.valX,t.valY);assert.deepEqual([next.nextX,next.nextY],[432,496]);const back=maps.getNextMap(t.goto,13,16);assert.equal(back.nextMap,m.mapName);const x=Math.floor(back.nextX/32),y=Math.floor(back.nextY/32);assert.equal(maps.loadCollisionData(m.mapName)[y][x],0);assert.equal(maps.changeMapData(m.mapName)[y][x],0);}
});
test('market Tiled JSON/TMX match and refer to the shipped image instead of obsolete scenery',()=>{
 for(const name of ['gen_shop1','gen_shop_ville2_1','gen_shop_ville5_1']){const m=maps.readMap(name),xml=fs.readFileSync(path.join(__dirname,'../data/maps',name+'.tmx'),'utf8');assert.equal(m.layers.filter(l=>l.type==='imagelayer').length,1);assert(xml.includes('name="Décor Boutique"'));for(const l of m.layers.filter(l=>l.type==='tilelayer')){const match=xml.match(new RegExp('<layer[^>]*name="'+l.name+'"[^>]*>[\\s\\S]*?<data[^>]*>([\\s\\S]*?)</data>'));assert(match,l.name);assert.deepEqual(match[1].trim().split(/[,\s]+/).map(Number),l.data);}
  const png=fs.readFileSync(path.join(__dirname,'../vue-explorakit/src/assets',name+'.png'));assert.deepEqual([png.readUInt32BE(16),png.readUInt32BE(20)],[448,320]);
  assert.equal(maps.battleMapData(name).flat().filter(Boolean).length,0);assert.equal(maps.InteractMapData(name).flat().filter(Boolean).length,0);
 }
});
