const test=require('node:test'),assert=require('node:assert/strict');
const{flightDestination,townForMap,flightState}=require('../server/game/world/flightTravel');
const terrain=require('../server/game/world/mapRepository');
const{nearestSafePosition}=require('../server/game/world/safePosition');
const{registerFlightHandlers}=require('../server/realtime/handlers/flightHandlers');
test('all eight towns land on stable walkable doorsteps, prioritizing centers, then arenas and home',()=>{
 const towns=require('../server/game/world/regionMap').getRegionMap().nodes.filter(n=>n.kind==='town');assert.equal(towns.length,8);
 for(const town of towns){const p=flightDestination(town.id),x=Math.floor(p.x/32),y=Math.floor(p.y/32);assert(p);assert.equal(terrain.loadCollisionData(p.map)[y][x],0);assert(!terrain.changeMapData(p.map)[y][x]);assert.deepEqual(nearestSafePosition(p.x,p.y,terrain.loadCollisionData(p.map),p.map),{x:p.x,y:p.y});
 assert.equal(p.landmark,p.map==='start'?'home':p.map==='ville_safe1'?'arena':'centre');
 assert([[0,-1],[0,1],[-1,0],[1,0]].some(([dx,dy])=>{const n=terrain.getNextMap(p.map,x+dx,y+dy)?.nextMap;return terrain.changeMapData(p.map)[y+dy]?.[x+dx]&&(p.landmark==='centre'?n==='centre':p.landmark==='arena'?n?.includes('arene'):n==='maison');}));}
 for(const value of ['route1','centre','ville5_arene','__proto__',null,{},'missing'])assert.equal(flightDestination(value),null);
 assert.equal(townForMap('ville4_arene'),'ville4');assert.equal(townForMap('centre',{map:'ville3',x:752,y:240}),'ville3');assert.equal(townForMap('route13'),null);
});
test('flight state contains only actual visit flags and requires the permanent module',()=>{
 assert.deepEqual(flightState({'visited_town:ville5':'true'}),{unlocked:false,visited:['ville5']});
 assert.deepEqual(flightState({fly_module_received:'true','visited_town:route1':'true','visited_town:ville1':'false'}),{unlocked:true,visited:[]});
});
test('server rejects locked/unvisited flights and client coordinates; guards busy actions and repeated requests',async()=>{
 let handler,clock=0,state={unlocked:false,visited:['ville1']},locked=false,hold,release;const calls=[];const p={currentmap:'start'};
 registerFlightHandlers({socket:{connected:true,on:(_,h)=>handler=h},userId:3,getPlayer:()=>p,canUse:()=>!locked,setBusy:v=>locked=v,now:()=>clock,loadState:async()=>state,travel:async target=>{calls.push(target);if(hold)await new Promise(r=>release=r);}});
 const command=async data=>{let result;await handler(data,r=>result=r);return result;};
 assert.equal((await command({map:'ville1'})).success,false);state.unlocked=true;
 assert.equal((await command({map:'ville5'})).success,false);assert.equal((await command({map:'route1'})).success,false);
 p.inbattle=true;assert.equal((await command({map:'ville1'})).success,false);p.inbattle=false;
 p.isInteracting=true;assert.equal((await command({map:'ville1'})).success,false);p.isInteracting=false;
 hold=true;const first=command({map:'ville1',x:9999,y:9999});while(!release)await new Promise(r=>setImmediate(r));
 assert.equal((await command({map:'ville1'})).success,false);release();assert.equal((await first).success,true);
 assert.equal(calls.length,1);assert.deepEqual(calls[0],flightDestination('ville1'));assert(!locked&&!p.inventoryBusy);
 assert.equal((await command({map:'ville1'})).success,false);clock=4000;hold=false;assert.equal((await command({map:'ville1'})).success,true);
});
test('failed flight releases locks; presentation disappears and reappears without moving world coordinates',async()=>{
 let handler,locked=false;const p={};registerFlightHandlers({socket:{connected:true,on:(_,h)=>handler=h},getPlayer:()=>p,canUse:()=>true,setBusy:v=>locked=v,loadState:async()=>({unlocked:true,visited:['ville1']}),travel:async()=>{throw Error('fixture failure');}});
 let result;await handler({map:'ville1'},r=>result=r);assert.equal(result.success,false);assert(!locked&&!p.inventoryBusy);
 const{flightPose}=await import('../vue-explorakit/src/services/flightAnimation.js');
 assert.equal(flightPose({phase:'departure',startedAt:0},0).alpha,1);assert.equal(flightPose({phase:'departure',startedAt:0},650).alpha,0);
 assert.equal(flightPose({phase:'loading'},900).alpha,0);assert.equal(flightPose({phase:'arrival',startedAt:0},650).alpha,1);
 assert.equal(flightPose({phase:'arrival',startedAt:0},100,true).lift,0);
});
