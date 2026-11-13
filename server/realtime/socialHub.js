const trainers=require('../persistence/trainerRepository');
const messages=require('../persistence/socialMessageRepository');
const {regionLocation}=require('../game/world/regionMap');
const hubs=new WeakMap(),instances=new Set();
const fail=message=>{throw Object.assign(Error(message),{statusCode:400});};
const AFK_MS=5*60*1000;
function createSocialHub({now=Date.now,repository=trainers,messageRepository=messages,tickMs=1000,onFriendshipChanged=()=>{}}={}){
 const sessions=new Map(),inboxQueues=new Map();
 let stopped=false,presenceKey=null,presenceRevision=0,onlineTrainers=[];
 const online=id=>!!sessions.get(id)?.socket.connected;
 const emit=(id,event,payload)=>{const s=sessions.get(id);if(s?.socket.connected)s.socket.emit(event,payload);};
 function presence(id){const s=sessions.get(id),connected=!!s?.socket.connected;return {online:connected,afk:connected&&s.afk,status:connected?(s.afk?'afk':'online'):'offline',connectedSince:connected?s.connectedSince:null};}
 function location(id){const s=sessions.get(id);if(!s?.socket.connected)return null;const p=s.getLocation?.();if(!p?.map)return null;const nodeId=regionLocation(p.map,p.centerReturnPoint);return nodeId?{nodeId,mode:p.mode||'adventure'}:null;}
 function state(id){
  const s=sessions.get(id),contacts=s?.contacts||{accepted:[],incoming:[],outgoing:[]};
  const enrich=p=>({...p,...presence(p.id),unread:s?.unread[p.id]||0});
  // Only accepted friends receive region positions. No coordinates, private
  // instance IDs, parties or pending actions are shared by this channel.
  return {accepted:contacts.accepted.map(p=>({...enrich(p),location:location(p.id)})),incoming:contacts.incoming.map(enrich),outgoing:contacts.outgoing.map(enrich),self:presence(id),serverNow:now()};
 }
 function friendTravelLocation(viewer,target){const s=sessions.get(viewer);if(!s?.contacts.accepted.some(p=>p.id===target))fail('Ce dresseur ne fait pas partie de tes amis.');const friend=sessions.get(target);if(!friend?.socket.connected)fail('Ton ami est hors ligne.');return friend.getLocation?.()||null;}
 function signature(id){const s=sessions.get(id);if(!s)return '';return JSON.stringify({self:presence(id),friends:s.contacts.accepted.map(p=>[p.id,presence(p.id),location(p.id)])});}
 function publish(id,force=false){const s=sessions.get(id);if(!s?.socket.connected)return;const key=signature(id);if(force||s.signature!==key){s.signature=key;emit(id,'social:state',state(id));}}
 function publishPresence(){
  const connected=[...sessions.values()].filter(s=>s.socket.connected),count=connected.length;
  const key=JSON.stringify(connected.map(s=>[Number(s.socket.data.user.id),s.username,s.afk,s.connectedSince]));
  const changed=key!==presenceKey;
  if(changed){presenceKey=key;presenceRevision++;onlineTrainers=connected.map(s=>({id:Number(s.socket.data.user.id),username:s.username,...presence(Number(s.socket.data.user.id))})).sort((a,b)=>a.username.localeCompare(b.username,'fr')||a.id-b.id);}
  for(const s of connected){if(s.onlineCount!==count){s.onlineCount=count;s.socket.emit('presence:count',{count});}if(changed)s.socket.emit('social:presenceChanged',{revision:presenceRevision});}
 }
 function onlineDirectory(id,offset=0){
  if(!Number.isSafeInteger(offset)||offset<0||offset>10000)fail('Page invalide.');
  const entries=onlineTrainers.filter(p=>p.id!==id);
  return {entries:entries.slice(offset,offset+20).map(p=>({...p})),hasMore:offset+20<entries.length&&offset<10000,total:entries.length,revision:presenceRevision,serverNow:now()};
 }
 function publishAll(){publishPresence();for(const id of sessions.keys())publish(id);}
 function activity(socket){
  const id=Number(socket.data?.user?.id),s=sessions.get(id);
  if(stopped||!s||s.socket!==socket||!socket.connected)return;
  s.lastActivity=now();if(s.afk){s.afk=false;publishAll();}
 }
 async function refreshUnread(id){
  const previous=inboxQueues.get(id)||Promise.resolve();
  const task=previous.catch(()=>{}).then(async()=>{const s=sessions.get(id);if(!s)return;const counts=await messageRepository.unread(id);if(sessions.get(id)===s){s.unread=counts;publish(id,true);}});
  inboxQueues.set(id,task);try{await task;}finally{if(inboxQueues.get(id)===task)inboxQueues.delete(id);}
 }
 async function reload(id){const s=sessions.get(id);if(!s)return;const version=s.contactVersion=(s.contactVersion||0)+1;const contacts=await repository.friends(id);if(sessions.get(id)!==s||s.contactVersion!==version)return;s.contacts=contacts;await refreshUnread(id);publish(id,true);}
 async function friendsChanged(a,b){const relationship=await repository.relationship(a,b);if(relationship!=='friends')onFriendshipChanged(a,b);await Promise.all([reload(a),reload(b)]);publishAll();}
 async function deliverStoredMessage(message){emit(message.senderId,'social:message',message);emit(message.recipientId,'social:message',message);await refreshUnread(message.recipientId);}
 async function directMessage(id,data){const result=await messageRepository.send(id,data?.targetId,data?.text,data?.clientId),message=result.message;if(!result.duplicate)await deliverStoredMessage(message);return message;}
 async function read(id,peer,through){await messageRepository.markRead(id,peer,through);await refreshUnread(id);return {unread:sessions.get(id)?.unread||{}};}
 async function attach(socket,getLocation){
  if(!socket.connected)return;
  const id=messages.userId(socket.data.user.id),started=now(),s={socket,getLocation,username:socket.data.user.username,contacts:{accepted:[],incoming:[],outgoing:[]},unread:{},signature:null,connectedSince:started,lastActivity:started,afk:false};sessions.set(id,s);
  socket.once('disconnect',()=>{if(sessions.get(id)!==s)return;sessions.delete(id);publishAll();});publishPresence();await reload(id);publishAll();
 }
 function tick(){if(stopped)return;for(const s of sessions.values())s.afk=now()-s.lastActivity>=AFK_MS;publishAll();}
 const timer=tickMs?setInterval(tick,tickMs):null;timer?.unref();
 return {attach,state,reload,onlineDirectory,friendTravelLocation,presence,isOnline:online,friendsChanged,directMessage,deliverStoredMessage,read,activity,tick,stop(){stopped=true;if(timer)clearInterval(timer);sessions.clear();inboxQueues.clear();}};
}
function getSocialHub(io){const server=io.server||io;if(!hubs.has(server)){const hub=createSocialHub({onFriendshipChanged:(a,b)=>require('./tradeManager').getTradeManager(server).friendshipChanged(a,b)});hubs.set(server,hub);instances.add(hub);server.httpServer?.once('close',()=>{hub.stop();instances.delete(hub);hubs.delete(server);});}return hubs.get(server);}
async function notifyFriendsChanged(a,b){await Promise.all([...instances].map(h=>h.friendsChanged(a,b)));}
module.exports={createSocialHub,getSocialHub,notifyFriendsChanged,AFK_MS};
