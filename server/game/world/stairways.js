const {changeMapData,getNextMap}=require('./mapRepository');
// Transient input protection, outside player saves and expedition checkpoints.
const arrivals=new WeakMap();
function departure(player,direction) {
    const x=Math.floor(player.x/32),y=Math.floor(player.y/32);
    if(!changeMapData(player.currentmap)[y]?.[x])return null;
    const link=getNextMap(player.currentmap,x,y);
    if(!link?.staircase || link.triggerOnExit!==direction || link.blockedMessage || link.requiresStoryFlag)return null;
    const lock=arrivals.get(player);
    if(lock?.map===player.currentmap && lock.returnTo===link.nextMap)return null;
    return link;
}
function arrived(player,fromMap) {
    const x=Math.floor(player.x/32),y=Math.floor(player.y/32);
    for(const[dx,dy]of [[0,-1],[0,1],[-1,0],[1,0]]){
        const link=getNextMap(player.currentmap,x+dx,y+dy);
        if(link?.staircase && link.nextMap===fromMap){
            arrivals.set(player,{map:player.currentmap,returnTo:fromMap,x:x+dx,y:y+dy});return;
        }
    }
}
function moved(player,previous) {
    const lock=arrivals.get(player);if(!lock)return;
    if(lock.map!==player.currentmap){arrivals.delete(player);return;}
    const distance=p=>Math.abs(Math.floor(p.x/32)-lock.x)+Math.abs(Math.floor(p.y/32)-lock.y);
    // A genuine step away from the stair arms a deliberate return. Continuing
    // the same held direction towards its mouth cannot immediately reverse it.
    if(distance(player)>distance(previous))arrivals.delete(player);
}
function clear(player) {arrivals.delete(player);}
module.exports={departure,arrived,moved,clear};
