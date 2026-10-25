const test=require('node:test'),assert=require('node:assert/strict');
const rules=require('../server/game/world/arenaCollapse'),{createArenaCollapseController}=require('../server/game/world/arenaCollapseController');
const collision=require('../server/game/world/mapRepository').loadCollisionData(rules.config.map);
test('three asymmetric irregular holes only remove their own cells and preserve the full central route',()=>{
 assert.equal(rules.config.holes.length,3);const used=new Set();
 for(const h of rules.config.holes)for(const [dx,dy]of h.cells){
  const x=h.x+dx,y=h.y+dy;
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
test('each distinct silhouette matches its blocked tile centres, leaving concave corners walkable',()=>{
 const inside=(points,x,y)=>{let hit=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],b=points[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;};
 assert.deepEqual(rules.config.holes.map(h=>h.cells.length),[4,5,3]);
 let notches=0;
 for(const h of rules.config.holes)for(let y=0;y<h.height;y++)for(let x=0;x<h.width;x++){
  const blocked=rules.contains(h,h.x+x,h.y+y);assert.equal(inside(h.outline,x+.5,y+.5),blocked,h.id+' '+x+','+y);
  if(!blocked){notches++;assert(!rules.blocked(1000,h.x+x,h.y+y,100000));}
 }
 assert.equal(notches,4);assert.equal(rules.snapshot(1000,100000).revision,2);
 const cells=rules.config.holes.flatMap(h=>h.cells.map(([x,y])=>[h.x+x,h.y+y]));
 assert(cells.some(([x,y])=>!cells.some(([xx,yy])=>xx===27-x&&yy===y)),'layout must not be mirrored');
 assert(rules.contains({x:2,y:3,width:2,height:1},3,3),'legacy rectangle descriptors remain valid');
});
test('blocking starts when a slab falls and remains permanent afterwards',()=>{
 const h=rules.config.holes[0];assert(!rules.blocked(1000,h.x,h.y,1000+h.atMs-1));assert(rules.blocked(1000,h.x,h.y,1000+h.atMs));assert(rules.blocked(1000,h.x,h.y,1000000));
});
test('an occupant always finds a real neighbouring solid tile without using the champion tile',()=>{
 for(const h of rules.config.holes){const [dx,dy]=h.cells[0],p={x:(h.x+dx)*32+16,y:(h.y+dy)*32+16},safe=rules.safeTile(p,collision,1000,100000,(x,y)=>x===13&&y===4);assert(safe);assert.equal(collision[safe.y][safe.x],0);assert(!rules.blocked(1000,safe.x,safe.y,100000));}
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
 runtime.enter(user,socket);const p=runtime.playerFor(user);Object.assign(p,{currentmap:rules.config.map,x:7*32+16,y:9*32+16,arenaEntriesSeen:{'arena_entry:champion_hoze':'true'}});runtime.enter(user,socket);assert.equal(p.hozeCollapseStartedAt,time);
 time+=65000;runtime.tick();assert(!rules.blocked(p.hozeCollapseStartedAt,Math.floor(p.x/32),Math.floor(p.y/32),time));
 Object.assign(p,{x:9*32+16,y:9*32+16,lastMove:0,dialogue:null});runtime.move(p,'move_q');assert.equal(p.x,9*32+16);
 const restored=codec.decode(codec.encode(runtime.runs));assert.equal(restored.get(p.run.id).players.get(user.id).hozeCollapseStartedAt,100000);assert(events.some(e=>e.name==='arenaCollapseState'&&e.payload?.elapsedMs>=65000));
});
test('Rift: a later visitor gets fresh cracks and collisions while the first player keeps the collapsed floor',async()=>{
 const {createLobbyStore}=require('../server/game/drift/lobbyStore'),{createRunManager}=require('../server/game/drift/runManager');
 let time=100000;const events=[],store=createLobbyStore({now:()=>time}),a={id:1},b={id:2};
 const runtime=createRunManager({store,namespace:{to:id=>({emit:(name,payload)=>events.push({id,name,payload})})},now:()=>time,random:()=>.2,starterChoiceMs:0,paceMs:0});
 store.connect(a,'a');store.connect(b,'b');const lobby=store.create(a,{capacity:2,durationMinutes:30});store.join(b,lobby.code);store.ready(a,true);store.ready(b,true);await runtime.start(a);
 const p=runtime.playerFor(a),q=runtime.playerFor(b);Object.assign(p,{currentmap:rules.config.map,x:432,y:432,arenaEntriesSeen:{'arena_entry:champion_hoze':'true'}});runtime.enter(a,{id:'a'});
 time+=65000;runtime.tick();assert.equal(q.hozeCollapseStartedAt,undefined);
 Object.assign(q,{currentmap:rules.config.map,x:432,y:432,arenaEntriesSeen:{'arena_entry:champion_hoze':'true'}});runtime.enter(b,{id:'b'});
 assert.equal(p.hozeCollapseStartedAt,100000);assert.equal(q.hozeCollapseStartedAt,165000);
 assert.equal(events.filter(e=>e.id==='b'&&e.name==='arenaCollapseState').at(-1).payload.elapsedMs,0);
 for(const x of [p,q])Object.assign(x,{x:304,y:304,lastMove:0,dialogue:null});
 runtime.move(p,'move_q');runtime.move(q,'move_q');assert.equal(p.x,304);assert.equal(q.x,272);
 Object.assign(q,{currentmap:'start'});runtime.enter(b,{id:'b'});time+=2000;Object.assign(q,{currentmap:rules.config.map});runtime.enter(b,{id:'b'});assert.equal(q.hozeCollapseStartedAt,165000);
});
test('legacy checkpoint clocks migrate only visited players and remain paused across restart and recovery',async()=>{
 const {createLobbyStore}=require('../server/game/drift/lobbyStore'),{createRunManager}=require('../server/game/drift/runManager'),codec=require('../server/game/drift/checkpointCodec');
 let time=100000;const make=()=>{const store=createLobbyStore({now:()=>time});return{store,runtime:createRunManager({store,namespace:{to:()=>({emit(){}})},now:()=>time,random:()=>.2,starterChoiceMs:0,paceMs:0})};};
 const a={id:1},b={id:2},first=make();first.store.connect(a,'a');first.store.connect(b,'b');const lobby=first.store.create(a,{capacity:2,durationMinutes:30});first.store.join(b,lobby.code);first.store.ready(a,true);first.store.ready(b,true);await first.runtime.start(a);
 const p=first.runtime.playerFor(a);p.currentmap=rules.config.map;p.hozeCollapseStage=1;p.run.hozeCollapseStartedAt=80000;
 const saved=codec.decode(codec.encode({runs:first.runtime.runs,lobbies:first.store.exportLobbies(),savedAt:time}));time+=300000;
 const second=make();second.store.restoreLobbies(saved.lobbies);second.runtime.restore(saved.runs,saved.savedAt);
 const restored=second.runtime.playerFor(a),unvisited=second.runtime.playerFor(b);assert.equal(restored.hozeCollapseStartedAt,380000);assert.equal(unvisited.hozeCollapseStartedAt,undefined);
 second.runtime.setStorageAvailable(false);time+=5000;second.runtime.setStorageAvailable(true);assert.equal(restored.hozeCollapseStartedAt,385000);
 const fresh=codec.decode(codec.encode({runs:second.runtime.runs,lobbies:second.store.exportLobbies(),savedAt:time}));time+=10000;const third=make();third.store.restoreLobbies(fresh.lobbies);third.runtime.restore(fresh.runs,fresh.savedAt);assert.equal(third.runtime.playerFor(a).hozeCollapseStartedAt,395000);assert.equal(third.runtime.playerFor(b).hozeCollapseStartedAt,undefined);
 time+=2000;for(const u of [a,b]){third.store.connect(u,'r'+u.id);third.runtime.enter(u,{id:'r'+u.id});}third.runtime.tick();assert.equal(third.runtime.playerFor(a).hozeCollapseStartedAt,397000);
});
