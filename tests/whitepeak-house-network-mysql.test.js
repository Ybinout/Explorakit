const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
const enabled=process.env.RUN_MYSQL_TESTS==='1';
test('SQL/socket cooperative preparation, actor ownership, reconnect grace and real settlement', {skip:!enabled},async()=>{
 assert.equal(process.env.DB_NAME,'explorakit_test');process.env.NODE_ENV='test';
 const {Server}=require('socket.io'),{io:client}=require('../vue-explorakit/node_modules/socket.io-client');
 const {dbPool:db}=require('../server/config/database'),teams=require('../server/persistence/teamRepository'),users=require('../server/persistence/userRepository'),factory=require('../server/game/drift/pokemonFactory');
 const clubModule=require('../server/realtime/whitepeakClub'),original=clubModule.getClub,contexts=new Map(),hooks=new Map(),accounts=[],sockets=[];
 let clock=Date.now(),club,xpEvents=0,server,io;
 const wait=(socket,event)=>new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Missing '+event)),8000);socket.once(event,data=>{clearTimeout(timeout);resolve(data);});});
 const command=(socket,name,data)=>new Promise((resolve,reject)=>socket.timeout(8000).emit('whitepeak:'+name,data,(error,result)=>error?reject(error):resolve(result)));
 const connect=async user=>{const s=client('http://127.0.0.1:'+server.address().port,{auth:{token:require('../server/config/auth').signAccessToken(user),houseModes:1},forceNew:true,autoConnect:false,reconnection:false,transports:['websocket']});sockets.push(s);s.on('battleExperience',()=>xpEvents++);const ready=wait(s,'whitepeak:trainers');s.connect();await ready;return s;};
 try{
  clubModule.getClub=io=>{if(club)return club;club=clubModule.createClub(io,{now:()=>clock,tickMs:0});const attach=club.attach;club.attach=c=>{contexts.set(c.id,c);const h=attach(c);hooks.set(c.id,h);return h;};return club;};
  server=http.createServer();io=new Server(server);io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);server.listen(0,'127.0.0.1');await once(server,'listening');
  for(let i=0;i<4;i++){const u=await users.createUserWithStarter('house_net_'+randomUUID(),randomUUID());accounts.push(u);await teams.editEquipe(u.id,{pokemons:[9,94,212,248,445,121].map(id=>{const p=factory.create(id,50,true);p.abilities=['Splash'];p.heldItem=null;return p;})});await db.execute("UPDATE users SET map='ville5_maison1',x=432,y=208,money=50000 WHERE id=?",[u.id]);await db.execute("UPDATE player_story_flags SET flag_value='complete' WHERE user_id=? AND flag_key='adventure_opening'",[u.id]);await connect(u);}
  const [a,b,c,observer]=sockets;
  assert((await command(a,'create',{mode:'2v1',money:1000})).success);
  for(const[i,u]of accounts.slice(0,3).entries()){Object.assign(contexts.get(u.id).getPlayer(),{x:(i?19:8)*32+16,y:8*32+16});await hooks.get(u.id).step();}
  const r=club.room;assert.equal(r.phase,'preparation');assert.equal((await command(observer,'compose',{id:r.id,sideRevision:0,composition:[]})).success,false);
  for(const [i,u]of accounts.slice(0,3).entries())assert((await command(sockets[i],'confirm',{id:r.id,sideRevision:r.sides.find(s=>s.ids.includes(u.id)).revision})).success);
  assert.equal(r.phase,'battle');const side=r.sides[1],owner=side.control.ownerId,ownerIndex=accounts.findIndex(u=>u.id===owner),partner=side.ids.find(id=>id!==owner),token=r.engine.token,revision=side.control.revision;
  assert.equal((await command(sockets[accounts.findIndex(u=>u.id===partner)],'action',{id:r.id,turnId:token,controlRevision:revision,action:'attack',number:0})).success,false);
  assert((await command(sockets[ownerIndex],'pass',{id:r.id,turnId:token,controlRevision:revision})).success);assert.equal(side.control.controllerId,partner);
  assert.equal((await command(sockets[ownerIndex],'action',{id:r.id,turnId:token,controlRevision:revision,action:'attack',number:0})).success,false);
  const pause=wait(a,'whitepeak:control');sockets[ownerIndex].disconnect();await pause;await club.execute(()=>{});assert(r.disconnected.has(owner));
  const deadline=r.engine.deadline;clock+=12000;await club.tick();assert.equal(r.engine.round,1);assert.equal(r.engine.deadline,deadline);
  const reconnected=await connect(accounts[ownerIndex]);await club.execute(()=>{});assert.equal(r.disconnected.size,0);assert.equal(r.engine.deadline,deadline+12000);assert.equal(side.control.controllerId,partner);
  assert.equal(contexts.get(owner).getPlayer().inbattle,true);assert(reconnected.connected);
  const ending=wait(a,'endbattle');await club.execute(()=>{for(const p of r.copies[0].equipe.pokemons)p.currentHp=0;r.engine.prune();r.engine.checkEnd();});await ending;await club.tick();assert.equal(r.phase,'finished');
  assert.equal(xpEvents,0);for(const u of accounts.slice(0,3)){const team=await teams.loadEquipe(u.id);assert(team.pokemons.every(p=>p.level===50&&p.ev.hp===0&&p.currentHp===p.maxHp));}
  const[[wallet]]=await db.execute('SELECT money FROM users WHERE id=?',[accounts[0].id]);assert.equal(Number(wallet.money),49000);
  const [[winner]]=await db.execute('SELECT money FROM users WHERE id=?',[partner]);assert.equal(Number(winner.money),50500);
 }finally{
  if(club?.room?.phase==='battle'){club.room.engine.finish(null,'server_restart');await club.tick();}
  sockets.forEach(s=>s.disconnect());club?.close();if(io){await new Promise(r=>io.close(r));await require('../server/realtime/accountConnection').waitForAccountConnections(io);}
  clubModule.getClub=original;for(const u of accounts)await db.execute('DELETE FROM users WHERE id=?',[u.id]);await db.end();
 }
});
