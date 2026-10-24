const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const{once}=require('node:events'),{randomUUID}=require('node:crypto');
const enabled=process.env.RUN_MYSQL_TESTS==='1';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function event(socket,name,predicate=()=>true){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{socket.off(name,handler);reject(Error('Missing '+name));},7000);const handler=p=>{if(!predicate(p))return;clearTimeout(timer);socket.off(name,handler);resolve(p);};socket.on(name,handler);});}
test('real sockets: boards block, require nearby action, resist spam, persist per player and cancel on disconnect',{skip:!enabled,timeout:35000},async()=>{
 assert.match(process.env.DB_NAME||'',/test/i);
 const express=require('express'),{Server}=require('socket.io'),{io:client}=require('../vue-explorakit/node_modules/socket.io-client'),{dbPool:db}=require('../server/config/database');
 const app=express(),server=http.createServer(app),io=new Server(server);app.use(express.json());app.use('/api',require('../server/http/routes'));io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
 const ids=[],sockets=[];let user;
 async function connect(who,y){await db.execute("UPDATE users SET map='route2_maison',x=432,y=? WHERE id=?",[y*32+16,who.user.id]);const s=client(base,{autoConnect:false,auth:{token:who.token},transports:['websocket'],reconnection:false});sockets.push(s);const state=event(s,'storyGatesState');s.connect();return{s,state:await state};}
 async function flags(){const[r]=await db.execute("SELECT flag_key FROM player_story_flags WHERE user_id=? AND flag_key LIKE 'lucie_barricade_%'",[user.user.id]);return r.map(x=>x.flag_key);}
 let base;
 try{
  server.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}`;
  async function create(){const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'boards_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(r.status,201);const u=await r.json();ids.push(u.user.id);return u;}
  user=await create();const other=await create();let {s}=await connect(user,16);let y; s.on('playerMoved',p=>{if(p.id===s.id)y=p.player.y;});
  const blocked=event(s,'storyGateBlocked',p=>p.id==='lucie_barricade_1');s.emit('playerAction','move_z');await blocked;
  s.emit('roomObstacleAction',{active:false,id:'lucie_barricade_1'});s.emit('storyGatesState',{gates:[]});await pause(100);assert.deepEqual(await flags(),[]);
  const started=event(s,'roomObstacleAction',p=>p.active);const start=Date.now();s.emit('Space');assert.equal((await started).duration,2600);const finished=event(s,'roomObstacleAction',p=>!p.active);
  for(let i=0;i<12;i++){s.emit('Space');s.emit('playerAction','move_z');}await pause(400);assert.equal(y,undefined);assert.deepEqual(await flags(),[]);
  await finished;assert(Date.now()-start>=2500);assert.deepEqual(await flags(),['lucie_barricade_1_cleared']);
  const moved=event(s,'playerMoved',p=>p.id===s.id&&p.player.y===15*32+16);s.emit('playerAction','move_z');await moved;
  const save=await new Promise(r=>s.emit('requestGameSave',r));assert(save.success);s.disconnect();await pause(100);
  const re=await connect(user,12);s=re.s;assert.equal(re.state.gates.find(g=>g.id==='lucie_barricade_1').locked,false);
  const stranger=await connect(other,16);assert(stranger.state.gates.find(g=>g.id==='lucie_barricade_1').locked);stranger.s.disconnect();
  const cancel=event(s,'roomObstacleAction',p=>p.active);s.emit('Space');await cancel;s.disconnect();await pause(2800);assert.deepEqual(await flags(),['lucie_barricade_1_cleared']);
  ({s}=await connect(user,12));const again=event(s,'roomObstacleAction',p=>p.active);s.emit('Space');await again;await event(s,'roomObstacleAction',p=>!p.active);assert((await flags()).includes('lucie_barricade_2_cleared'));
  s.disconnect();await pause(80);await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value)VALUES(?,'lucie_freed','true')",[user.user.id]);const legacy=await connect(user,9);assert(legacy.state.gates.filter(g=>g.kind==='barricade').every(g=>!g.locked));
 }finally{for(const s of sockets)s.disconnect();await new Promise(r=>io.close(r));await pause(100);for(const id of ids)await db.execute('DELETE FROM users WHERE id=?',[id]);await db.end();}
});
