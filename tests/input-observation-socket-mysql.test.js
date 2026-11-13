const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),{once}=require('node:events'),{randomUUID}=require('node:crypto');
if(process.env.DB_NAME!=='explorakit_test'||process.env.RUN_MYSQL_TESTS!=='1')throw Error('Dedicated test database required');
const {dbPool:db}=require('../server/config/database'),{Server}=require('socket.io'),client=require('../vue-explorakit/node_modules/socket.io-client').io;
const users=require('../server/persistence/userRepository'),friends=require('../server/persistence/trainerRepository'),messages=require('../server/persistence/socialMessageRepository');
const {exclusiveAccountConnection,waitForAccountConnections}=require('../server/realtime/accountConnection'),{register}=require('../server/realtime/handlers/inputObservationHandlers');
test('authenticated native Socket stream: server qualifies only its own sender, persists offline DMs, and mobile streams remain exempt',{timeout:30000},async()=>{
 const ids=[],sockets=[],server=http.createServer(),io=new Server(server);let time=1000000;const loaded=new Set();
 const hub=require('../server/realtime/socialHub').createSocialHub({tickMs:0});
 io.use(require('../server/http/authMiddleware').authenticateSocket).on('connection',exclusiveAccountConnection(async(socket,account)=>{
  await hub.attach(socket);await register({socket,account,userId:socket.data.user.id,hub,now:()=>time});
  account.on('Space',(_p,ack)=>ack?.({ok:true}));account.on('probe',async(_p,ack)=>{await Promise.resolve();ack({ok:true});});loaded.add(socket.data.user.id);socket.emit('fixtureReady');
 }));
 const command=(s,e,data={})=>new Promise((resolve,reject)=>s.timeout(5000).emit(e,data,(err,r)=>err?reject(err):resolve(r)));
 async function make(u,ua){const s=client('http://127.0.0.1:'+server.address().port,{auth:{token:require('../server/config/auth').signAccessToken(u)},transports:['websocket'],extraHeaders:{'User-Agent':ua},forceNew:true,reconnection:false,autoConnect:false});sockets.push(s);const ready=once(s,'fixtureReady');s.connect();await ready;return s;}
 try{
  const a=await users.createUserWithStarter('InputSocket_'+randomUUID().slice(0,8),randomUUID()),b=await users.createUserWithStarter('InputSocket_'+randomUUID().slice(0,8),randomUUID()),mobile=await users.createUserWithStarter('InputPhone_'+randomUUID().slice(0,8),randomUUID());ids.push(a.id,b.id,mobile.id);
  for(const u of[a,mobile]){await friends.friendAction(u.id,b.id,'request');await friends.friendAction(b.id,u.id,'accept');}
  server.listen(0,'127.0.0.1');await once(server,'listening');const desktop=await make(a,'Mozilla/5.0 Windows Electron/45'),phone=await make(mobile,'Mozilla/5.0 iPhone Mobile');
  for(let i=0;i<850;i++){
   time+=200;await command(desktop,'Space');await command(phone,'Space');
   if(i%10===9){const p={version:1,sequence:i+1,intervals:Array(20).fill(200),count:20,untrusted:0,assisted:false,mobile:false,targetId:mobile.id,score:100};desktop.emit('input:rhythm',p);phone.emit('input:rhythm',p);await command(desktop,'probe');}
  }
  await new Promise(r=>setTimeout(r,150));const h=await messages.history(b.id,a.id);assert.equal(h.messages.length,1);assert(h.messages[0].automatic);assert.equal(h.messages[0].text,"J'utilise un autoclicker 🤖");assert.equal((await messages.history(b.id,mobile.id)).messages.length,0);
  desktop.disconnect();phone.disconnect();await waitForAccountConnections(io);const [[r]]=await db.execute('SELECT snapshot,last_alert_at FROM input_observations WHERE user_id=?',[a.id]);assert(r.snapshot&&Number(r.last_alert_at)>0);const[[other]]=await db.execute('SELECT COUNT(*) n FROM input_observations WHERE user_id=?',[mobile.id]);assert.equal(Number(other.n),0);
 }finally{sockets.forEach(s=>s.disconnect());await new Promise(r=>io.close(r));await waitForAccountConnections(io);hub.stop();for(const id of ids)await db.execute('DELETE FROM users WHERE id=?',[id]);await db.end();}
});
