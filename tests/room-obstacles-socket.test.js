const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const{once}=require('node:events'),{randomUUID}=require('node:crypto');
const enabled=process.env.RUN_MYSQL_TESTS==='1';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function event(socket,name,predicate=()=>true){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{socket.off(name,handler);reject(Error('Missing '+name));},12000);const handler=p=>{if(!predicate(p))return;clearTimeout(timer);socket.off(name,handler);resolve(p);};socket.on(name,handler);});}
test('crystals require ten discrete actions: idle time, rapid taps, persistence, personal state, lab prerequisite and admin reset',{skip:!enabled,timeout:55000},async()=>{
 assert.equal(process.env.DB_NAME,'explorakit_test');
 const express=require('express'),{Server}=require('socket.io'),{io:client}=require('../vue-explorakit/node_modules/socket.io-client'),{dbPool:db}=require('../server/config/database');
 const{waitForAccountConnections}=require('../server/realtime/accountConnection');
 const room=require('../server/game/world/roomObstacles'),policy=require('../server/game/world/arenaTests');
 const originalOwner=policy.isOwner;
 const app=express(),server=http.createServer(app),io=new Server(server);app.use(express.json());app.use('/api',require('../server/http/routes'));io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
 const ids=[],sockets=[];let base,sequence=0;
 async function disconnect(s){s.disconnect();await waitForAccountConnections(io);}
 async function connect(who,y,map='route2_maison'){
  await db.execute('UPDATE users SET map=?,x=432,y=? WHERE id=?',[map,y*32+16,who.user.id]);
  const s=client(base,{autoConnect:false,auth:{token:who.token},transports:['websocket'],reconnection:false});sockets.push(s);
  const state=event(s,'storyGatesState'),speech=new Promise(resolve=>s.once('dialogue',resolve));s.connect();const snapshot=await state;
  if(map==='route2_maison'&&y>=16&&snapshot.gates.find(g=>g.id==='lucie_barricade_1').locked){
   const intro=await speech;assert.equal(intro[1],'lucie_room_entry');
   let acted=false;s.once('roomObstacleAction',()=>acted=true);s.emit('roomObstacle:hit',{pressId:++sequence});await pause(60);assert(!acted,'warning must finish before striking');
   s.emit('onEndDialogue',intro[1]);await pause(60);
  }
  return{s,state:snapshot};
 }
 async function flags(who){const[r]=await db.execute('SELECT flag_key,flag_value FROM player_story_flags WHERE user_id=?',[who.user.id]);return Object.fromEntries(r.map(x=>[x.flag_key,x.flag_value]));}
 async function hit(s,hits,id='lucie_barricade_1',legacy=false){const a=event(s,'roomObstacleAction',p=>p.id===id&&p.hits===hits);s.emit(legacy?'Space':'roomObstacle:hit',legacy?undefined:{pressId:++sequence,hits:100,id:'lab_crystals'});return a;}
 try{
  server.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}`;
  async function create(){const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'crystals_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(r.status,201);const u=await r.json();ids.push(u.user.id);return u;}
  const user=await create(),other=await create();let{s}=await connect(user,16);
  let blocked=event(s,'storyGateBlocked',p=>p.id==='lucie_barricade_1');s.emit('playerAction','move_z');await blocked;
  s.emit('roomObstacleAction',{active:false,id:'lucie_barricade_1'});await pause(50);assert.equal((await flags(user)).lucie_barricade_1_cleared,undefined);
  const first=await hit(s,1);assert(first.manual);assert.equal(first.requiredHits,10);assert.deepEqual(first.strikeTimes,[80]);assert(!first.success);assert.deepEqual(first.target,{x:13,y:15});
  // Replayed packets and elapsed time cannot generate more hits.
  s.emit('roomObstacle:hit',{pressId:sequence});s.emit('roomObstacle:hit',{hits:10});
  await pause(8300);let f=await flags(user);assert.equal(f[room.hitFlag(room.obstacles[0])],'1');assert.equal(f.lucie_barricade_1_cleared,undefined);
  const ninth=event(s,'roomObstacleAction',p=>p.id==='lucie_barricade_1'&&p.hits===9);
  for(let i=0;i<8;i++)s.emit('roomObstacle:hit',{pressId:++sequence});await ninth;
  f=await flags(user);assert.equal(f.lucie_barricade_1_cleared,undefined,'nine real actions keep the path shut');
  // Wait for the final snapshot, then reconnect without losing partial damage.
  await pause(150);await disconnect(s);let re=await connect(user,16);s=re.s;assert.equal(re.state.gates.find(g=>g.id==='lucie_barricade_1').hits,9);
  const done=await hit(s,10);assert(done.success);await pause(100);assert.equal((await flags(user)).lucie_barricade_1_cleared,'true');
  await disconnect(s);re=await connect(other,16);assert.equal(re.state.gates.find(g=>g.id==='lucie_barricade_1').hits,0);assert(re.state.gates.find(g=>g.id==='lucie_barricade_1').locked);await disconnect(re.s);
  ({s}=await connect(user,12));await hit(s,1,'lucie_barricade_2',true);await pause(60);await disconnect(s);
  ({s}=await connect(user,12));assert.equal((await flags(user))[room.hitFlag(room.obstacles[1])],'1');await hit(s,2,'lucie_barricade_2');await pause(80);await disconnect(s);
  ({s}=await connect(user,9,'professor_lab'));const rejected=event(s,'progressionNotice',p=>/Professeur doit/.test(p.message));s.emit('roomObstacle:hit',{pressId:++sequence});await rejected;assert.equal((await flags(user)).lab_crystals_cleared,undefined);await disconnect(s);
  await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value)VALUES(?,'professor_defeated','true'),(?,'professor_departure','seen')",[user.user.id,user.user.id]);
  ({s}=await connect(user,9,'professor_lab'));const labDone=event(s,'roomObstacleAction',p=>p.id==='lab_crystals'&&p.hits===10);for(let i=0;i<10;i++)s.emit('roomObstacle:hit',{pressId:++sequence});await labDone;await pause(120);assert.equal((await flags(user)).lab_crystals_cleared,'true');await disconnect(s);
  // Admin replay uses its own hit keys. Re-arming cannot erase the real adventure.
  policy.isOwner=u=>u?.id===user.user.id;
  const progress={flags:{lucie_freed:'true',lucie_rescued:'true',professor_defeated:'true',sevenp_defeated:'true',professor_lab_key:'true'}};
  for(const[key,value]of Object.entries(progress.flags))await db.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value)VALUES(?,?,?) ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)',[user.user.id,key,value]);
  const repository=require('../server/persistence/arenaTestRepository');await repository.rearm(user.user);
  ({s}=await connect(user,16));for(let n=1;n<=3;n++){await hit(s,n);await pause(40);}await disconnect(s);
  f=await flags(user);assert.equal(f['room_obstacle_hits:admin_room_obstacle:lucie_barricade_1'],'3');assert.equal(f[room.hitFlag(room.obstacles[0])],'10');
  await repository.complete(user.user,'professor_story');await db.execute("UPDATE player_story_flags SET flag_value='seen' WHERE user_id=? AND flag_key='admin_professor_departure'",[user.user.id]);
  ({s}=await connect(user,9,'professor_lab'));await hit(s,1,'lab_crystals');await pause(50);await disconnect(s);f=await flags(user);assert.equal(f['room_obstacle_hits:admin_room_obstacle:lab_crystals'],'1');
  await repository.rearm(user.user);
  for(const obstacle of room.obstacles)await db.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value)VALUES(?,?,?) ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)',[user.user.id,'room_obstacle_hits:'+require('../server/game/world/testReplayState').obstacleFlag(obstacle),'7']);
  await repository.rearm(user.user);f=await flags(user);
  assert.equal(f.lucie_barricade_1_cleared,'true');assert.equal(f[room.hitFlag(room.obstacles[0])],'10');assert.equal(f.lab_crystals_cleared,'true');
  for(const obstacle of room.obstacles)assert.equal(f['room_obstacle_hits:'+require('../server/game/world/testReplayState').obstacleFlag(obstacle)],undefined);
 }finally{policy.isOwner=originalOwner;for(const s of sockets)s.disconnect();await waitForAccountConnections(io);await new Promise(r=>io.close(r));for(const id of ids)await db.execute('DELETE FROM users WHERE id=?',[id]);await db.end();}
});
