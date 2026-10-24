const {getRegionMap,regionLocation}=require('./regionMap');
const terrain=require('./mapRepository');
const {isPnjBlockingTile}=require('./pnjStore');
const VISIT_PREFIX='visited_town:';
function townForMap(map,centerReturnPoint){
    const id=regionLocation(map,centerReturnPoint);
    return getRegionMap().nodes.some(n=>n.id===id&&n.kind==='town')?id:null;
}
function flightDestination(map){
    if(typeof map!=='string'||townForMap(map)!==map)return null;
    const collision=terrain.loadCollisionData(map),changes=terrain.changeMapData(map),doors=[];
    changes.forEach((row,y)=>row.forEach((tile,x)=>{
        if(!tile||collision[y]?.[x])return;
        const next=terrain.getNextMap(map,x,y)?.nextMap;
        const priority=next==='centre'?0:/arene/.test(next||'')?1:map==='start'&&next==='maison'?2:99;
        if(priority<99)doors.push({x,y,priority});
    }));
    doors.sort((a,b)=>a.priority-b.priority);
    for(const door of doors)for(const[dx,dy]of [[0,1],[-1,0],[1,0],[0,-1]]){
        const x=door.x+dx,y=door.y+dy;
        if(collision[y]?.[x]===0&&!changes[y]?.[x]&&!isPnjBlockingTile(map,x,y))return{map,x:x*32+16,y:y*32+16,landmark:['centre','arena','home'][door.priority]};
    }
    return null;
}
function flightState(flags={}){
    return{unlocked:flags.fly_module_received==='true',visited:getRegionMap().nodes.filter(n=>n.kind==='town'&&flags[VISIT_PREFIX+n.id]==='true').map(n=>n.id)};
}
module.exports={VISIT_PREFIX,townForMap,flightDestination,flightState};
