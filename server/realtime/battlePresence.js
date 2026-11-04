const {worldRoom}=require('./worldRooms');

// Observe the authoritative flag used by all battle controllers. No polling,
// persistence or additional battle state: the public snapshot already exposes it.
function observeBattlePresence(io,player,isCurrent=()=>true) {
    let inbattle=Boolean(player.inbattle);
    Object.defineProperty(player,'inbattle',{
        enumerable:true,configurable:true,
        get(){return inbattle;},
        set(value){
            const next=Boolean(value);
            if(next===inbattle)return;
            inbattle=next;
            if(!isCurrent())return;
            io.to(worldRoom(player.currentmap,player)).emit('playerBattleStatus',{
                id:player.id,currentmap:player.currentmap,inbattle
            });
        }
    });
}
module.exports={observeBattlePresence};
