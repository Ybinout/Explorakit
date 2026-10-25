const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),{once}=require('node:events');
const {Server}=require('socket.io'),{io:client}=require('../vue-explorakit/node_modules/socket.io-client');
const {signAccessToken}=require('../server/config/auth'),{registerDriftLobbies}=require('../server/realtime/driftLobbyHandler');
const {createLobbyStore}=require('../server/game/drift/lobbyStore'),terrain=require('../server/game/world/mapRepository');
function command(socket,name,payload={}){return new Promise((r,j)=>socket.timeout(4000).emit(name,payload,(e,v)=>e?j(e):r(v)));}
function event(socket,name,predicate=()=>true){return new Promise((r,j)=>{const timer=setTimeout(()=>{socket.off(name,listener);j(Error('Missing '+name));},4000);const listener=v=>{if(predicate(v)){clearTimeout(timer);socket.off(name,listener);r(v);}};socket.on(name,listener);});}
test('opt-in movement patches retain repel state, old clients retain full updates and map transitions refresh the whole state',{timeout:15000},async()=>{
 let clock=100000;const store=createLobbyStore({now:()=>clock}),server=http.createServer(),io=new Server(server);
 const cleanup=registerDriftLobbies(io,{store,sweepMs:60000,appearanceRepository:{async loadUserSprite(){return 'sprite.png';}},runtimeOptions:{starterChoiceMs:0,now:()=>clock,random:()=>.99}});
 const sockets=[];try{
  server.listen(0,'127.0.0.1');await once(server,'listening');const url='http://127.0.0.1:'+server.address().port+'/drift';
  for(const id of [41,42]){const s=client(url,{auth:{token:signAccessToken({id,username:'perf_'+id})},transports:['websocket'],autoConnect:false,reconnection:false,forceNew:true});sockets.push(s);const ready=event(s,'drift:bootstrap');s.connect();await ready;}
  const [legacy,modern]=sockets;const created=await command(legacy,'drift:create',{capacity:2,durationMinutes:30});assert(created.ok);
  await command(modern,'drift:join',{code:created.lobby.code});for(const s of sockets)await command(s,'drift:ready',{ready:true});assert((await command(legacy,'drift:start')).ok);
  assert((await command(legacy,'drift:enter')).success);assert((await command(modern,'drift:enter',{movementPatches:1})).success);
  cleanup.runtime.tick();const p=cleanup.runtime.playerFor({id:42}),q=cleanup.runtime.playerFor({id:41});
  const changes=terrain.changeMapData('start'),col=terrain.loadCollisionData('start');let spot;
  for(let y=1;y<19&&!spot;y++)for(let x=1;x<26;x++)if(col[y][x]===0&&col[y][x+1]===0&&!changes[y][x]&&!changes[y][x+1]&&!terrain.battleMapData('start')[y][x+1]&&!p.run.pnjs.isPnjBlockingTile('start',x+1,y)){spot={x:x*32+16,y:y*32+16};break;}
  assert(spot);Object.assign(p,spot,{repelSteps:9});Object.assign(q,spot);
  const patch=event(modern,'drift:movementState');const moved=event(modern,'playerMoved',v=>v.id===modern.id);clock+=150;
  assert((await command(modern,'playerAction','move_d')).success);const result=await patch;await moved;
  assert.equal(result.repelSteps,8);assert.equal(result.id,p.run.id);assert(!Object.hasOwn(result,'team'));assert(p.x>spot.x);
  const full=event(legacy,'drift:state');clock+=150;await command(legacy,'playerAction','move_d');assert.equal((await full).team.length,1);
  const world=require('../data/game/nextMap.json').maps,city=world.find(m=>m.mapchange.some(d=>d.goto==='centre'&&Number.isInteger(d.valX)&&Number.isInteger(d.valY)));
  const door=city.mapchange.find(d=>d.goto==='centre'&&Number.isInteger(d.valX)&&Number.isInteger(d.valY));Object.assign(p,{currentmap:city.mapName,x:door.valX*32+16,y:(door.valY+1)*32+16});clock+=150;
  const map=event(modern,'newmap',v=>v.mapname==='centre'),refresh=event(modern,'drift:state');await command(modern,'playerAction','move_z');await map;assert.equal((await refresh).id,p.run.id);assert.equal(p.currentmap,'centre');
 }finally{sockets.forEach(s=>s.disconnect());cleanup();await new Promise(r=>io.close(r));}
});
