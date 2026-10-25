const test=require('node:test'),assert=require('node:assert/strict');
test('SQL/socket: four personal Raph teleports, collision, reconnect, forged completion and admin reset',{skip:process.env.RUN_MYSQL_TESTS!=='1',timeout:60000},async()=>{
 assert.match(process.env.DB_NAME||'',/test/i);
 const express=require('express'),http=require('http'),{once}=require('events'),{randomUUID}=require('crypto'),{Server}=require('socket.io'),{io:client}=require('../vue-explorakit/node_modules/socket.io-client');
 const {dbPool:db}=require('../server/config/database'),rules=require('../server/game/world/raphTrial'),policy=require('../server/game/world/arenaTests'),original=policy.isOwner,grid=require('../server/game/world/mapRepository').loadCollisionData(rules.config.map);
 const app=express(),server=http.createServer(app),io=new Server(server),ids=[],sockets=[];let base;
 app.use(express.json());app.use('/api',require('../server/http/routes'));io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 const event=(s,name,accept=()=>true)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{s.off(name,handler);reject(Error('Missing '+name));},6000);function handler(p){if(!accept(p))return;clearTimeout(timer);s.off(name,handler);resolve(p);}s.on(name,handler);});
 async function create(){const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'raph_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(r.status,201);const u=await r.json();ids.push(u.user.id);await db.execute("UPDATE users SET map='gen_arene5',x=432,y=496 WHERE id=?",[u.user.id]);for(const key of ['hoze_defeated','arena_entry:champion_raphael'])await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,'true')",[u.user.id,key]);return u;}
 async function stored(u){const [[r]]=await db.execute('SELECT flag_value FROM player_story_flags WHERE user_id=? AND flag_key=?',[u.user.id,rules.config.flag]);return rules.normalize(r?.flag_value);}
 async function connect(u){const s=client(base,{autoConnect:false,auth:{token:u.token},transports:['websocket'],reconnection:false});sockets.push(s);const ready=event(s,'progressionState'),npcs=event(s,'pnjsList',p=>p.mapname===rules.config.map),players=event(s,'playersList');s.connect();let list=await players,position=list[s.id];s.on('playerMoved',p=>{if(p.id===s.id)position=p.player;});await ready;return{s,payload:await npcs,position:()=>position};}
 async function walk(c,target,state){const start=[Math.floor(c.position().x/32),Math.floor(c.position().y/32)],queue=[{p:start,path:[]}],seen=new Set([start.join(',')]),actor=rules.position(state);let path;
  for(let i=0;i<queue.length;i++){const {p,path:steps}=queue[i];if(p[0]===target.x&&p[1]===target.y){path=steps;break;}for(const [dx,dy,a]of [[0,1,'move_s'],[1,0,'move_d'],[0,-1,'move_z'],[-1,0,'move_q']]){const x=p[0]+dx,y=p[1]+dy,k=x+','+y;if(grid[y]?.[x]!==0||rules.occupies(actor,x,y)||seen.has(k))continue;seen.add(k);queue.push({p:[x,y],path:[...steps,{x,y,a}]});}}
  assert(path,'reachable approach');for(const p of path){const moved=event(c.s,'playerMoved',v=>v.id===c.s.id&&Math.floor(v.player.x/32)===p.x&&Math.floor(v.player.y/32)===p.y);c.s.emit('playerAction',p.a);await moved;await wait(135);}}
 try{
  server.listen(0,'127.0.0.1');await once(server,'listening');base='http://127.0.0.1:'+server.address().port;
  const u=await create(),other=await create();policy.isOwner=a=>a?.id===u.user.id&&a.username===u.user.username;
  let c=await connect(u),stranger=await connect(other),peer=await connect(u),state=await stored(u);const foreign=await stored(other);
  assert.equal(state.step,0);assert.deepEqual(c.payload.pnjs.find(n=>n.name==='raphael').x,rules.position(state).x);
  const denied=event(c.s,'interactionRejected');c.s.emit('onEndDialogue',rules.config.champion);assert.equal((await denied).reason,'invalid_or_expired_dialogue');
  for(let step=1;step<=4;step++){
   const point=rules.position(state);await walk(c,{x:point.x,y:point.y+1},state);
   const before={x:c.position().x,y:c.position().y};c.s.emit('playerAction','move_z');await wait(160);assert.deepEqual({x:c.position().x,y:c.position().y},before,'cannot walk through Raph');
   const moved=event(c.s,'pnjsList',p=>p.teleport?.step===step),peerMove=event(peer.s,'pnjsList',p=>p.teleport?.step===step);c.s.emit('Space');const snapshot=await moved;await peerMove;state=await stored(u);assert.equal(state.step,step);assert.deepEqual(snapshot.teleport.to,rules.position(state));
   c.s.emit('Space');c.s.emit('onEndDialogue',rules.config.champion);await wait(80);assert.equal((await stored(u)).step,step);assert.deepEqual(await stored(other),foreign,'another account keeps its own trail');
   if(step===2){c.s.disconnect();await wait(180);c=await connect(u);assert.deepEqual(await stored(u),state);assert.deepEqual(c.payload.pnjs.find(n=>n.name==='raphael').x,rules.position(state).x);}
   await wait(Math.max(0,state.availableAt-Date.now()+10));
  }
  await walk(c,{x:13,y:5},state);const speech=event(c.s,'dialogue');c.s.emit('Space');assert.equal((await speech)[1],rules.config.champion);c.s.disconnect();peer.s.disconnect();await wait(180);
  assert((await require('../server/persistence/progressionRepository').completeNpcBattle(u.user.id,rules.config.champion)).granted);
  c=await connect(u);assert.equal(c.payload.pnjs.find(n=>n.name==='raphael').y,4,'past winners skip the puzzle');
  const reset=event(c.s,'pnjsList',p=>p.pnjs.some(n=>n.name==='raphael'&&n.y!==4));assert((await new Promise(r=>c.s.emit('admin:rearmArenas',{},r))).success);await reset;assert.equal((await stored(u)).step,0);assert.deepEqual(await stored(other),foreign);
 }finally{for(const s of sockets)s.disconnect();await new Promise(r=>io.close(r));await wait(200);policy.isOwner=original;for(const id of ids)await db.execute('DELETE FROM users WHERE id=?',[id]);await db.end();}
});
