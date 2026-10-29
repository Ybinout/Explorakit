const {randomUUID}=require('node:crypto');
const trainers=require('../persistence/trainerRepository');
const messages=require('../persistence/socialMessageRepository');
const {regionLocation}=require('../game/world/regionMap');
const hubs=new WeakMap(),instances=new Set();
const fail=message=>{throw Object.assign(Error(message),{statusCode:400});};
const GROUP_LIMIT=6,INVITE_MS=90000,RECONNECT_MS=120000;
function createSocialHub({now=Date.now,repository=trainers,messageRepository=messages,tickMs=1000,onFriendshipChanged=()=>{}}={}){
 const sessions=new Map(),groups=new Map(),membership=new Map(),invitations=new Map(),inboxQueues=new Map();
 let stopped=false;
 const online=id=>!!sessions.get(id)?.socket.connected;
 const emit=(id,event,payload)=>{const s=sessions.get(id);if(s?.socket.connected)s.socket.emit(event,payload);};
 function memberView(member){
  const s=sessions.get(member.id);let location=null;
  if(s?.socket.connected){const p=s.getLocation?.();if(p?.map){const nodeId=regionLocation(p.map,p.centerReturnPoint);if(nodeId)location={nodeId,mode:p.mode||'adventure'};}}
  return{id:member.id,username:member.username,online:online(member.id),location};
 }
 function groupFor(id){return groups.get(membership.get(id));}
 function groupView(id){const g=groupFor(id);return g?{id:g.id,leaderId:g.leaderId,limit:GROUP_LIMIT,members:[...g.members.values()].map(memberView),messages:g.messages}:null;}
 function state(id){
  const s=sessions.get(id),contacts=s?.contacts||{accepted:[],incoming:[],outgoing:[]};
  const enrich=p=>({...p,online:online(p.id),unread:s?.unread[p.id]||0});
  return{accepted:contacts.accepted.map(enrich),incoming:contacts.incoming.map(enrich),outgoing:contacts.outgoing.map(enrich),group:groupView(id),groupInvites:[...invitations.values()].filter(i=>i.to===id&&i.expiresAt>now()).map(i=>({id:i.id,fromId:i.from,fromName:i.fromName,expiresAt:i.expiresAt}))};
 }
 // Only presence/region/invitation changes are inspected each second, without SQL.
 function signature(id){const s=sessions.get(id);if(!s)return '';const g=groupFor(id);return JSON.stringify({friends:s.contacts.accepted.map(p=>[p.id,online(p.id)]),group:g?{id:g.id,leaderId:g.leaderId,members:[...g.members.values()].map(memberView),lastMessage:g.messages.at(-1)?.id}:null,invites:[...invitations.values()].filter(i=>i.to===id).map(i=>i.id)});}
 function publish(id,force=false){const s=sessions.get(id);if(!s?.socket.connected)return;const key=signature(id);if(force||s.signature!==key){s.signature=key;emit(id,'social:state',state(id));}}
 function publishPresence(){
  const connected=[...sessions.values()].filter(s=>s.socket.connected),count=connected.length;
  for(const s of connected)if(s.onlineCount!==count){s.onlineCount=count;s.socket.emit('presence:count',{count});}
 }
 function publishAll(){publishPresence();for(const id of sessions.keys())publish(id);}
 async function refreshUnread(id){
  const previous=inboxQueues.get(id)||Promise.resolve();
  const task=previous.catch(()=>{}).then(async()=>{const s=sessions.get(id);if(!s)return;const counts=await messageRepository.unread(id);if(sessions.get(id)===s){s.unread=counts;publish(id,true);}});
  inboxQueues.set(id,task);try{await task;}finally{if(inboxQueues.get(id)===task)inboxQueues.delete(id);}
 }
 async function reload(id){const s=sessions.get(id);if(!s)return;const version=s.contactVersion=(s.contactVersion||0)+1;const contacts=await repository.friends(id);if(sessions.get(id)!==s||s.contactVersion!==version)return;s.contacts=contacts;await refreshUnread(id);publish(id,true);}
 async function friendsChanged(a,b){
  for(const[k,i]of invitations)if(i.from===a&&i.to===b||i.from===b&&i.to===a)invitations.delete(k);
  const relationship=await repository.relationship(a,b);
  if(relationship!=='friends')onFriendshipChanged(a,b);
  if(relationship!=='friends'&&membership.get(a)&&membership.get(a)===membership.get(b)){
   const g=groupFor(a);removeMember(g.leaderId===a?b:a);
  }
  await Promise.all([reload(a),reload(b)]);publishAll();
 }
 function removeMember(id){
  const g=groupFor(id);if(!g)return;g.members.delete(id);membership.delete(id);
  if(!g.members.size)groups.delete(g.id);else if(g.leaderId===id)g.leaderId=g.members.keys().next().value;
  for(const[key,i]of invitations)if(i.from===id||i.to===id||i.groupId===g.id&&(i.from!==g.leaderId||!g.members.size))invitations.delete(key);
  publishAll();
 }
 async function invite(from,to){
  to=messages.userId(to);if(from===to)fail('Choisis un autre dresseur.');
  const relation=await repository.relationship(from,to);if(relation!=='friends')fail('Ajoute ce dresseur en ami avant de l’inviter.');
  if(!online(from)||!online(to))fail('Ce dresseur doit être connecté pour recevoir une invitation.');
  if(membership.has(to))fail('Ce dresseur fait déjà partie d’un groupe.');
  let g=groupFor(from);if(g&&g.leaderId!==from)fail('Seul le chef du groupe peut inviter un ami.');
  if(g?.members.size>=GROUP_LIMIT)fail('Le groupe compte déjà six dresseurs.');
  if(!g){const s=sessions.get(from);g={id:randomUUID(),leaderId:from,members:new Map([[from,{id:from,username:s.username}]]),messages:[]};groups.set(g.id,g);membership.set(from,g.id);}
  if([...invitations.values()].filter(i=>i.groupId===g.id).length>=12)fail('Trop d’invitations sont déjà en attente.');
  let invitation=[...invitations.values()].find(i=>i.from===from&&i.to===to&&i.groupId===g.id);
  if(!invitation){invitation={id:randomUUID(),groupId:g.id,from,to,fromName:sessions.get(from).username,expiresAt:now()+INVITE_MS};invitations.set(invitation.id,invitation);}
  publishAll();return state(from);
 }
 async function answerInvite(id,inviteId,accept){
  const i=invitations.get(inviteId);if(!i||i.to!==id||i.expiresAt<=now())fail('Cette invitation a expiré.');
  if(typeof accept!=='boolean')fail('Réponse invalide.');
  if(!accept){invitations.delete(inviteId);publish(id,true);return state(id);}
  const relation=await repository.relationship(id,i.from),g=groups.get(i.groupId);
  if(invitations.get(inviteId)!==i||i.expiresAt<=now()||!g||g.leaderId!==i.from||relation!=='friends')fail('Cette invitation n’est plus disponible.');
  if(!online(id)||!online(i.from))fail('Le chef du groupe doit être connecté.');
  if(membership.has(id))fail('Quitte ton groupe actuel avant d’en rejoindre un autre.');
  if(g.members.size>=GROUP_LIMIT)fail('Le groupe est complet.');
  g.members.set(id,{id,username:sessions.get(id).username});membership.set(id,g.id);
  for(const[key,inv]of invitations)if(inv.to===id)invitations.delete(key);
  publishAll();return state(id);
 }
 function leave(id){removeMember(id);return state(id);}
 function kick(id,target){target=messages.userId(target);const g=groupFor(id);if(!g||g.leaderId!==id||target===id||!g.members.has(target))fail('Tu ne peux pas retirer ce membre.');removeMember(target);return state(id);}
 function groupMessage(id,text){
  const g=groupFor(id);if(!g)fail('Rejoins un groupe pour lui écrire.');text=messageRepository.messageText(text);
  const message={id:randomUUID(),senderId:id,senderName:g.members.get(id).username,text,createdAt:new Date(now()).toISOString()};
  g.messages.push(message);if(g.messages.length>100)g.messages.shift();publishAll();return message;
 }
 async function directMessage(id,data){
  const result=await messageRepository.send(id,data?.targetId,data?.text,data?.clientId),message=result.message;
  if(!result.duplicate){emit(message.senderId,'social:message',message);emit(message.recipientId,'social:message',message);await refreshUnread(message.recipientId);}
  return message;
 }
 async function read(id,peer,through){await messageRepository.markRead(id,peer,through);await refreshUnread(id);return{unread:sessions.get(id)?.unread||{}};}
 async function attach(socket,getLocation){
  if(!socket.connected)return;
  const id=messages.userId(socket.data.user.id),s={socket,getLocation,username:socket.data.user.username,contacts:{accepted:[],incoming:[],outgoing:[]},unread:{},signature:null};sessions.set(id,s);
  const g=groupFor(id);if(g?.members.has(id))delete g.members.get(id).disconnectedAt;
  socket.once('disconnect',()=>{if(sessions.get(id)!==s)return;sessions.delete(id);const group=groupFor(id);if(group?.members.has(id))group.members.get(id).disconnectedAt=now();publishAll();});
  publishPresence();
  await reload(id);publishAll();
 }
 function tick(){
  if(stopped)return;for(const[key,i]of invitations)if(i.expiresAt<=now())invitations.delete(key);
  for(const g of [...groups.values()])for(const m of [...g.members.values()])if(!online(m.id)&&m.disconnectedAt!=null&&now()-m.disconnectedAt>=RECONNECT_MS)removeMember(m.id);
  publishAll();
 }
 const timer=tickMs?setInterval(tick,tickMs):null;timer?.unref();
 return{attach,state,reload,friendsChanged,invite,answerInvite,leave,kick,groupMessage,directMessage,read,tick,stop(){stopped=true;if(timer)clearInterval(timer);sessions.clear();groups.clear();membership.clear();invitations.clear();}};
}
function getSocialHub(io){
 const server=io.server||io;if(!hubs.has(server)){const hub=createSocialHub({onFriendshipChanged:(a,b)=>require('./tradeManager').getTradeManager(server).friendshipChanged(a,b)});hubs.set(server,hub);instances.add(hub);server.httpServer?.once('close',()=>{hub.stop();instances.delete(hub);hubs.delete(server);});}return hubs.get(server);
}
async function notifyFriendsChanged(a,b){await Promise.all([...instances].map(h=>h.friendsChanged(a,b)));}
module.exports={createSocialHub,getSocialHub,notifyFriendsChanged,GROUP_LIMIT,INVITE_MS,RECONNECT_MS};
