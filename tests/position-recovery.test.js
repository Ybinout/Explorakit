const test=require('node:test'),assert=require('node:assert/strict');
const {nearestSafePosition,recoveryTerrain}=require('../server/game/world/safePosition');
const maps=require('../server/game/world/mapRepository');
const {registerPositionRecoveryHandlers}=require('../server/realtime/handlers/positionRecoveryHandlers');
const routes=require('../data/game/nextMap.json').maps;
test('recovery chooses nearby connected terrain rather than the first decorative pocket',()=>{
 const c=[[0,1,1,1,1],[1,1,1,1,1],[1,0,0,0,1],[1,0,0,0,1]];
 assert.deepEqual(nearestSafePosition(112,48,c,'synthetic'),{x:112,y:80});
 assert.deepEqual(nearestSafePosition(16,16,c,'synthetic'),{x:48,y:80});
 assert.deepEqual(nearestSafePosition(80,80,c,'synthetic'),{x:80,y:80});
});
test('manual recovery stays on the same connected area and never changes the map',()=>{
 assert.deepEqual(nearestSafePosition(432,496,maps.loadCollisionData('centre'),'centre'),{x:432,y:496},'a valid saved doorway must stay put on reconnect');
 const c=maps.loadCollisionData('start'),point=nearestSafePosition(624,176,c,'start'),t=recoveryTerrain(c,'start');
 const recovered=nearestSafePosition(point.x,point.y,c,'start',{manual:true});
 assert.equal(t.ids.get(`${Math.floor(point.x/32)},${Math.floor(point.y/32)}`),t.ids.get(`${Math.floor(recovered.x/32)},${Math.floor(recovered.y/32)}`));
 assert(Math.hypot(point.x-recovered.x,point.y-recovered.y)<=96);
});
test('all playable maps recover invalid coordinates onto real accessible terrain, excluding doors and NPCs',()=>{
 for(const entry of routes){
  let c;try{c=maps.loadCollisionData(entry.mapName);}catch{continue;}
  const t=recoveryTerrain(c,entry.mapName),changes=maps.changeMapData(entry.mapName);
  for(const [x,y]of [[-500,-200],[9999,9999],[NaN,Infinity],[0,0]]){
   const p=nearestSafePosition(x,y,c,entry.mapName),tx=Math.floor(p.x/32),ty=Math.floor(p.y/32);
   assert.equal(c[ty]?.[tx],0,entry.mapName);assert(!changes[ty]?.[tx],entry.mapName);
   assert(t.allowed.has(t.ids.get(`${tx},${ty}`)),entry.mapName);
   assert.deepEqual(nearestSafePosition(p.x,p.y,c,entry.mapName),p,entry.mapName+' reconnect stable');
  }
 }
});
test('recovery rejects an empty map instead of returning a made-up off-map position',()=>{
 assert.throws(()=>nearestSafePosition(200,200,[[1]],'synthetic'),/Aucune case/);
});
test('a moving NPC on the saved tile causes only a nearby relocation',()=>{
 const c=Array.from({length:5},()=>Array(5).fill(0));const p=nearestSafePosition(80,80,c,'synthetic',{blocked:(_,x,y)=>x===2&&y===2});
 assert.equal(Math.abs(p.x-80)+Math.abs(p.y-80),32);
});
test('debug is server-authoritative, serial, rate limited and blocked in battle',async()=>{
 let handler,clock=1000,calls=0,release;const p={x:80,y:80,currentmap:'start'};
 registerPositionRecoveryHandlers({socket:{on:(_,h)=>handler=h},getPlayer:()=>p,canUse:()=>true,now:()=>clock,recover:async player=>{calls++;await new Promise(r=>release=r);player.x=112;}});
 let first;const pending=handler({map:'ville5',x:9000,y:9000},r=>first=r);
 let second;await handler({},r=>second=r);assert.equal(second.success,false);release();await pending;assert(first.success);assert.equal(p.currentmap,'start');assert.equal(p.x,112);assert.equal(calls,1);
 await handler({},r=>second=r);assert.equal(second.success,false);clock+=10001;p.inbattle=true;await handler({},r=>second=r);assert.equal(second.success,false);assert.equal(calls,1);
});
for(const mode of ['rift','colosseum'])test(`${mode}: recovery keeps team, bag, money, timer and map; checkpoint resume remains valid`,async()=>{
 const {createLobbyStore}=require('../server/game/drift/lobbyStore'),{createRunManager}=require('../server/game/drift/runManager');
 let now=1000;const store=createLobbyStore({now:()=>now}),events=[],runtime=createRunManager({starterChoiceMs:0,store,namespace:{to:id=>({emit:(event,payload)=>events.push({id,event,payload})})},now:()=>now,random:()=>.99});
 const host={id:1,username:'recovery'},guest={id:2,username:'peer'};store.connect(host,'host');
 if(mode==='rift'){store.connect(guest,'guest');const {code}=store.create(host,{capacity:2,durationMinutes:30});store.join(guest,code);store.ready(host,true);store.ready(guest,true);await runtime.start(host);}else await runtime.startColosseum(host,{durationMinutes:30});
 runtime.enter(host,{id:'host'});const p=runtime.playerFor(host);Object.assign(p,{currentmap:'route6',x:9999,y:-500});
 const before=JSON.stringify({team:p.equipe,items:p.items,money:p.money,endsAt:p.run.endsAt});
 runtime.recoverPosition(p);assert.equal(p.currentmap,'route6');assert.equal(JSON.stringify({team:p.equipe,items:p.items,money:p.money,endsAt:p.run.endsAt}),before);
 assert(events.some(e=>e.event==='newmap'&&e.payload.mapname==='route6'));const point={x:p.x,y:p.y};runtime.enter(host,{id:'reconnected'});assert.deepEqual({x:p.x,y:p.y},point);
 assert.throws(()=>runtime.recoverPosition(p),/Patiente/);now+=11000;p.inbattle=true;assert.throws(()=>runtime.recoverPosition(p),/indisponible/);
});
