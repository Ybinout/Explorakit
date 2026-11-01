const test=require('node:test'),assert=require('node:assert/strict');
const {worldRoom,moveWorldRoom,sameWorld}=require('../server/realtime/worldRooms');
const {getPlayersInMap,arePlayersCloseEnough,toPublicPlayer}=require('../server/realtime/playerState');
const map='super_tournament_room',player=(id,room,extra={})=>({id,userId:id,x:448,y:496,currentmap:map,superTournamentActive:true,superTournamentRoom:room,...extra});
test('tower floor is absolute, server-owned and separate from ordinary shared maps',()=>{
 const a=player('a',0),b=player('b',0),c=player('c',16);assert(sameWorld(a,b));assert(!sameWorld(a,c));assert.equal(worldRoom(map,a),'adventure-map:super_tournament_room:floor:0');
 for(const currentmap of ['start','centre','super_tournament_lobby','super_tournament_sas'])assert(sameWorld({...a,currentmap},{...c,currentmap}));
 for(const floor of [undefined,null,-1,.5,NaN,Infinity,'0']){const x=player('x',floor),y=player('y',floor);assert(!sameWorld(x,y));assert(!sameWorld(a,x));}
 assert(!sameWorld(a,player('z',0,{superTournamentActive:false})));
});
test('snapshots and nearby interactions include only the same tower room; unknown context fails closed',()=>{
 const a=player('a',0),b=player('b',0),c=player('c',1),d=player('d',16),pending=player('pending',undefined),all={a,b,c,d,pending};
 assert.deepEqual(Object.keys(getPlayersInMap(all,map,a)),['a','b']);assert.deepEqual(Object.keys(getPlayersInMap(all,map,pending)),['pending']);assert.deepEqual(getPlayersInMap(all,map),{});
 assert(arePlayersCloseEnough(a,b));assert(!arePlayersCloseEnough(a,c));assert(!arePlayersCloseEnough(a,d));
 const publicPlayer=toPublicPlayer(a);assert(!('superTournamentRoom' in publicPlayer));assert(!('superTournamentActive' in publicPlayer));
});
test('changing floors on the same map leaves the old Socket.IO room without deleting unrelated memberships',async()=>{
 const p=player('owner',0),socket={data:{},rooms:new Set(['owner','other-feature']),async join(r){this.rooms.add(r);},async leave(r){this.rooms.delete(r);}};
 await moveWorldRoom(socket,null,map,p);const first=socket.data.worldRoom;assert(socket.rooms.has(first));p.superTournamentRoom=16;await moveWorldRoom(socket,map,map,p);assert(!socket.rooms.has(first));assert(socket.rooms.has(worldRoom(map,p)));assert(socket.rooms.has('owner'));assert(socket.rooms.has('other-feature'));
 const second=socket.data.worldRoom;p.superTournamentRoom=null;p.superTournamentActive=false;await moveWorldRoom(socket,map,'super_tournament_lobby',p);assert(!socket.rooms.has(second));assert(socket.rooms.has(worldRoom('super_tournament_lobby')));
});
test('committed progress publishes its room, failed progression restores it and leaving clears it',async()=>{
 const {TournamentController}=require('../server/game/superTournament/controller'),factory=require('../server/game/drift/pokemonFactory');let fail=false;const p=player('a',undefined),controller=new TournamentController({userId:1,getPlayer:()=>p,emit(){},travel:async()=>{},persist:{save:async(_id,_r,v)=>{if(fail)throw Error('storage');return v+1;}}});
 await controller.register({pokemons:[factory.create(9,100,true)]});assert.equal(p.superTournamentRoom,0);await controller.next();await controller.atomic(()=>{controller.run.phase='cleared';});fail=true;await assert.rejects(()=>controller.next(),/storage/);assert.equal(p.superTournamentRoom,0);fail=false;await controller.next();assert.equal(p.superTournamentRoom,1);await controller.abandon();assert.equal(p.superTournamentRoom,null);assert.equal(p.superTournamentActive,false);
});
test('speech destination is derived from the saved floor and ignores a forged room in the payload',()=>{
 const {registerWorldChatHandlers}=require('../server/realtime/handlers/worldChatHandlers'),handlers={},sent=[],p=player('a',16);
 registerWorldChatHandlers({socket:{id:'a',connected:true,on:(e,f)=>handlers[e]=f},io:{to:room=>({emit:(name,payload)=>sent.push({room,name,payload})})},getPlayer:()=>p});let reply;
 handlers['world:chat']({message:'Bonjour',room:0,map:'super_tournament_lobby'},r=>reply=r);assert(reply.success);assert.equal(sent[0].room,worldRoom(map,p));assert.equal(sent[0].payload.fromId,'a');
});
