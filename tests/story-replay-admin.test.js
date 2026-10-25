const test=require('node:test'),assert=require('node:assert/strict');
const policy=require('../server/game/world/arenaTests');
const gates=require('../server/game/world/storyGates'),room=require('../server/game/world/roomObstacles');
const scenes=require('../server/game/world/arenaScenes').scenes;
test('replay overlays close personal gates and crystals without erasing real victories',()=>{
 const flags={};for(const c of policy.encounters)Object.assign(flags,c.definition.reward?.flags);
 for(const o of room.obstacles)flags[o.requiredFlag]='true';
 const original={flags,completedNpcBattles:policy.encounters.map(c=>({battleKey:c.definition.battleKey}))};
 assert(gates.snapshot(original).every(g=>!g.locked));
 const replay={...original,testReplays:policy.encounters.map(c=>c.name)};
 assert(gates.snapshot(replay).every(g=>g.locked));
 assert(gates.actorAtTile('ville4',13,4,replay));
 assert.equal(room.entryDialogue({currentmap:'route2_maison',y:528},replay),'lucie_room_entry');
 const first=room.obstacles[0];replay.flags={...flags,[require('../server/game/world/testReplayState').obstacleFlag(first)]:'true'};
 assert(!room.isLocked(first,replay));assert(room.isLocked(room.obstacles[1],replay));
 assert(gates.snapshot(original).every(g=>!g.locked));
 const dialogue=require('../server/game/world/interactionRepository');
 assert.equal(dialogue.getSentenceForMapAndPosition('start',18,2,replay)[1],'dia1','tile-based Wayne also replays');
});

