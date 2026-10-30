// Adventure only. Socket.IO rooms let one encoded packet reach just the map's
// occupants. They never contain Rift/Colosseum namespaces or private PNJ state.
const worldRoom=map=>'adventure-map:'+map;
async function moveWorldRoom(socket,from,to){
 if(from&&from!==to)await socket.leave(worldRoom(from));
 await socket.join(worldRoom(to));
}
module.exports={worldRoom,moveWorldRoom};
