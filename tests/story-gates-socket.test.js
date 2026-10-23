const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {spawn}=require('node:child_process'),{once}=require('node:events'),{randomUUID}=require('node:crypto');
const enabled=process.env.RUN_MYSQL_TESTS==='1';
function event(socket,name,predicate=()=>true){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{socket.off(name,handler);reject(Error('Missing '+name));},7000);const handler=p=>{if(!predicate(p))return;clearTimeout(timer);socket.off(name,handler);resolve(p);};socket.on(name,handler);});}
test('real Adventure sockets: Wayne, Aspha and Gwenn deny passage before movement, unlock by persisted victory and survive reconnect', {skip:!enabled,timeout:40000},async()=>{
 assert.match(process.env.DB_NAME||'',/test/i);
 const {dbPool:db}=require('../server/config/database'),{io}=require('../vue-explorakit/node_modules/socket.io-client');
 const port=31249,base=`http://127.0.0.1:${port}`;
 const child=spawn(process.execPath,['server/index.js'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,PORT:String(port),NODE_ENV:'test',JWT_SECRET:'story-gate-test-only',BATTLE_DELAY_SCALE:'0'},stdio:['ignore','ignore','pipe']});
 const ids=[];let socket,fixture,errors='';child.stderr.on('data',b=>errors+=b);
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 async function at(map,x,y){
  if(socket){await new Promise((resolve,reject)=>socket.timeout(5000).emit('requestGameSave',(e,r)=>e||!r.success?reject(e||Error('save')):resolve()));socket.disconnect();await pause(70);}
  await db.execute('UPDATE users SET map=?,x=?,y=?,repel_steps=100 WHERE id=?',[map,x*32+16,y*32+16,fixture.user.id]);
  socket=io(base,{autoConnect:false,auth:{token:fixture.token},transports:['websocket'],reconnection:false});
  const state=event(socket,'storyGatesState');socket.connect();return state;
 }
 async function blocked(action,id){const denied=event(socket,'storyGateBlocked',p=>p.id===id);socket.emit('playerAction',action);await denied;}
 async function move(action,x,y){await pause(370);const moved=event(socket,'playerMoved',p=>p.id===socket.id&&p.player.x===x*32+16&&p.player.y===y*32+16);socket.emit('playerAction',action);await moved;}
 async function savePosition(){await new Promise((r,j)=>socket.timeout(5000).emit('requestGameSave',(e,v)=>e||!v.success?j(e||Error('save')):r()));return (await db.execute('SELECT map,x,y,repel_steps,money FROM users WHERE id=?',[fixture.user.id]))[0][0];}
 try{
  for(let n=0;n<60;n++){try{if((await fetch(base)).ok)break;}catch{}await pause(100);if(n===59)throw Error(errors);}
  const response=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'gate_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(response.status,201);fixture=await response.json();ids.push(fixture.user.id);
  const first=await at('start',19,3);assert(first.gates.every(g=>g.locked));const before=await savePosition();
  socket.emit('progressionState',{flags:{route_guard_defeated:'true'}});socket.emit('storyGatesState',{gates:[]});
  await blocked('move_z','wayne_route1');for(let n=0;n<20;n++)socket.emit('playerAction','move_z');await pause(400);
  assert.deepEqual(await savePosition(),before,'blocked step neither saves movement nor consumes repel/money');
  await at('start',19,1);await blocked('move_z','wayne_route1');assert.equal((await savePosition()).y,48,'old save beyond rope cannot exit');
  await move('move_s',19,2);await move('move_s',19,3);
  await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,'route_guard_defeated','true')",[fixture.user.id]);
  await move('move_z',19,2);const connected=await at('start',19,3);assert(!connected.gates.find(g=>g.id==='wayne_route1').locked);
  await at('route2',25,6);const beforeAspha=await savePosition();await blocked('move_d','aspha_lake');assert.deepEqual(await savePosition(),beforeAspha);
  await at('route2',26,6);await move('move_q',25,6);
  await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,'aspha_route2_defeated','true')",[fixture.user.id]);
  await move('move_d',26,6);await pause(370);const changed=event(socket,'newmap');socket.emit('playerAction','move_d');await changed;
  const saved=await savePosition();assert.equal(saved.map,'ville1');
  await db.execute("DELETE FROM player_story_flags WHERE user_id=? AND flag_key IN ('route_guard_defeated','aspha_route2_defeated')",[fixture.user.id]);
  await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,'moonpunch_defeated','true')",[fixture.user.id]);
  const legacy=await at('route2',25,6);assert(legacy.gates.filter(g=>g.id!=='gwenn_ocreville').every(g=>!g.locked));await move('move_d',26,6);
  await at('gen_route8',22,17);const beforeGwenn=await savePosition();await blocked('move_s','gwenn_ocreville');assert.deepEqual(await savePosition(),beforeGwenn);
  await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,'hoze_defeated','true')",[fixture.user.id]);
  await at('gen_route8',22,17);await blocked('move_s','gwenn_ocreville');
  await at('gen_route8',22,18);await blocked('move_s','gwenn_ocreville');
  await move('move_z',22,17);
  assert((await require('../server/persistence/progressionRepository').completeNpcBattle(fixture.user.id,'gwenn_route8')).granted);
  await move('move_s',22,18);await pause(370);const city=event(socket,'newmap');socket.emit('playerAction','move_s');await city;
  assert.equal((await savePosition()).map,'gen_ville5');
  const restored=await at('gen_route8',22,17);assert(!restored.gates.find(g=>g.id==='gwenn_ocreville').locked);await move('move_s',22,18);
 }finally{
  socket?.disconnect();if(child.exitCode===null){const stopped=once(child,'exit');child.kill('SIGTERM');await stopped;}
  for(const id of ids)await db.execute('DELETE FROM users WHERE id=?',[id]);await db.end();
 }
});
