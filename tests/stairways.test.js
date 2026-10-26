const test=require('node:test'),assert=require('node:assert/strict');
const stairs=require('../server/game/world/stairways'),maps=require('../server/game/world/mapRepository');
const actor=(map,x,y)=>({currentmap:map,x:x*32+16,y:y*32+16});
function move(p,x,y){const previous={x:p.x,y:p.y};p.x=x*32+16;p.y=y*32+16;stairs.moved(p,previous);}
test('only the final upward push on an existing stair marker starts a transition',()=>{
 const p=actor('tour_rdc',24,5);assert.equal(stairs.departure(p,'up'),null);
 move(p,24,4);assert.equal(stairs.departure(p,'down'),null);assert.equal(stairs.departure(p,'left'),null);
 const link=stairs.departure(p,'up');assert.equal(link.nextMap,'tour_etage1');assert.equal(link.staircase,true);
 assert.equal(stairs.departure(actor('tour_rdc',13,17),'up'),null,'ordinary exit keeps its existing entry rule');
});
test('continued Up cannot reverse an arrival, but a real step away re-arms the return',()=>{
 for(const[map,from,x]of [['tour_etage1','tour_rdc',3],['tour_etage2','tour_etage3',24]]){
  const p=actor(map,x,5);stairs.arrived(p,from);move(p,x,4);
  for(let i=0;i<20;i++)assert.equal(stairs.departure(p,'up'),null);
  move(p,x,5);move(p,x,4);assert.equal(stairs.departure(p,'up').nextMap,from);
 }
});
test('arrival guards are personal, do not enter checkpoints and clear on relocation',()=>{
 const p=actor('tour_etage1',3,5),before=JSON.stringify(p);stairs.arrived(p,'tour_rdc');assert.equal(JSON.stringify(p),before);
 move(p,3,4);const other=actor('tour_etage1',3,4);assert.equal(stairs.departure(p,'up'),null);assert.equal(stairs.departure(other,'up').nextMap,'tour_rdc');
 stairs.clear(p);assert.equal(stairs.departure(p,'up').nextMap,'tour_rdc');
});
test('all six tower stair links retain valid authored markers and adjacent reciprocal landings',()=>{
 const config=require('../data/game/nextMap.json').maps;let count=0;
 for(const m of config)for(const link of m.mapchange||[])if(link.staircase){
  count++;assert.equal(link.triggerOnExit,'up');assert(maps.changeMapData(m.mapName)[link.valY][link.valX]);
  const destination=maps.getNextMap(m.mapName,link.valX,link.valY),p={currentmap:destination.nextMap,x:destination.nextX,y:destination.nextY};
  assert.equal(maps.loadCollisionData(p.currentmap)[Math.floor(p.y/32)][Math.floor(p.x/32)],0);
  stairs.arrived(p,m.mapName);move(p,Math.floor(p.x/32),Math.floor(p.y/32)-1);assert.equal(stairs.departure(p,'up'),null);
 }
 assert.equal(count,6);
});