test('owner replay SQL/socket: entry speeches, story duels, crystals, isolation and repeat reset', {skip:process.env.RUN_MYSQL_TESTS!=='1',timeout:90000},async()=>{
 assert.match(process.env.DB_NAME||'',/test/i);
 const http=require('node:http'),{once}=require('node:events'),{randomUUID}=require('node:crypto');
 const express=require('express'),{Server}=require('socket.io'),{io:client}=require('../vue-explorakit/node_modules/socket.io-client');
 const {dbPool:db}=require('../server/config/database'),repository=require('../server/persistence/arenaTestRepository');
 const progression=require('../server/persistence/progressionRepository'),teamRepo=require('../server/persistence/teamRepository');
 const app=express(),server=http.createServer(app),io=new Server(server);app.use(express.json());app.use('/api',require('../server/http/routes'));io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
 const ids=[],sockets=[],original=policy.isOwner,pause=ms=>new Promise(r=>setTimeout(r,ms));let s,base;
 const event=(socket,name,accept=()=>true)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{socket.off(name,handler);reject(Error('Missing '+name));},10000);function handler(p){if(!accept(p))return;clearTimeout(timer);socket.off(name,handler);resolve(p);}socket.on(name,handler);});
 const reset=socket=>new Promise(r=>socket.emit('admin:rearmArenas',{},r));
 async function create(){const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'replay_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(r.status,201);const u=await r.json();ids.push(u.user.id);return u;}
 async function connect(u,map,x,y,speech=null){
  const team=await teamRepo.loadEquipe(u.user.id);require('../server/game/world/playerRecovery').healTeam(team);await teamRepo.editEquipe(u.user.id,team);
  await db.execute('UPDATE users SET map=?,x=?,y=? WHERE id=?',[map,x*32+16,y*32+16,u.user.id]);
  const socket=client(base,{autoConnect:false,auth:{token:u.token},transports:['websocket'],reconnection:false});sockets.push(socket);
  const state=event(socket,'progressionState'),line=speech?event(socket,'dialogue',d=>d[1]===speech):null;socket.connect();await state;
  if(line){await line;socket.emit('onEndDialogue',speech);await pause(100);}return socket;
 }
 async function leave(){s.disconnect();await pause(150);}
 async function fight(name){
  const speech=event(s,'dialogue');s.emit('Space');assert.equal((await speech)[1],name);
  const end=event(s,'endbattle'),after=event(s,'dialogue',d=>d[1]===name+'_after');
  s.on('requestAction',()=>s.emit('actionResponse',{action:'attack',number:0}));s.emit('onEndDialogue',name);
  const outcome=await end;assert.equal(outcome.summary.outcome,'victory',name);assert.equal(outcome.summary.money,0);
  assert.equal((await after)[2].afterBattle,true);s.emit('onEndDialogue',name+'_after');await pause(150);
 }
 try{
  server.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}`;
  const admin=await create(),other=await create();policy.isOwner=u=>u?.id===admin.user.id&&u?.username===admin.user.username;
  for(const u of [admin,other]){
   for(const flag of ['route_guard_defeated','aspha_route2_defeated'])await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value)VALUES(?,?,'true')",[u.user.id,flag]);
   for(const c of policy.encounters)await progression.completeNpcBattle(u.user.id,c.name);
   for(const scene of scenes)await require('../server/persistence/arenaSceneRepository').acknowledge(u.user.id,scene.name);
   for(const o of room.obstacles)await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value)VALUES(?,?,'true')",[u.user.id,o.requiredFlag]);
  }
  const before=await progression.loadProgressState(admin.user.id),otherBefore=await progression.loadProgressState(other.user.id);
  const lead=require('../server/game/drift/pokemonFactory').create(150,200,true);lead.k=4;lead.recalculateStats();lead.currentHp=lead.maxHp;lead.abilities=[];lead.movePp=[];lead.addAbility('Dark Pulse');await teamRepo.editEquipe(admin.user.id,{pokemons:[lead]});
  s=await connect(admin,'start',18,3);assert.equal((await reset(s)).count,policy.encounters.length);
  let progress=await progression.loadProgressState(admin.user.id);assert.equal(progress.testReplays.length,policy.encounters.length);assert(gates.snapshot(progress).every(g=>g.locked));
  for(const scene of scenes)assert.equal(progress.flags[scene.flag],undefined);
  for(const o of room.obstacles)assert.equal(progress.flags[o.requiredFlag],'true');
  assert.deepEqual((await progression.loadProgressState(other.user.id)).flags,otherBefore.flags);
  // Even copied replay markers cannot give another SQL identity this feature.
  await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value)VALUES(?,?,'ready')",[other.user.id,policy.encounters[0].flag]);
  assert.deepEqual((await progression.loadProgressState(other.user.id)).testReplays,[]);
  await fight('dia1');assert(!gates.snapshot(await progression.loadProgressState(admin.user.id)).find(g=>g.id==='wayne_route1').locked);await leave();
  for(const scene of scenes){s=await connect(admin,scene.map,13,16,scene.name);assert.equal((await progression.loadProgressState(admin.user.id)).flags[scene.flag],'true');await leave();}
  for(const [map,x,y,name]of [['route2',24,5,'aspha_route2'],['gen_route8',22,17,'gwenn_route8'],['ville_safe1',25,8,'mathilde_pikapika'],['route4_maison',13,10,'gwenn_rochebrume']]){s=await connect(admin,map,x,y);await fight(name);await leave();}
  progress=await progression.loadProgressState(admin.user.id);assert.equal(gates.actorAtTile('ville4',13,4,progress),null);
  s=await connect(admin,'route2_maison',13,16,'lucie_room_entry');
  for(const obstacle of room.obstacles){
   if(obstacle!==room.obstacles[0]){await leave();s=await connect(admin,'route2_maison',13,obstacle.y+1);}
   const done=event(s,'roomObstacleAction',p=>p.active===false&&p.success);s.emit('Space');await done;
   progress=await progression.loadProgressState(admin.user.id);assert(!room.isLocked(obstacle,progress));assert.equal(progress.flags[obstacle.requiredFlag],'true');
  }
  await leave();s=await connect(admin,'route2_maison',13,6);await fight('lucie_route2');
  progress=await progression.loadProgressState(admin.user.id);assert(!progress.testReplays.includes('lucie_route2'));assert(gates.snapshot(progress).every(g=>!g.locked));
  for(const key of ['money','badges','completedNpcBattles','quests'])assert.deepEqual(progress[key],before[key],key+' preserved');
  const trained=(await teamRepo.loadEquipe(admin.user.id)).pokemons[0];assert.equal(trained.experience,lead.experience);assert.deepEqual(trained.ev,lead.ev);
  assert.equal((await reset(s)).count,policy.encounters.length);progress=await progression.loadProgressState(admin.user.id);assert(gates.snapshot(progress).every(g=>g.locked));
  for(const scene of scenes)assert.equal(progress.flags[scene.flag],undefined);
  // Reconnect, then leave/re-enter without reconnecting: both replay the warning.
  await leave();s=await connect(admin,'route2_maison',13,16,'lucie_room_entry');
  let changed=event(s,'newmap',p=>p.mapname==='route2');s.emit('playerAction','move_s');await changed;await pause(400);
  const warning=event(s,'dialogue',p=>p[1]==='lucie_room_entry');s.emit('playerAction','move_z');await warning;s.emit('onEndDialogue','lucie_room_entry');await pause(100);
  // Another owner tab reading an entry scene must prevent an overlapping reset.
  const peer=await connect(admin,scenes[0].map,13,16);await pause(100);
  assert.equal((await reset(s)).success,false);peer.emit('onEndDialogue',scenes[0].name);await pause(100);
  const refreshed=event(peer,'progressionState');assert.equal((await reset(s)).count,policy.encounters.length);assert.equal((await refreshed).testReplays.length,policy.encounters.length);
 }finally{for(const socket of sockets)socket.disconnect();await new Promise(r=>io.close(r));await pause(150);policy.isOwner=original;for(const id of ids)await db.execute('DELETE FROM users WHERE id=?',[id]);await db.end();}
});
