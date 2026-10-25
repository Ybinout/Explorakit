const test=require('node:test'),assert=require('node:assert/strict');
const rules=require('../server/game/world/raphTrial'),{createPnjStore}=require('../server/game/world/pnjStore');
const {loadCollisionData}=require('../server/game/world/mapRepository');
const player=point=>({currentmap:rules.config.map,x:point.x*32+16,y:(point.y+1)*32+16});
test('four different random stops, reachable footprints and original home preserved',()=>{
 const grid=loadCollisionData(rules.config.map),original=createPnjStore().getPnjsForMap(rules.config.map)[0];
 assert.deepEqual(rules.config.home,{x:original.x,y:original.y});
 for(const p of [...rules.config.stops,rules.config.home])for(const x of [p.x,p.x+1])for(const y of [p.y-1,p.y])assert.equal(grid[y][x],0);
 const visited=new Set();for(let seed=1;seed<=80;seed++){let n=seed;const s=rules.create({x:432,y:528},()=>{n=(n*1664525+1013904223)>>>0;return n/2**32;});assert.equal(new Set(s.stops).size,4);s.stops.forEach(i=>visited.add(i));for(let i=1;i<4;i++){const a=rules.config.stops[s.stops[i-1]],b=rules.config.stops[s.stops[i]];assert(Math.abs(a.x-b.x)+Math.abs(a.y-b.y)>=5);}}
 assert.equal(visited.size,rules.config.stops.length);
});
test('only adjacent authorized interactions advance, cooldown and four-step finish',()=>{
 let s=rules.create({x:432,y:528},()=>.5);
 assert(!rules.advance(s,{currentmap:'start',x:0,y:0},1000).changed);
 assert(!rules.advance(s,player(rules.config.home),1000).changed);
 for(let step=1;step<=4;step++){
  const before=s,p=player(rules.position(s)),r=rules.advance(s,p,step*2000);assert(r.changed);s=r.state;assert.equal(s.step,step);assert.deepEqual(r.transition.from,rules.position(before));assert.deepEqual(r.transition.to,rules.position(s));assert.equal(before.step,step-1);
  assert(!rules.advance(s,player(rules.position(s)),step*2000+1).changed,'repeated A cannot skip a teleport');
 }
 assert.deepEqual(rules.position(s),rules.config.home);assert(!rules.advance(s,player(rules.config.home),12000).changed);
});
test('personal collision and interaction move together without mutating another player or shared NPC',()=>{
 const base=createPnjStore(),a=rules.create({x:432,y:528},()=>0),b=rules.create({x:432,y:528},()=>.99),av=rules.scopedStore(base,()=>a),bv=rules.scopedStore(base,()=>b),pa=rules.position(a),pb=rules.position(b);
 assert.notDeepEqual(pa,pb);assert(av.isPnjBlockingTile(rules.config.map,pa.x,pa.y));assert.equal(av.getPnjAtTile(rules.config.map,pa.x,pa.y).name,rules.config.actor);
 assert(!av.isPnjBlockingTile(rules.config.map,rules.config.home.x,rules.config.home.y));assert(base.isPnjBlockingTile(rules.config.map,rules.config.home.x,rules.config.home.y));
 assert(bv.isPnjBlockingTile(rules.config.map,pb.x,pb.y));assert(!bv.isPnjBlockingTile(rules.config.map,pa.x,pa.y));
 assert.deepEqual(av.getPnjsForMap('start'),base.getPnjsForMap('start'));
});
test('malformed saved state is rejected, valid partial/completed states round-trip through expedition checkpoints',()=>{
 for(const s of [null,{},'invalid',{version:1,stops:[0,0,1,2],step:0,availableAt:0},{version:1,stops:[0,1,2,6],step:0,availableAt:0}])assert.equal(rules.normalize(s),null);
 const codec=require('../server/game/drift/checkpointCodec');let state=rules.create({x:432,y:528},()=>.2);
 state=rules.advance(state,player(rules.position(state)),1000).state;
 const saved=codec.decode(codec.encode({raphTrial:state}));assert.deepEqual(saved.raphTrial,state);assert.deepEqual(rules.normalize(JSON.stringify(state)),state);
 const finished={...state,step:4};assert.deepEqual(rules.position(rules.normalize(finished)),rules.config.home);
});
test('teleport pose disappears at departure and reappears at destination; reduced motion is immediate',async()=>{
 const {npcTeleportPose}=await import('../vue-explorakit/src/services/npcTeleport.js');
 const t={from:{x:8,y:8},to:{x:18,y:13},duration:960,receivedAt:1000};
 const a=npcTeleportPose(t,1000),hidden=npcTeleportPose(t,1384),b=npcTeleportPose(t,1816);
 assert.equal(a.x,8);assert.equal(a.alpha,1);assert.equal(hidden.alpha,0);assert.equal(b.x,18);assert(b.alpha>0&&b.alpha<1);assert.equal(npcTeleportPose(t,1960),null);assert.equal(npcTeleportPose(t,1200,false),null);
});
for(const mode of ['rift','colosseum'])test(`${mode}: personal pursuit, reconnect and checkpoint preserve progress before the real dialogue`,async()=>{
 const {createLobbyStore}=require('../server/game/drift/lobbyStore'),{createRunManager}=require('../server/game/drift/runManager'),codec=require('../server/game/drift/checkpointCodec');
 let time=100000;const events=[],store=createLobbyStore({now:()=>time}),user={id:1,username:'Raph'},peer={id:2,username:'Peer'},socket={id:'raph'};
 const runtime=createRunManager({store,namespace:{to:id=>({emit:(name,payload)=>events.push({id,name,payload})})},now:()=>time,random:()=>.2,starterChoiceMs:0,paceMs:0});store.connect(user,socket.id);
 if(mode==='colosseum')await runtime.startColosseum(user);else{store.connect(peer,'peer');const lobby=store.create(user,{capacity:2,durationMinutes:30});store.join(peer,lobby.code);store.ready(user,true);store.ready(peer,true);await runtime.start(user);}
 const p=runtime.playerFor(user);Object.assign(p,{currentmap:rules.config.map,x:432,y:528,arenaEntriesSeen:{'arena_entry:champion_raphael':'true'}});runtime.enter(user,socket);assert.equal(p.raphTrial.step,0);
 for(let step=1;step<=4;step++){
  Object.assign(p,player(rules.position(p.raphTrial)),{dialogue:null});runtime.interact(p);assert.equal(p.raphTrial.step,step);assert.equal(p.dialogue,null);
  const before=JSON.stringify(p.raphTrial);runtime.interact(p);assert.equal(JSON.stringify(p.raphTrial),before);time+=2000;
  if(step===2){const checkpoint=codec.decode(codec.encode(runtime.runs));assert.deepEqual(checkpoint.get(p.run.id).players.get(user.id).raphTrial,p.raphTrial);runtime.enter(user,socket);assert.equal(p.raphTrial.step,2);}
 }
 Object.assign(p,player(rules.config.home));runtime.interact(p);assert.equal(p.dialogue.name,rules.config.champion);
 assert.equal(events.filter(e=>e.name==='pnjsList'&&e.payload.teleport).length,4);
 assert.deepEqual(createPnjStore().getPnjsForMap(rules.config.map)[0].x,rules.config.home.x);
});
