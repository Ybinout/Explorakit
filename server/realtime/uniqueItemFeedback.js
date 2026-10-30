const catalogue=new Map(require('../../data/game/items.json').items.map(item=>[item.key,item]));
// Observe authoritative inventory messages only. Initial inventory and repeated
// snapshots are silent; acquiring a new unique key plays one short fanfare.
function bindUniqueItemFeedback(socket,initialItems=[]){
 const known=new Set(initialItems.filter(i=>i.quantity>0).map(i=>i.key));
 const listener=(event,payload)=>{
  if(!['bagUpdated','shopOpened'].includes(event)||!Array.isArray(payload?.items))return;
  for(const item of payload.items){if(!(item.quantity>0)||known.has(item.key))continue;known.add(item.key);const definition=catalogue.get(item.key);if(definition?.unique)socket.emit('uniqueItemReceived',{key:item.key,name:definition.name});}
 };
 socket.onAnyOutgoing(listener);return ()=>socket.offAnyOutgoing(listener);
}
module.exports={bindUniqueItemFeedback};
