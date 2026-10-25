const test=require('node:test'),assert=require('node:assert/strict');
const rules=require('../server/game/world/arenaCollapse'),{createArenaCollapseController}=require('../server/game/world/arenaCollapseController');
const collision=require('../server/game/world/mapRepository').loadCollisionData(rules.config.map);
test('six holes only remove walkable side floor and preserve the full central route',()=>{
 assert.equal(rules.config.holes.length,6);const used=new Set();
 for(const h of rules.config.holes)for(let y=h.y;y<h.y+h.height;y++)for(let x=h.x;x<h.x+h.width;x++){
  assert.equal(collision[y][x],0);assert(x<11||x>16);assert(!used.has(x+','+y));used.add(x+','+y);
 }
 for(let y=3;y<=17;y++)for(const x of [13,14])assert(!rules.blocked(1000,x,y,100000));
 // Every remaining floor tile is still reachable from the entrance.
 const seen=new Set(['13,17']),queue=[[13,17]];
 for(let i=0;i<queue.length;i++)for(const [x,y]of [[queue[i][0]+1,queue[i][1]],[queue[i][0]-1,queue[i][1]],[queue[i][0],queue[i][1]+1],[queue[i][0],queue[i][1]-1]]){
  if(collision[y]?.[x]!==0||rules.blocked(1000,x,y,100000)||seen.has(x+','+y))continue;seen.add(x+','+y);queue.push([x,y]);
 }
 for(let y=0;y<collision.length;y++)for(let x=0;x<collision[y].length;x++)if(collision[y][x]===0&&!rules.blocked(1000,x,y,100000))assert(seen.has(x+','+y),`Unreachable ${x},${y}`);
});
test('blocking starts when a slab falls and remains permanent afterwards',()=>{
 const h=rules.config.holes[0];assert(!rules.blocked(1000,h.x,h.y,1000+h.atMs-1));assert(rules.blocked(1000,h.x,h.y,1000+h.atMs));assert(rules.blocked(1000,h.x,h.y,1000000));
});
test('an occupant always finds a real neighbouring solid tile without using the champion tile',()=>{
 for(const h of rules.config.holes){const p={x:h.x*32+16,y:h.y*32+16},safe=rules.safeTile(p,collision,1000,100000,(x,y)=>x===13&&y===4);assert(safe);assert.equal(collision[safe.y][safe.x],0);assert(!rules.blocked(1000,safe.x,safe.y,100000));}
});
test('controller warns through its state, rescues on the deadline, restores and resets by a new epoch',async()=>{
 let time=100000,start=time,task,id=0;const frames=[],rescues=[];const p={currentmap:rules.config.map,x:7*32+16,y:9*32+16};
 const c=createArenaCollapseController({getPlayer:()=>p,loadStart:async()=>start,emit:s=>frames.push(s),rescue:(player,tile)=>{rescues.push(tile);player.x=tile.x*32+16;player.y=tile.y*32+16;},collision:()=>collision,occupied:()=>false,now:()=>time,setTimer:fn=>{task=fn;return ++id;},clearTimer:()=>{task=null;}});
 await c.enter();assert.equal(frames[0].elapsedMs,0);assert(!c.blocked(7,9));time+=12001;task();assert(c.blocked(7,9));assert.equal(rescues.length,1);
 time+=90000;await c.enter();assert(c.blocked(7,9));assert(frames.at(-1).elapsedMs>90000);
 start=time;await c.enter();assert(!c.blocked(7,9));assert.equal(frames.at(-1).elapsedMs,0);p.currentmap='start';await c.enter();assert.equal(frames.at(-1),null);assert.equal(task,null);assert(!c.blocked(7,9));c.stop();
});
test('late SQL response cannot restart a departed or disconnected arena controller',async()=>{
 let done,timers=0;const p={currentmap:rules.config.map};const c=createArenaCollapseController({getPlayer:()=>p,loadStart:()=>new Promise(r=>done=r),emit:()=>{},rescue:()=>{},collision:()=>collision,setTimer:()=>++timers});const entering=c.enter();c.stop();done(1000);await entering;assert.equal(timers,0);
});
for(const mode of ['rift','colosseum'])test(`${mode}: same blocking/rescue rules and checkpoint retains the collapse epoch`,async()=>{
 const {createLobbyStore}=require('../server/game/drift/lobbyStore'),{createRunManager}=require('../server/game/drift/runManager'),codec=require('../server/game/drift/checkpointCodec');
 let time=100000;const events=[],store=createLobbyStore({now:()=>time}),user={id:1,username:'Collapse'},peer={id:2,username:'Peer'},socket={id:'collapse'};
 const runtime=createRunManager({store,namespace:{to:id=>({emit:(name,payload)=>events.push({name,payload})})},now:()=>time,random:()=>.2,starterChoiceMs:0,paceMs:0});store.connect(user,socket.id);
 if(mode==='colosseum')await runtime.startColosseum(user);else{store.connect(peer,'peer');const lobby=store.create(user,{capacity:2,durationMinutes:30});store.join(peer,lobby.code);store.ready(user,true);store.ready(peer,true);await runtime.start(user);}
 runtime.enter(user,socket);const p=runtime.playerFor(user);Object.assign(p,{currentmap:rules.config.map,x:7*32+16,y:9*32+16,arenaEntriesSeen:{'arena_entry:champion_hoze':'true'}});runtime.enter(user,socket);assert.equal(p.run.hozeCollapseStartedAt,time);
 time+=65000;runtime.tick();assert(!rules.blocked(p.run.hozeCollapseStartedAt,Math.floor(p.x/32),Math.floor(p.y/32),time));
 Object.assign(p,{x:9*32+16,y:9*32+16,lastMove:0,dialogue:null});runtime.move(p,'move_q');assert.equal(p.x,9*32+16);
 const restored=codec.decode(codec.encode(runtime.runs));assert.equal(restored.get(p.run.id).hozeCollapseStartedAt,100000);assert(events.some(e=>e.name==='arenaCollapseState'&&e.payload?.elapsedMs>=65000));
});
