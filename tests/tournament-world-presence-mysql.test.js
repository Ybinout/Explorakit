const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),{once}=require('node:events'),{randomUUID}=require('node:crypto');
test('SQL/socket: tower visibility, movement, chat and appearances follow the absolute room through travel and reconnect',{skip:process.env.RUN_MYSQL_TESTS!=='1',timeout:45000},async()=>{
 assert.equal(process.env.DB_NAME,'explorakit_test');process.env.NODE_ENV='test';process.env.BATTLE_DELAY_SCALE='0';
 const express=require('express'),{Server}=require('socket.io'),{io:client}=require('../vue-explorakit/node_modules/socket.io-client');
 const {dbPool:db}=require('../server/config/database'),repository=require('../server/persistence/superTournamentRepository'),teams=require('../server/persistence/teamRepository'),factory=require('../server/game/drift/pokemonFactory'),codec=require('../server/game/drift/checkpointCodec'),{TournamentController}=require('../server/game/superTournament/controller'),{worldRoom}=require('../server/realtime/worldRooms');
 const handlers=require('../server/realtime/handlers/superTournamentHandlers'),originalHandlers=handlers.createHandlers,controllers=new Map();handlers.createHandlers=o=>{const h=originalHandlers(o);h.controller.random=()=>.99;controllers.set(o.userId,h.controller);return h;};
 const app=express(),server=http.createServer(app),io=new Server(server);app.use(express.json());app.use('/api',require('../server/http/routes'));io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
 const users=[],sockets=[],records=[],visible=[],initialTeams=[],floors=[0,0,1,16],map='super_tournament_room',load=repository.load;
 let releaseLoad,startedLoad,holdId=null;const waitingForLoad=new Promise(r=>{startedLoad=r;});
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 const command=(s,event,payload={})=>new Promise((resolve,reject)=>{const reply=(e,r)=>e?reject(Error(event+': '+e.message)):resolve(r);if(event==='requestGameSave')s.timeout(6000).emit(event,reply);else s.timeout(6000).emit(event,payload,reply);});
 function event(s,name,match=()=>true){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{s.off(name,listener);reject(Error('Missing '+name));},6000);function listener(p){if(match(p)){clearTimeout(timer);s.off(name,listener);resolve(p);}}s.on(name,listener);});}
 function make(base,u){const index=sockets.length,s=client(base,{auth:{token:u.token,superTournamentRoom:999},autoConnect:false,forceNew:true,reconnection:false,transports:['websocket']});sockets.push(s);records[index]=[];visible[index]={};
  s.onAny((name,data)=>{if(['playersList','newmap','newPlayer','playerJoined','playerLeft','playerDisconnected','playerMoved','world:speech','playerAppearanceUpdated','playerPaletteUpdated'].includes(name))records[index].push([name,data]);
   if(name==='playersList')visible[index]=data;if(name==='newmap')visible[index]=data.playersList;
   if(name==='newPlayer'||name==='playerJoined'||name==='playerMoved')visible[index][data.id]=data.player;
   if(name==='playerLeft'||name==='playerDisconnected')delete visible[index][data.id];
  });return s;
 }
 const count=(i,name,id)=>records[i].filter(([e,p])=>e===name&&(p.id===id||p.fromId===id)).length;
 async function move(s,key){const moved=event(s,'playerMoved',p=>p.id===s.id);s.emit('playerAction',key);const p=await moved;await pause(145);return p;}
 try{
  server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
  for(let i=0;i<4;i++){
   const response=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'tower_scope_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(response.status,201);const u=await response.json();users.push(u);
   const team={pokemons:[factory.create(9,100,true)]};await teams.editEquipe(u.user.id,team);initialTeams.push(codec.encode(await teams.loadEquipe(u.user.id)));
   await db.execute("INSERT INTO user_items(user_id,item_key,quantity)VALUES(?,'super_tournament_pass',1)",[u.user.id]);
   const seed=new TournamentController({userId:u.user.id,getPlayer:()=>({id:'seed-'+i,username:u.user.username}),emit(){},travel:async()=>{}});await seed.register(team);Object.assign(seed.run,{room:floors[i],cleared:floors[i],phase:'ready'});seed.run.cash.paidThrough=floors[i];seed.version=await repository.save(u.user.id,seed.run,seed.version);
   await db.execute("UPDATE users SET map=?,x=448,y=528 WHERE id=?",[map,u.user.id]);await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value)VALUES(?,'adventure_opening','complete') ON DUPLICATE KEY UPDATE flag_value='complete'",[u.user.id]);
   const s=make(base,u);s.connect();assert((await command(s,'requestGameSave')).success);assert.equal(io.sockets.sockets.get(s.id).data.worldRoom,worldRoom(map,{superTournamentActive:true,superTournamentRoom:floors[i]}));
  }
  await pause(50);assert.deepEqual(Object.keys(visible[0]).sort(),[sockets[0].id,sockets[1].id].sort());assert.deepEqual(Object.keys(visible[1]).sort(),[sockets[0].id,sockets[1].id].sort());assert.deepEqual(Object.keys(visible[2]),[sockets[2].id]);assert.deepEqual(Object.keys(visible[3]),[sockets[3].id]);
  for(let i=0;i<4;i++)for(const [name,data]of records[i].filter(([name])=>name==='playersList'||name==='newmap'))for(const id of Object.keys(name==='newmap'?data.playersList:data))assert.equal(floors[sockets.findIndex(s=>s.id===id)],floors[i]);
  records.forEach(r=>r.length=0);await move(sockets[0],'move_d');assert.equal(count(1,'playerMoved',sockets[0].id),1);assert.equal(count(2,'playerMoved',sockets[0].id),0);assert.equal(count(3,'playerMoved',sockets[0].id),0);
  assert((await command(sockets[0],'world:chat',{message:'Même étage',room:16})).success);assert((await command(sockets[0],'setSprite',{sprite:'sprite2.png'})).success);assert((await command(sockets[0],'setTrainerPalette',{palette:'sage-dark'})).success);await pause(50);
  for(const name of ['world:speech','playerAppearanceUpdated','playerPaletteUpdated']){assert.equal(count(1,name,sockets[0].id),1,name);assert.equal(count(2,name,sockets[0].id),0,name);assert.equal(count(3,name,sockets[0].id),0,name);}
  const denied=event(sockets[1],'interactionRequestFailed');sockets[1].emit('playerInteractionChoice',{targetId:sockets[2].id,type:'chat'});assert.equal((await denied).reason,'target_too_far');
  // A real victory, card skip and north doorway move floor 1 to floor 2,
  // although the map asset name is unchanged.
  const c=controllers.get(users[0].user.id);await c.execute(()=>c.atomic(()=>c.startBattle()));await c.execute(()=>c.atomic(()=>{for(const p of c.run.battle.b.equipe.pokemons)p.currentHp=0;c.run.battle.prune();c.run.battle.checkEnd();c.reconcile();}));assert((await command(sockets[0],'superTournament:reward',{offerId:c.run.reward.id,skip:true})).success);
  records.forEach(r=>r.length=0);for(let i=0;i<12;i++)await move(sockets[0],'move_z');await pause(40);assert.equal(c.run.room,1);assert.deepEqual(Object.keys(visible[0]).sort(),[sockets[0].id,sockets[2].id].sort());assert(!visible[1][sockets[0].id]);assert(visible[2][sockets[0].id]);assert(!visible[3][sockets[0].id]);assert.equal(count(1,'playerLeft',sockets[0].id),1);assert.equal(count(2,'playerJoined',sockets[0].id),1);
  records.forEach(r=>r.length=0);await move(sockets[0],'move_q');assert.equal(count(1,'playerMoved',sockets[0].id),0);assert.equal(count(2,'playerMoved',sockets[0].id),1);assert.equal(count(3,'playerMoved',sockets[0].id),0);
  const old=sockets[0].id,departed=event(sockets[2],'playerDisconnected',p=>p.id===old);sockets[0].disconnect();await departed;await pause(30);assert.equal(count(1,'playerDisconnected',old),0);assert.equal(count(2,'playerDisconnected',old),1);assert.equal(count(3,'playerDisconnected',old),0);
  // Delay restoring the saved attempt: the initial snapshot and movement
  // channel must stay private until the absolute floor is known.
  holdId=users[0].user.id;repository.load=async id=>{if(id===holdId){startedLoad();await new Promise(r=>{releaseLoad=r;});}return load(id);};
  const replacement=make(base,users[0]),ready=commandAfterConnect();function commandAfterConnect(){replacement.connect();return command(replacement,'requestGameSave');}await waitingForLoad;await pause(20);assert.deepEqual(Object.keys(visible[4]),[replacement.id]);
  await move(sockets[2],'move_d');assert.equal(count(4,'playerMoved',sockets[2].id),0);releaseLoad();assert((await ready).success);repository.load=load;holdId=null;await pause(30);assert.equal(io.sockets.sockets.get(replacement.id).data.worldRoom,worldRoom(map,{superTournamentActive:true,superTournamentRoom:1}));assert.deepEqual(Object.keys(visible[4]).sort(),[replacement.id,sockets[2].id].sort());assert(!visible[1][replacement.id]&&!visible[3][replacement.id]);
  assert((await command(replacement,'superTournament:abandon')).success);assert((await command(replacement,'superTournament:travel')).success);await pause(30);assert(!visible[2][replacement.id]);assert.equal((await repository.load(users[0].user.id)).run,null);
  assert((await command(sockets[1],'superTournament:abandon')).success);assert((await command(sockets[1],'superTournament:travel')).success);await pause(30);assert(visible[4][sockets[1].id]);assert(visible[1][replacement.id]);assert(!visible[2][replacement.id]&&!visible[3][replacement.id]);
  for(let i=0;i<4;i++)assert.deepEqual(codec.encode(await teams.loadEquipe(users[i].user.id)),initialTeams[i]);
 }finally{
  releaseLoad?.();repository.load=load;handlers.createHandlers=originalHandlers;sockets.forEach(s=>s.disconnect());require('../server/realtime/whitepeakClub').getClub(io).close();await new Promise(r=>io.close(r));await require('../server/realtime/accountConnection').waitForAccountConnections(io);for(const u of users)await db.execute('DELETE FROM users WHERE id=?',[u.user.id]);await db.end();
 }
});
