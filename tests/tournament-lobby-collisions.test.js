const test=require('node:test'),assert=require('node:assert/strict');
const maps=require('../server/game/world/mapRepository'),lobby='super_tournament_lobby';
const tournament=require('../server/realtime/handlers/superTournamentHandlers'),dark=require('../server/game/world/darkContinent'),safari=require('../server/game/world/safari');
const store=safari.scopedStore(dark.scopedStore(tournament.scopedStore(require('../server/game/world/pnjStore'),()=>null),()=>({eligible:true,owned:false})));
function reachable(){
 const grid=maps.loadCollisionData(lobby),queue=[[14,15]],seen=new Set(['14,15']);
 for(const[x,y]of queue)for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){
  const a=x+dx,b=y+dy,key=a+','+b;
  if(grid[b]?.[a]===0&&!store.isPnjBlockingTile(lobby,a,b)&&!seen.has(key)){seen.add(key);queue.push([a,b]);}
 }return seen;
}
test('lobby wall cap and lower flower pots are solid, with only the central doorway open',()=>{
 const grid=maps.loadCollisionData(lobby);
 for(let y=16;y<=18;y++)for(let x=0;x<28;x++)assert.equal(grid[y][x],x>=12&&x<=15?0:1,`${x},${y}`);
 for(const y of[14,15])for(const x of[2,25])assert.equal(grid[y][x],1);
 for(const x of[3,4,5,10,11,16,17,22,23,24])assert.equal(grid[15][x],0,'Floor before wall '+x);
});
test('door, reception, board and both travel NPCs stay reachable with their real blocking footprints',()=>{
 const free=reachable();
 for(const[x,y]of[[14,15],[23,15],[11,15],[13,8],[22,8],[3,15],[24,13]])assert(free.has(x+','+y),`${x},${y}`);
 for(let x=12;x<=15;x++)for(let y=16;y<=18;y++)assert(free.has(x+','+y));
 assert.equal(tournament.interactionTarget({currentmap:lobby,x:432,y:272}), 'entry');
 assert.equal(tournament.interactionTarget({currentmap:lobby,x:720,y:272}), 'ranking');
 assert.equal(safari.near({currentmap:lobby,x:752,y:496})?.name,'safari_captain');
 assert.equal(dark.interactionActor({currentmap:lobby,x:368,y:496},{eligible:true,owned:false})?.name,'dark_scout');
});
test('saved players on the former wall row recover onto the adjacent floor, without changing the room',()=>{
 const grid=maps.loadCollisionData(lobby),{sanitizeSpawnPosition}=require('../server/realtime/playerState');
 for(const x of[5,10,17,22])assert.deepEqual(sanitizeSpawnPosition(x*32+16,528,grid,lobby,{blocked:store.isPnjBlockingTile}),{x:x*32+16,y:496});
});
