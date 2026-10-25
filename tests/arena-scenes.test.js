const test=require('node:test'),assert=require('node:assert/strict');
const {scenes,entry}=require('../server/game/world/arenaScenes');
const {createPnjStore}=require('../server/game/world/pnjStore');
test('six personal entry scenes, entrance only, no repeated welcome after acknowledgment',()=>{
 assert.equal(scenes.length,6);
 for(const s of scenes){const p={currentmap:s.map,x:432,y:528};assert.equal(entry(p),s);assert.equal(entry(p,{[s.flag]:'true'}),null);assert.equal(entry({...p,y:176}),null);assert(s.sentences[0].text.length<180);}
 assert.equal(entry({currentmap:'start',y:528}),null);
});
test('champion footprint blocks both visually occupied columns, including in isolated expeditions',()=>{
 for(const store of [require('../server/game/world/pnjStore'),createPnjStore()])for(const s of scenes){
 const p=store.getPnjsForMap(s.map).find(p=>p.interactionName===s.champion);assert(p);assert.equal(p.blockingWidth,2);
 for(const x of [p.x,p.x+1])for(const y of [p.y,p.y-1]){assert(store.isPnjBlockingTile(s.map,x,y));assert.equal(store.getPnjAtTile(s.map,x,y).name,p.name);}
 assert(!store.isPnjBlockingTile(s.map,p.x,p.y+1));
 }
});
test('real socket: welcome waits for acknowledgment, persists individually and cannot authorize a battle',{skip:process.env.RUN_MYSQL_TESTS!=='1',timeout:30000},async()=>{
 assert.match(process.env.DB_NAME||'',/test/i);
 const http=require('node:http'),{once}=require('node:events'),{randomUUID}=require('node:crypto'),express=require('express'),{Server}=require('socket.io'),{io:client}=require('../vue-explorakit/node_modules/socket.io-client');
 const {dbPool:db}=require('../server/config/database'),app=express(),server=http.createServer(app),io=new Server(server);
 app.use(express.json());app.use('/api',require('../server/http/routes'));io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
 const ids=[],sockets=[],pause=ms=>new Promise(r=>setTimeout(r,ms));
 const event=(s,name)=>new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Missing '+name)),5000);s.once(name,p=>{clearTimeout(t);resolve(p);});});
 try{
 server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 const users=[];for(let i=0;i<2;i++){const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'scene_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(r.status,201);const u=await r.json();users.push(u);ids.push(u.user.id);}
 async function connect(u,scene,expect=true){await db.execute('UPDATE users SET map=?,x=432,y=528 WHERE id=?',[scene.map,u.user.id]);const s=client(base,{autoConnect:false,auth:{token:u.token},transports:['websocket'],reconnection:false});sockets.push(s);const speeches=[];s.on('dialogue',v=>speeches.push(v));const initial=event(s,'progressionState');const speech=expect?event(s,'dialogue'):null;s.connect();await initial;if(speech){const d=await speech;assert.equal(d[1],scene.name);assert.equal(d[2].entryMap,scene.map);}else await pause(150);return{s,speeches};}
 for(const scene of scenes){let {s}=await connect(users[0],scene);s.emit('onEndDialogue','champion_7p');await pause(40);let [flags]=await db.execute('SELECT flag_key FROM player_story_flags WHERE user_id=? AND flag_key=?',[ids[0],scene.flag]);assert.equal(flags.length,0);s.emit('onEndDialogue',scene.name);await pause(80);[flags]=await db.execute('SELECT flag_key FROM player_story_flags WHERE user_id=? AND flag_key=?',[ids[0],scene.flag]);assert.equal(flags.length,1);s.disconnect();await pause(80);const again=await connect(users[0],scene,false);assert.equal(again.speeches.length,0);again.s.disconnect();await pause(80);}
 const other=await connect(users[1],scenes[0]);other.s.disconnect();await pause(80);
 const retry=await connect(users[1],scenes[0]);assert.equal(retry.speeches.length,1,'unfinished welcome replayed after reconnect');retry.s.disconnect();
 }finally{for(const s of sockets)s.disconnect();await new Promise(r=>io.close(r));await pause(150);for(const id of ids)await db.execute('DELETE FROM users WHERE id=?',[id]);await db.end();}
});
