const test=require('node:test'),assert=require('node:assert/strict');
test('SQL/socket: collapsed floor blocks moves, rescues occupants, persists and resets only for the owner',{skip:process.env.RUN_MYSQL_TESTS!=='1',timeout:35000},async()=>{
 assert.match(process.env.DB_NAME||'',/test/);
 const express=require('express'),http=require('http'),{once}=require('events'),{randomUUID}=require('crypto'),{Server}=require('socket.io'),{io:client}=require('../vue-explorakit/node_modules/socket.io-client');
 const {dbPool:db}=require('../server/config/database'),rules=require('../server/game/world/arenaCollapse'),policy=require('../server/game/world/arenaTests'),original=policy.isOwner;
 const app=express(),server=http.createServer(app),io=new Server(server),ids=[],sockets=[];let base;
 app.use(express.json());app.use('/api',require('../server/http/routes'));io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 const event=(s,name,accept=()=>true)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{s.off(name,handler);reject(Error('Missing '+name));},6000);function handler(p){if(!accept(p))return;clearTimeout(timer);s.off(name,handler);resolve(p);}s.on(name,handler);});
 async function create(){const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'collapse_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(r.status,201);const u=await r.json();ids.push(u.user.id);await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,'arena_entry:champion_hoze','true')",[u.user.id]);return u;}
 async function connect(u,x,y){await db.execute('UPDATE users SET map=?,x=?,y=? WHERE id=?',[rules.config.map,x*32+16,y*32+16,u.user.id]);const s=client(base,{autoConnect:false,auth:{token:u.token},transports:['websocket'],reconnection:false});sockets.push(s);const state=event(s,'arenaCollapseState',p=>p?.map===rules.config.map),ready=event(s,'progressionState');s.connect();const snapshot=await state;await ready;return{s,snapshot};}
 async function start(u,value){await db.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)',[u.user.id,rules.config.flag,String(value)]);}
 try{
  server.listen(0,'127.0.0.1');await once(server,'listening');base='http://127.0.0.1:'+server.address().port;const admin=await create(),other=await create();policy.isOwner=u=>u?.id===admin.user.id&&u.username===admin.user.username;
  const past=Date.now()-65000;await start(admin,past);await start(other,past);
  let {s,snapshot}=await connect(admin,9,9);assert(snapshot.elapsedMs>=65000);let position=null;s.on('playerMoved',p=>{if(p.id===s.id)position=p.player;});
  s.emit('playerAction','move_q');await wait(180);assert.equal(position,null,'cannot enter the hole');
  s.emit('arenaCollapseState',{elapsedMs:0,holes:[]});s.emit('admin:collapseReset',{});s.emit('playerAction','move_q');await wait(160);assert.equal(position,null,'forged events cannot reopen the floor');
  const moved=event(s,'playerMoved',p=>p.id===s.id&&p.player.x===10*32+16);s.emit('playerAction','move_d');await moved;s.disconnect();await wait(120);
  ({s,snapshot}=await connect(admin,7,9));assert.equal(snapshot.epoch,past);const [[row]]=await db.execute('SELECT x,y FROM users WHERE id=?',[admin.user.id]);assert(!rules.blocked(past,Math.floor(row.x/32),Math.floor(row.y/32)),'reconnect on a hole rescues and saves');
  const otherSocket=(await connect(other,13,12)).s;assert.equal((await new Promise(r=>otherSocket.emit('admin:rearmArenas',{},r))).success,false);
  const resetState=event(s,'arenaCollapseState',p=>p?.epoch!==past);const result=await new Promise(r=>s.emit('admin:rearmArenas',{},r));assert(result.success);const fresh=await resetState;assert(fresh.elapsedMs<1000);
  const [[stranger]]=await db.execute('SELECT flag_value FROM player_story_flags WHERE user_id=? AND flag_key=?',[other.user.id,rules.config.flag]);assert.equal(Number(stranger.flag_value),past);
  s.disconnect();await wait(120);({s,snapshot}=await connect(admin,13,12));assert.equal(snapshot.epoch,fresh.epoch);
 }finally{for(const s of sockets)s.disconnect();await new Promise(r=>io.close(r));await wait(200);policy.isOwner=original;for(const id of ids)await db.execute('DELETE FROM users WHERE id=?',[id]);await db.end();}
});
