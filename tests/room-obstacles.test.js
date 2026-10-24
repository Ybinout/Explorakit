const test=require('node:test'),assert=require('node:assert/strict');
const room=require('../server/game/world/roomObstacles'),gates=require('../server/game/world/storyGates');
const {loadCollisionData}=require('../server/game/world/mapRepository');
function reachable(flags){const c=loadCollisionData('route2_maison'),q=[[13,16]],seen=new Set();while(q.length){const[x,y]=q.shift(),key=x+':'+y;if(seen.has(key))continue;seen.add(key);for(const[dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,ny=y+dy;if(c[ny]?.[nx]!==0||gates.candidatesForStep('route2_maison','up',nx,ny).some(g=>gates.isLocked(g,{flags})))continue;q.push([nx,ny]);}}return seen;}
test('each barricade seals the full passage until individually cleared; return door stays reachable',()=>{
 const flags={};for(const o of room.obstacles){const seen=reachable(flags);assert(seen.has('13:16'));assert(seen.has('13:'+(o.y+1)));assert(!seen.has('13:'+o.y));assert(!seen.has('13:6'));assert(o.cells.every(c=>loadCollisionData(o.map)[c.y][c.x]===0));flags[o.requiredFlag]='true';}assert(reachable(flags).has('13:6'));
});
test('clearing remains personal, legacy victory opens the room and both sides can remove boards',()=>{
 for(const o of room.obstacles){assert(room.isLocked(o,{}));assert(!room.isLocked(o,{flags:{lucie_freed:'true'}}));assert(!room.isLocked(o,{completedNpcBattles:[{battleKey:require('../data/game/progression.json').npcBattles.lucie_route2.battleKey}]}));for(const y of [o.y-1,o.y,o.y+1])assert.equal(room.nearby({currentmap:o.map,x:432,y:y*32+16},{}).id,o.id);assert.equal(room.nearby({currentmap:'start',x:432,y:o.y*32+16},{}),undefined);}
 assert.equal(room.nearby({currentmap:'route2_maison',x:432,y:16*32+16},{flags:{}}).id,'lucie_barricade_1');
});
test('wood renderer supports opening, duplicate snapshots and motion preference',async()=>{
 const {StoryGateRenderer}=await import('../vue-explorakit/src/services/storyGateRenderer.js');const r=new StoryGateRenderer();r.sync(room.snapshot({}));r.work({active:true,id:'lucie_barricade_1'});assert(r.gates.get('lucie_barricade_1').workingAt!==null);
 const open=room.snapshot({flags:{lucie_barricade_1_cleared:'true'}});r.sync(open);r.sync(open);const ctx=new Proxy({},{get:()=>()=>{},set:()=>true});r.draw(ctx,'route2_maison',1000);r.draw(ctx,'route2_maison',2200);assert(!r.gates.get('lucie_barricade_1').opening);r.sync(room.snapshot({}));r.sync(open);r.draw(ctx,'route2_maison',3000,false);assert(!r.gates.get('lucie_barricade_1').opening);r.work(null);assert([...r.gates.values()].every(g=>g.workingAt===null));
});
