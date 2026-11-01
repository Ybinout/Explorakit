// Adventure only. Ordinary maps stay shared; reused tournament maps are scoped
// by the committed, absolute room index (room 17 is distinct from room 1).
function worldRoom(map,player){
 const base='adventure-map:'+map;
 if(map!=='super_tournament_room')return base;
 const floor=player?.superTournamentRoom;
 if(player?.superTournamentActive&&Number.isSafeInteger(floor)&&floor>=0)return base+':floor:'+floor;
 // A reconnect joins no floor until its saved attempt has been restored.
 return base+':pending:'+(player?.id||'unassigned');
}
function sameWorld(a,b){return Boolean(a&&b&&a.currentmap===b.currentmap&&worldRoom(a.currentmap,a)===worldRoom(b.currentmap,b));}
async function moveWorldRoom(socket,from,to,player){
 socket.data ||= {};
 const previous=socket.data.worldRoom||(from?worldRoom(from,player):null),next=worldRoom(to,player);
 if(previous&&previous!==next)await socket.leave(previous);
 await socket.join(next);socket.data.worldRoom=next;
}
module.exports={worldRoom,moveWorldRoom,sameWorld};
