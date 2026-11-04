const test=require('node:test'),assert=require('node:assert/strict');
const {createSocialHub,AFK_MS}=require('../server/realtime/socialHub');
function fixture(){
 let clock=1000,queries=0;const relations=new Set(),sockets=new Map(),locations=new Map();
 const key=(a,b)=>[a,b].sort((x,y)=>x-y).join(':'),friend=(a,b)=>relations.add(key(a,b));
 const repository={async relationship(a,b){return relations.has(key(a,b))?'friends':'none';},async friends(id){queries++;return{accepted:[...relations].flatMap(k=>{const[a,b]=k.split(':').map(Number);return a===id?[b]:b===id?[a]:[];}).map(id=>({id,username:'Dresseur '+id,relationship:'friends'})),incoming:[{id:99,username:'En attente'}],outgoing:[]};}};
 const messageRepository={async unread(){queries++;return{};}};
 const hub=createSocialHub({now:()=>clock,repository,messageRepository,tickMs:0});
 async function connect(id,map='route1',mode='adventure'){
  const once=new Map(),events=[];const socket={connected:true,data:{user:{id,username:'Dresseur '+id}},once:(e,fn)=>once.set(e,fn),emit:(e,p)=>events.push({e,p}),disconnect(){this.connected=false;once.get('disconnect')?.();}};
  locations.set(id,{map,mode,x:1234,y:6789,privateInstance:'secret'});sockets.set(id,{socket,events});await hub.attach(socket,()=>locations.get(id));return socket;
 }
 return{hub,friend,relations,key,connect,sockets,locations,advance(ms){clock+=ms;hub.tick();},queries:()=>queries};
}
test('accepted friends share current region without groups; pending contacts and directory receive no location or coordinates',async()=>{
 const f=fixture();try{f.friend(1,2);await f.connect(1);await f.connect(2);await f.connect(99);
 assert.deepEqual(f.hub.state(1).accepted[0].location,{nodeId:'route1',mode:'adventure'});
 assert(!('location' in f.hub.state(1).incoming[0]));assert(!('group' in f.hub.state(1)));assert(!('groupInvites' in f.hub.state(1)));assert.equal(f.hub.invite,undefined);
 f.locations.set(2,{map:'route2',mode:'adventure'});f.hub.tick();assert.equal(f.hub.state(1).accepted[0].location.nodeId,'route2');
 for(const p of f.hub.onlineDirectory(1).entries)for(const key of ['x','y','location','privateInstance'])assert(!Object.hasOwn(p,key));
 const before=f.queries(),events=f.sockets.get(1).events.length;f.hub.tick();f.hub.tick();assert.equal(f.queries(),before);assert.equal(f.sockets.get(1).events.length,events);
 }finally{f.hub.stop();}
});
test('AFK exactly after five minutes, activity immediately restores presence without SQL; silent clients never keep themselves online',async()=>{
 const f=fixture();try{f.friend(1,2);await f.connect(1);const b=await f.connect(2);const before=f.queries();
 f.advance(AFK_MS-1);assert.equal(f.hub.state(1).accepted[0].afk,false);f.advance(1);assert.equal(f.hub.state(1).accepted[0].afk,true);assert.equal(f.hub.presence(2).status,'afk');
 const afkEvents=f.sockets.get(1).events.length;f.advance(30000);assert.equal(f.sockets.get(1).events.length,afkEvents,'no second-by-second timestamp emissions');
 f.hub.activity(b);assert.equal(f.hub.state(1).accepted[0].afk,false);assert.equal(f.hub.presence(2).connectedSince,1000);assert.equal(f.queries(),before);
 f.advance(AFK_MS);assert(f.hub.presence(2).afk);const old=b;await f.connect(2);f.advance(AFK_MS);f.hub.activity(old);assert(f.hub.presence(2).afk,'retired connection cannot change presence');assert.equal(f.hub.presence(2).connectedSince,631000);
 }finally{f.hub.stop();}
});
test('disconnect clears position/session; reconnect has a new duration and an old disconnect cannot retire it',async()=>{
 const f=fixture();try{f.friend(1,2);await f.connect(1);const old=await f.connect(2);old.disconnect();assert.deepEqual(f.hub.state(1).accepted[0].location,null);assert.equal(f.hub.presence(2).connectedSince,null);assert.equal(f.hub.presence(2).status,'offline');
 f.advance(5000);await f.connect(2,'ville1');assert.equal(f.hub.presence(2).connectedSince,6000);old.disconnect();assert(f.hub.presence(2).online);assert.equal(f.hub.state(1).accepted[0].location.nodeId,'ville1');
 f.relations.delete(f.key(1,2));await f.hub.friendsChanged(1,2);assert.equal(f.hub.state(1).accepted.length,0);assert.equal(f.hub.state(2).accepted.length,0);
 }finally{f.hub.stop();}
});
test('online count stays anonymous and unique per account even across namespace/session replacements',async()=>{
 const f=fixture(),counts=id=>f.sockets.get(id).events.filter(e=>e.e==='presence:count');try{
 const old=await f.connect(1);await f.connect(2,'route14','colosseum');assert.deepEqual(counts(1).at(-1).p,{count:2});await f.connect(1,'route4','rift');old.disconnect();assert.deepEqual(counts(2).at(-1).p,{count:2});
 f.sockets.get(2).socket.disconnect();assert.deepEqual(counts(1).at(-1).p,{count:1});const q=f.queries(),n=counts(1).length;f.hub.tick();assert.equal(f.queries(),q);assert.equal(counts(1).length,n);
 }finally{f.hub.stop();}
});
test('anonymous count is available even if the social database is unavailable',async()=>{
 const events=[],socket={connected:true,data:{user:{id:1,username:'Test'}},once(){},emit(e,p){events.push({e,p});}};const hub=createSocialHub({tickMs:0,repository:{async friends(){throw Error('Database unavailable');}}});
 try{await assert.rejects(hub.attach(socket,()=>null),/Database unavailable/);assert.deepEqual(events.find(e=>e.e==='presence:count').p,{count:1});}finally{hub.stop();}
});
test('directory is paginated, copied, bounded and current with AFK/session metadata and no extra SQL on ticks',async()=>{
 const f=fixture();try{for(let id=1;id<=25;id++)await f.connect(id);const before=f.queries(),a=f.hub.onlineDirectory(1),b=f.hub.onlineDirectory(1,20);assert.equal(a.total,24);assert.equal(a.entries.length,20);assert.equal(b.entries.length,4);assert(a.hasMore&&!b.hasMore);assert.equal(new Set([...a.entries,...b.entries].map(p=>p.id)).size,24);assert(!a.entries.some(p=>p.id===1));assert(a.entries.every(p=>p.status==='online'&&p.connectedSince===1000));a.entries[0].username='changed';assert(!f.hub.onlineDirectory(1).entries.some(p=>p.username==='changed'));
 for(const offset of[-1,1.2,'20',10001,Infinity])assert.throws(()=>f.hub.onlineDirectory(1,offset));f.hub.tick();assert.equal(f.queries(),before);f.advance(AFK_MS);assert(f.hub.onlineDirectory(1).entries.every(p=>p.afk));assert.equal(f.queries(),before);
 }finally{f.hub.stop();}
});
