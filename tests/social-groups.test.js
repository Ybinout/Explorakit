const test=require('node:test'),assert=require('node:assert/strict');
const {createSocialHub,INVITE_MS,RECONNECT_MS}=require('../server/realtime/socialHub');
function fixture(){
 let clock=1000,queries=0;const relations=new Set(),sockets=new Map(),locations=new Map();
 const key=(a,b)=>[a,b].sort((x,y)=>x-y).join(':'),friend=(a,b)=>relations.add(key(a,b));
 const repository={async relationship(a,b){return relations.has(key(a,b))?'friends':'none';},async friends(id){queries++;return{accepted:[...relations].flatMap(k=>{const[a,b]=k.split(':').map(Number);return a===id?[b]:b===id?[a]:[];}).map(id=>({id,username:'Dresseur '+id,relationship:'friends'})),incoming:[],outgoing:[]};}};
 const messageRepository={async unread(){queries++;return{};},messageText:require('../server/persistence/socialMessageRepository').messageText};
 const hub=createSocialHub({now:()=>clock,repository,messageRepository,tickMs:0});
 async function connect(id,map='route1',mode='adventure'){
  const once=new Map(),events=[];const socket={connected:true,data:{user:{id,username:'Dresseur '+id}},once:(e,fn)=>once.set(e,fn),emit:(e,p)=>events.push({e,p}),disconnect(){this.connected=false;once.get('disconnect')?.();}};
  locations.set(id,{map,mode});sockets.set(id,{socket,events});await hub.attach(socket,()=>locations.get(id));return socket;
 }
 async function join(a,b){await hub.invite(a,b);const invitation=hub.state(b).groupInvites[0];await hub.answerInvite(b,invitation.id,true);return hub.state(a).group;}
 return{hub,friend,relations,key,connect,join,sockets,locations,advance(ms){clock+=ms;hub.tick();},queries:()=>queries};
}
test('presence is limited to accepted contacts; location requires a separately accepted group invitation',async()=>{
 const f=fixture();try{f.friend(1,2);await f.connect(1);await f.connect(2);await f.connect(3);
 assert.equal(f.hub.state(1).accepted.length,1);assert.equal(f.hub.state(1).accepted[0].online,true);assert(!('location' in f.hub.state(1).accepted[0]));assert.equal(f.hub.state(3).accepted.length,0);
 await assert.rejects(f.hub.invite(1,3),/ami/);await f.hub.invite(1,2);assert.equal(f.hub.state(2).group,null);
 const invite=f.hub.state(2).groupInvites[0];await assert.rejects(f.hub.answerInvite(3,invite.id,true),/expiré/);
 await f.hub.answerInvite(2,invite.id,true);assert.equal(f.hub.state(1).group.members[1].location.nodeId,'route1');assert.equal(f.hub.state(3).group,null);
 const count=f.queries(),events=f.sockets.get(1).events.length;f.hub.tick();f.hub.tick();assert.equal(f.queries(),count);assert.equal(f.sockets.get(1).events.length,events,'no recurring publication without a visible change');
 }finally{f.hub.stop();}
});
test('leader-only invitations, six-person capacity and refusal never silently join or replace another group',async()=>{
 const f=fixture();try{for(let id=2;id<=8;id++){f.friend(1,id);await f.connect(id);}await f.connect(1);
 for(let id=2;id<=7;id++)await f.hub.invite(1,id);
 for(let id=2;id<=6;id++)await f.hub.answerInvite(id,f.hub.state(id).groupInvites[0].id,true);
 assert.equal(f.hub.state(1).group.members.length,6);await assert.rejects(f.hub.answerInvite(7,f.hub.state(7).groupInvites[0].id,true),/complet/);
 f.friend(2,8);await assert.rejects(f.hub.invite(2,8),/chef/);assert.throws(()=>f.hub.kick(2,1),/retirer/);
 f.hub.kick(1,6);assert.equal(f.hub.state(6).group,null);assert.equal(f.hub.state(1).group.members.length,5);
 await f.hub.invite(1,8);await f.hub.answerInvite(8,f.hub.state(8).groupInvites[0].id,false);assert.equal(f.hub.state(8).group,null);
 }finally{f.hub.stop();}
});
test('expiration, departing leader and removed friendship invalidate old invitations and location sharing',async()=>{
 const f=fixture();try{for(const id of[1,2,3])await f.connect(id);f.friend(1,2);f.friend(1,3);
 await f.hub.invite(1,2);const old=f.hub.state(2).groupInvites[0].id;f.advance(INVITE_MS);await assert.rejects(f.hub.answerInvite(2,old,true),/expiré/);
 await f.join(1,2);await f.hub.invite(1,3);f.hub.leave(1);assert.equal(f.hub.state(2).group.leaderId,2);assert.equal(f.hub.state(3).groupInvites.length,0);
 f.hub.leave(2);await f.join(1,2);f.relations.delete(f.key(1,2));await f.hub.friendsChanged(1,2);assert.equal(f.hub.state(2).group,null);assert.equal(f.hub.state(1).accepted.length,1);
 }finally{f.hub.stop();}
});
test('offline members reveal no position; reconnection preserves membership briefly, then departure transfers leadership',async()=>{
 const f=fixture();try{f.friend(1,2);await f.connect(1);const second=await f.connect(2);await f.join(1,2);
 second.disconnect();assert.deepEqual(f.hub.state(1).group.members[1],{id:2,username:'Dresseur 2',online:false,location:null});
 await f.connect(2,'route2','rift');assert.equal(f.hub.state(1).group.members[1].location.mode,'rift');
 f.locations.set(2,{map:'ville1',mode:'rift'});f.hub.tick();assert.equal(f.hub.state(1).group.members[1].location.nodeId,'ville1');
 f.sockets.get(1).socket.disconnect();f.advance(RECONNECT_MS);assert.equal(f.hub.state(2).group.leaderId,2);assert.equal(f.hub.state(2).group.members.length,1);
 }finally{f.hub.stop();}
});
test('group chat is member-only, bounded and plain text; leaving removes access immediately',async()=>{
 const f=fixture();try{f.friend(1,2);await f.connect(1);await f.connect(2);await f.join(1,2);
 assert.throws(()=>f.hub.groupMessage(3,'Hello'),/groupe/);for(const value of['',' '.repeat(20),'a'.repeat(501),'bad\u0000'])assert.throws(()=>f.hub.groupMessage(1,value));
 const literal='<img src=x onerror=alert(1)> & é';assert.equal(f.hub.groupMessage(1,literal).text,literal);
 for(let i=0;i<110;i++)f.hub.groupMessage(1,'Message '+i);assert.equal(f.hub.state(2).group.messages.length,100);
 f.hub.leave(2);assert.throws(()=>f.hub.groupMessage(2,'Bye'),/groupe/);
 }finally{f.hub.stop();}
});
