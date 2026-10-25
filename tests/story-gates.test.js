const test=require('node:test'),assert=require('node:assert/strict');
const gates=require('../server/game/world/storyGates');
const maps=require('../server/game/world/mapRepository'),pnjs=require('../server/game/world/pnjStore');
const catalog=require('../data/game/progression.json');
const directions=[[1,0,'right'],[-1,0,'left'],[0,1,'down'],[0,-1,'up']];
function reachable(map,start,progress){
 const c=maps.loadCollisionData(map),changes=maps.changeMapData(map),q=[start],seen=new Set();
 while(q.length){const[x,y]=q.shift(),key=x+':'+y;if(seen.has(key))continue;seen.add(key);
  if(changes[y]?.[x])continue;
  for(const[dx,dy,d]of directions){const nx=x+dx,ny=y+dy;if(c[ny]?.[nx]!==0||pnjs.isPnjBlockingTile(map,nx,ny))continue;
   const link=changes[ny]?.[nx]?maps.getNextMap(map,nx,ny):null;
   if(progress===null||!gates.candidatesForStep(map,d,nx,ny,link?.nextMap).some(g=>gates.isLocked(g,progress)))q.push([nx,ny]);
  }
 }return seen;
}
test('configured story barriers seal every authored exit without blocking their trainer or the return journey',()=>{
 assert.equal(new Set(gates.gates.map(g=>g.id)).size,gates.gates.length);
 for(const g of gates.gates){
  assert(catalog.npcBattles[g.npcBattle]);assert.equal(catalog.npcBattles[g.npcBattle].reward.flags[g.requiredFlag],'true');
  const fixtures={wayne_route1:{start:[19,7],talk:'18:3'},aspha_lake:{start:[25,18],talk:'25:6'},gwenn_ocreville:{start:[18,1],talk:'22:17'},mathilde_route5:{start:[1,8],talk:'25:8'},gwenn_rochebrume_tunnel:{start:[22,17],talk:'13:5'}};
  const {start,talk}=fixtures[g.id];
  const locked=reachable(g.map,start,{}),open=reachable(g.map,start,{flags:{[g.requiredFlag]:'true'}});
  assert(locked.has(talk),g.name+' remains reachable');
  const exits=[];maps.changeMapData(g.map).forEach((row,y)=>row.forEach((v,x)=>{if(v&&maps.getNextMap(g.map,x,y)?.nextMap===g.nextMap)exits.push([x,y]);}));
  assert(exits.length);const baseline=reachable(g.map,start,null);assert.deepEqual(open,baseline,'victory restores the original walkable area');assert(exits.some(([x,y])=>open.has(x+':'+y)));
  for(const[x,y]of exits){assert(!locked.has(x+':'+y),g.id+' no bypass '+x+','+y);assert(gates.candidatesForStep(g.map,'left',x,y,g.nextMap).includes(g),'old save beyond barrier still checked');}
  const t=g.tiles,back={up:'down',down:'up',right:'left',left:'right'}[g.direction];if(!g.actor)assert.deepEqual(gates.candidatesForStep(g.map,back,t.x,t.y),[],'backtracking allowed');else assert(gates.candidatesForStep(g.map,back,t.x,t.y).includes(g),'physical actor blocks all approaches');
 }
});
test('story barriers unlock only from authoritative victories, support old advanced saves and stay player-specific',()=>{
 for(const g of gates.gates){
  for(const flags of [{},{[g.requiredFlag]:'false'},{unrelated:'true'}])assert(gates.isLocked(g,{flags}));
  assert(!gates.isLocked(g,{flags:{[g.requiredFlag]:'true'}}));
  assert(!gates.isLocked(g,{completedNpcBattles:[{battleKey:catalog.npcBattles[g.npcBattle].battleKey}]}));
  assert.equal(gates.isLocked(g,{flags:{moonpunch_defeated:'true'}}),['gwenn_ocreville','mathilde_route5','gwenn_rochebrume_tunnel'].includes(g.id));
  assert.equal(gates.isLocked(g,{flags:{hoze_defeated:'true'}}),['gwenn_ocreville','mathilde_route5','gwenn_rochebrume_tunnel'].includes(g.id));
 }
 const a=gates.snapshot({flags:{route_guard_defeated:'true'}}),b=gates.snapshot({});assert.equal(a[0].locked,false);assert.equal(a[1].locked,true);assert(b.every(g=>g.locked));
});
test('barrier opening waits for world rendering, survives duplicate snapshots and respects reduced motion',async()=>{
 const {StoryGateRenderer}=await import('../vue-explorakit/src/services/storyGateRenderer.js');
 const renderer=new StoryGateRenderer(),closed=gates.snapshot({}),open=gates.snapshot({flags:{route_guard_defeated:'true'}});
 renderer.sync(closed);renderer.sync(open);renderer.sync(open);
 const g=renderer.gates.get('wayne_route1');assert(g.opening);assert.equal(g.openedAt,null);
 const ctx=new Proxy({},{get:()=>()=>{},set:()=>true});
 renderer.draw(ctx,'route2',100);assert.equal(g.openedAt,null);
 renderer.draw(ctx,'start',5000);assert.equal(g.openedAt,5000);assert(g.opening);
 renderer.draw(ctx,'start',6200);assert(!g.opening);
 renderer.sync(open);assert(!renderer.gates.get(g.id).opening,'no repeated opening');
 renderer.sync(closed);renderer.pulse(g.id);assert(renderer.gates.get(g.id).pulsePending);
 renderer.sync(open);renderer.draw(ctx,'start',8000,false);assert(!renderer.gates.get(g.id).opening);
 renderer.destroy();assert.equal(renderer.gates.size,0);
});
