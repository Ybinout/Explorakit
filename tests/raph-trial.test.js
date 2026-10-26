const test=require('node:test'),assert=require('node:assert/strict');
const rules=require('../server/game/world/raphTrial'),{createPnjStore}=require('../server/game/world/pnjStore');
const {loadCollisionData}=require('../server/game/world/mapRepository');
const player=point=>({currentmap:rules.config.map,x:point.x*32+16,y:(point.y+1)*32+16});
test('clone stops and concealed dais keep authored footprints reachable',()=>{
 const grid=loadCollisionData(rules.config.map),original=createPnjStore().getPnjsForMap(rules.config.map)[0];
 assert.deepEqual(rules.config.home,{x:original.x,y:original.y});
 for(const p of [...rules.config.stops,rules.config.home])for(const x of [p.x,p.x+1])for(const y of [p.y-1,p.y])assert.equal(grid[y][x],0);
});
test('clones move indefinitely without revealing Raph; no repeated or immediate backtracking stop',()=>{
 const visited=new Set();let n=43;const random=()=>{n=(n*1664525+1013904223)>>>0;return n/2**32;};
 let state=rules.create({x:432,y:528},random);
 for(let step=1;step<=120;step++){
  const before=state,point=rules.position(before);visited.add(before.stop);
  const result=rules.advance(state,player(point),step*2000,random);assert(result.changed);state=result.state;
  assert.equal(state.step,step);assert(!state.revealed);assert(!result.transition.complete);assert.equal(result.transition.kind,'clone');
  assert.notEqual(state.stop,before.stop);assert.notEqual(state.stop,before.previous);
  const next=rules.position(state);assert(Math.abs(point.x-next.x)+Math.abs(point.y-next.y)>=5);
  assert.notDeepEqual(next,rules.config.home);assert.equal(Object.keys(state).length,6,'saved state stays bounded');
  assert(!rules.advance(state,player(next),step*2000+1).changed,'cooldown prevents skipping appearances');
 }
 assert.equal(visited.size,rules.config.stops.length);
});
test('the dais can reveal Raph immediately, long after four clones, and only beside its real location',()=>{
 for(const count of [0,4,17]){
  let state=rules.create({x:432,y:528},()=>.5);
  assert(!rules.advance(state,{currentmap:'start',x:0,y:0},1000).changed);
  assert(!rules.advance(state,{currentmap:rules.config.map,x:16,y:16},1000).changed);
  for(let i=0;i<count;i++)state=rules.advance(state,player(rules.position(state)),(i+1)*2000,()=>.3).state;
  const now=(count+1)*2000,result=rules.advance(state,player(rules.config.home),now);
  assert(result.changed&&result.state.revealed&&result.transition.complete);assert.equal(result.transition.kind,'reveal');
  assert.deepEqual(result.transition.from,rules.position(state));assert.deepEqual(result.transition.to,rules.config.home);
  assert(!rules.ready(result.state,now));assert(rules.ready(result.state,now+rules.config.duration));
  assert(!rules.advance(result.state,player(rules.config.home),now+2000).changed);
 }
});
test('personal clone rendering, invisible dais interaction and collision never mutate another player',()=>{
 const base=createPnjStore(),a=rules.create({x:432,y:528},()=>0),b=rules.create({x:432,y:528},()=>.99),av=rules.scopedStore(base,()=>a),bv=rules.scopedStore(base,()=>b),pa=rules.position(a),pb=rules.position(b);
 assert.notDeepEqual(pa,pb);assert(av.isPnjBlockingTile(rules.config.map,pa.x,pa.y));assert.equal(av.getPnjAtTile(rules.config.map,pa.x,pa.y).name,rules.config.actor);
 assert(av.isPnjBlockingTile(rules.config.map,rules.config.home.x,rules.config.home.y));
 assert.equal(av.getPnjAtTile(rules.config.map,rules.config.home.x,rules.config.home.y).interactionName,rules.config.champion);
 assert(!av.getPnjsForMap(rules.config.map).some(p=>p.x===rules.config.home.x&&p.y===rules.config.home.y));
 assert(bv.isPnjBlockingTile(rules.config.map,pb.x,pb.y));assert(!bv.isPnjBlockingTile(rules.config.map,pa.x,pa.y));
 assert.deepEqual(av.getPnjsForMap('start'),base.getPnjsForMap('start'));
 const revealed=rules.advance(a,player(rules.config.home),1000).state,visible=rules.scopedStore(base,()=>revealed);
 assert(!visible.getPnjAtTile(rules.config.map,pa.x,pa.y));assert.deepEqual(rules.position(b),pb);
 assert.deepEqual(visible.getPnjsForMap(rules.config.map).find(p=>p.name===rules.config.actor).y,4);
});
test('legacy partial/completed saves migrate; malformed state is rejected and checkpoints round-trip',()=>{
 for(const value of [null,{},'invalid',{version:1,stops:[0,0,1,2],step:0,availableAt:0},{version:1,stops:[0,1,2,6],step:0,availableAt:0},
  {version:2,stop:0,previous:0,step:1,revealed:false,availableAt:0},{version:2,stop:0,previous:null,step:-1,revealed:false,availableAt:0}])assert.equal(rules.normalize(value),null);
 for(const step of [0,2,4]){const legacy={version:1,stops:[0,1,2,3],step,availableAt:500},state=rules.normalize(JSON.stringify(legacy));
  assert.equal(state.version,2);assert.equal(state.revealed,step===4);assert.deepEqual(rules.position(state),step===4?rules.config.home:rules.config.stops[step]);}
 const codec=require('../server/game/drift/checkpointCodec'),state=rules.create({x:432,y:528},()=>.2);
 const saved=codec.decode(codec.encode({raphTrial:state}));assert.deepEqual(saved.raphTrial,state);assert.deepEqual(rules.normalize(JSON.stringify(state)),state);
});
test('teleport pose disappears at departure and reappears at destination; reduced motion is immediate',async()=>{
 const {npcTeleportPose}=await import('../vue-explorakit/src/services/npcTeleport.js');
 const t={from:{x:8,y:8},to:{x:18,y:13},duration:960,receivedAt:1000};
 const a=npcTeleportPose(t,1000),hidden=npcTeleportPose(t,1384),b=npcTeleportPose(t,1816);
 assert.equal(a.x,8);assert.equal(a.alpha,1);assert.equal(hidden.alpha,0);assert.equal(b.x,18);assert(b.alpha>0&&b.alpha<1);assert.equal(npcTeleportPose(t,1960),null);assert.equal(npcTeleportPose(t,1200,false),null);
});
for(const mode of ['rift','colosseum'])test(`${mode}: endless personal clones, checkpoint/reconnect and one automatic battle after dais reveal`,async()=>{
 const {createLobbyStore}=require('../server/game/drift/lobbyStore'),{createRunManager}=require('../server/game/drift/runManager'),codec=require('../server/game/drift/checkpointCodec');
 let time=100000;const events=[],store=createLobbyStore({now:()=>time}),user={id:1,username:'Raph'},peer={id:2,username:'Peer'},socket={id:'raph'};
 const runtime=createRunManager({store,namespace:{to:id=>({emit:(name,payload)=>events.push({id,name,payload})})},now:()=>time,random:()=>.2,starterChoiceMs:0,paceMs:0,revealWait:async ms=>{time+=ms;}});store.connect(user,socket.id);
 if(mode==='colosseum')await runtime.startColosseum(user);else{store.connect(peer,'peer');const lobby=store.create(user,{capacity:2,durationMinutes:30});store.join(peer,lobby.code);store.ready(user,true);store.ready(peer,true);await runtime.start(user);}
 const p=runtime.playerFor(user);Object.assign(p,{currentmap:rules.config.map,x:432,y:528,arenaEntriesSeen:{'arena_entry:champion_raphael':'true'}});runtime.enter(user,socket);assert.equal(p.raphTrial.step,0);
 for(let step=1;step<=9;step++){
  Object.assign(p,player(rules.position(p.raphTrial)),{dialogue:null});await runtime.interact(p);assert.equal(p.raphTrial.step,step);assert.equal(p.dialogue,null);assert(!p.inbattle&&!p.raphTrial.revealed);
  const before=JSON.stringify(p.raphTrial);await runtime.interact(p);assert.equal(JSON.stringify(p.raphTrial),before);time+=2000;
  if(step===5){const checkpoint=codec.decode(codec.encode(runtime.runs));assert.deepEqual(checkpoint.get(p.run.id).players.get(user.id).raphTrial,p.raphTrial);runtime.enter(user,socket);assert.equal(p.raphTrial.step,5);}
 }
 assert.throws(()=>runtime.endDialogue(p,rules.config.champion),/Dialogue expiré/);
 Object.assign(p,player(rules.config.home));const started=runtime.interact(p);assert(p.raphTrial.revealed);assert(!p.inbattle);
 const previous={x:p.x,y:p.y};runtime.move(p,'move_s');assert.deepEqual({x:p.x,y:p.y},previous,'movement is locked during the reveal');
 await runtime.interact(p);await started;assert(p.inbattle);assert.equal(p.battle.type,'arena');assert.equal(p.dialogue,null);
 assert.equal(events.filter(e=>e.name==='battletrigger'&&e.id===socket.id).length,1);
 assert.equal(events.filter(e=>e.name==='pnjsList'&&e.payload.teleport?.kind==='clone').length,9);
 assert.equal(events.filter(e=>e.name==='pnjsList'&&e.payload.teleport?.kind==='reveal').length,1);
 assert.deepEqual(createPnjStore().getPnjsForMap(rules.config.map)[0].x,rules.config.home.x);
});
test('a reveal never starts a stale battle after disconnect, leaving the room or expedition expiry',async()=>{
 const {createLobbyStore}=require('../server/game/drift/lobbyStore'),{createRunManager}=require('../server/game/drift/runManager');
 for(const reason of ['disconnect','leave','expiry']){
  let time=100000,release;const gate=new Promise(resolve=>{release=resolve;}),events=[],user={id:1,username:'Reveal'},store=createLobbyStore({now:()=>time});
  const runtime=createRunManager({store,namespace:{to:id=>({emit:(name,payload)=>events.push({id,name,payload})})},now:()=>time,random:()=>.2,starterChoiceMs:0,paceMs:0,revealWait:async ms=>{await gate;time+=ms;}});
  store.connect(user,'initial');await runtime.startColosseum(user);const p=runtime.playerFor(user);
  Object.assign(p,player(rules.config.home),{arenaEntriesSeen:{'arena_entry:champion_raphael':'true'}});runtime.enter(user,{id:'initial'});
  const pending=runtime.interact(p);assert(p.raphTrial.revealed,'no clone visit is required');
  if(reason==='disconnect')p.socketId=null;
  if(reason==='leave')p.currentmap='start';
  if(reason==='expiry')p.run.endsAt=time+10;
  release();await pending;assert(!p.inbattle);assert(!events.some(e=>e.name==='battletrigger'));assert.equal(p.dialogue,null);
  if(reason==='disconnect'){
   store.connect(user,'return');runtime.enter(user,{id:'return'});await runtime.interact(p);assert(p.inbattle,'the revealed champion is still accessible after reconnect');
  }
 }
});
