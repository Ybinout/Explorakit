const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {once}=require('node:events'),{Server}=require('socket.io'),{io:client}=require('../vue-explorakit/node_modules/socket.io-client');
const {worldRoom,moveWorldRoom}=require('../server/realtime/worldRooms');
const {createLobbyStore}=require('../server/game/drift/lobbyStore'),{registerDriftLobbies}=require('../server/realtime/driftLobbyHandler');
const {signAccessToken}=require('../server/config/auth');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
test('map room delivery encodes once, excludes other maps and namespaces, and leaves no stale membership',async()=>{
 const server=http.createServer(),io=new Server(server),sockets=[],received=[[],[],[],[]];
 io.on('connection',async s=>{await moveWorldRoom(s,null,s.handshake.auth.map);s.on('moveMap',async(map,reply)=>{await moveWorldRoom(s,s.data.map,map);s.data.map=map;reply();});s.data.map=s.handshake.auth.map;s.emit('ready');});
 io.of('/drift').on('connection',async s=>{await s.join(worldRoom('start'));s.emit('ready');});
 try{server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
  for(const [i,map]of ['start','start','route1','start'].entries()){const s=client(base+(i===3?'/drift':''),{autoConnect:false,forceNew:true,transports:['websocket'],auth:{map},reconnection:false});sockets.push(s);s.on('probe',v=>received[i].push(v));const ready=once(s,'ready');s.connect();await ready;}
  let encodes=0;const encode=io.encoder.encode.bind(io.encoder);io.encoder.encode=p=>{if(p.data?.[0]==='probe')encodes++;return encode(p);};
  io.to(worldRoom('start')).emit('probe',1);await wait(30);assert.deepEqual(received,[[1],[1],[],[]]);assert.equal(encodes,1);
  await new Promise(r=>sockets[1].emit('moveMap','route1',r));io.to(worldRoom('start')).emit('probe',2);io.to(worldRoom('route1')).emit('probe',3);await wait(30);assert.deepEqual(received,[[1,2],[1,3],[3],[]]);assert.equal(encodes,3);
  const oldId=sockets[1].id;sockets[1].disconnect();await wait(30);assert(!io.sockets.adapter.rooms.get(worldRoom('route1')).has(oldId));
 }finally{sockets.forEach(s=>s.disconnect());await new Promise(r=>io.close(r));}
});
test('unchanged lobby publications are suppressed but changes and newly connected viewers get full current state',async()=>{
 let listCalls=0;const store=createLobbyStore(),baseList=store.listOpen;store.listOpen=u=>{listCalls++;return baseList(u);};
 const ns={sockets:new Map(),use(){},on(){},to(){return{emit(){}};}},io={of:()=>ns};
 const a={id:1,username:'a'},b={id:2,username:'b'},events=[[],[]];store.connect(a,'a');store.connect(b,'b');
 ns.sockets.set('a',{data:{user:a},emit:(e,d)=>events[0].push([e,d])});ns.sockets.set('b',{data:{user:b},emit:(e,d)=>events[1].push([e,d])});
 const cleanup=registerDriftLobbies(io,{store,sweepMs:20});try{
  await wait(75);for(const e of events)assert.deepEqual(e.map(([n])=>n),['drift:lobby','drift:lobbies']);assert(listCalls<=5,'one public-list build per sweep, not per socket');
  store.create(a,{capacity:2,durationMinutes:30,visibility:'public'});await wait(35);assert(events[0].some(([n,d])=>n==='drift:lobby'&&d?.code));assert(events[1].some(([n,d])=>n==='drift:lobbies'&&d.length===1));
  const fresh=[];ns.sockets.set('c',{data:{user:{id:3}},emit:(e,d)=>fresh.push([e,d])});await wait(35);assert.equal(fresh.length,2);assert.equal(fresh.find(([n])=>n==='drift:lobbies')[1].length,1);
 }finally{cleanup();}
});
test('installed client options connect when WebSocket is unavailable, then reconnect without replaying an action',async()=>{
 const fs=require('node:fs'),source=fs.readFileSync(require.resolve('../vue-explorakit/src/services/realtime.js'),'utf8').replace("import { io } from 'socket.io-client';",'').replace(/export /g,'');
 const server=http.createServer(),io=new Server(server,{transports:['polling']}),sockets=[];let actions=0;
 io.on('connection',s=>{s.on('action',()=>actions++);s.emit('ready');});
 try{server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;
  const create=new Function('io','window','process',source+'\nreturn createGameSocket;')(client,{location:{origin}},{env:{BASE_URL:'/'}});
  const s=create(signAccessToken({id:1,username:'net'}));sockets.push(s);s.io.reconnection(false);await once(s,'ready');assert.equal(s.io.engine.transport.name,'polling');s.emit('action');await wait(30);assert.equal(actions,1);
  s.disconnect();const ready=once(s,'ready');s.connect();await ready;assert.equal(s.sendBuffer.length,0);await wait(30);assert.equal(actions,1);
 }finally{sockets.forEach(s=>s.disconnect());await new Promise(r=>io.close(r));}
});
