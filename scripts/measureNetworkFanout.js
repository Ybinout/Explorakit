// Private synthetic traffic only: no SQL, account or production endpoint.
const fs=require('node:fs'),http=require('node:http'),{once}=require('node:events'),{performance}=require('node:perf_hooks');
const {Server}=require('socket.io'),{io:client}=require('../vue-explorakit/node_modules/socket.io-client');
const {toPublicPlayer}=require('../server/realtime/playerState'),{worldRoom}=require('../server/realtime/worldRooms');
(async()=>{const server=http.createServer(),io=new Server(server),sockets=[],report=[];io.on('connection',s=>{s.join(worldRoom('start'));s.emit('ready');});
 try{server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
  const encode=io.encoder.encode.bind(io.encoder);let encodes=0;io.encoder.encode=p=>{if(p.data?.[0]==='playerMoved')encodes++;return encode(p);};
  const player={id:'moving',userId:1,username:'test',x:80,y:208,currentmap:'start',sprite:'sprite.png',spritePalette:'blue',direction:'right',isMoving:true};
  for(const n of [16,64,128]){
   while(sockets.length<n){const s=client(base,{transports:['websocket'],autoConnect:false,forceNew:true,reconnection:false});sockets.push(s);const ready=once(s,'ready');s.connect();await ready;}
   const ids=sockets.map(s=>s.id),iterations=30;
   for(const mode of ['previous','map-room']){encodes=0;const samples=[];for(let i=0;i<iterations;i++){const t=performance.now();if(mode==='previous')for(const id of ids)io.to(id).emit('playerMoved',{id:player.id,player:toPublicPlayer(player)});else io.to(worldRoom('start')).emit('playerMoved',{id:player.id,player:toPublicPlayer(player)});samples.push(performance.now()-t);await new Promise(r=>setImmediate(r));}samples.sort((a,b)=>a-b);report.push({clients:n,mode,iterations,encodes,meanMs:samples.reduce((a,b)=>a+b)/iterations,p95Ms:samples[Math.floor(iterations*.95)]});}
  }
  const result={report,limits:'Synthetic local broadcast cost only; not full game/AI/SQL capacity, not a maximum-player guarantee. All reliable packets and recipient bytes retained.'};fs.writeFileSync('/tmp/riftmon-network-fanout.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{sockets.forEach(s=>s.disconnect());await new Promise(r=>io.close(r));}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
