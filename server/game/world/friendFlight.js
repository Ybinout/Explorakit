const {getRegionMap}=require('./regionMap'),terrain=require('./mapRepository'),gates=require('./storyGates');
function destination(location,state,progress={}){
 const map=location?.map,node=getRegionMap().nodes.find(n=>n.id===map);
 if(location?.mode!=='adventure'||!node||!['town','route'].includes(node.kind)||/^jungle/.test(map))throw Error('Ton ami doit être dehors, dans une ville ou une route accessible au Vol.');
 if(!(state.visitedRegions||state.visited||[]).includes(map))throw Error('Visite d’abord cette zone avant de rejoindre ton ami.');
 if(/^safari/.test(map)&&!state.visited.includes('safari8'))throw Error('Rejoins d’abord le Centre Pokémon du Safari pour y débloquer le Vol.');
 if(gates.gates.some(g=>(g.map===map||g.nextMap===map)&&gates.isLocked(g,progress)))throw Error('Termine d’abord les défis qui verrouillent cette zone.');
 if(!Number.isFinite(location.x)||!Number.isFinite(location.y))throw Error('La position de ton ami n’est pas disponible.');
 const collision=terrain.loadCollisionData(map),changes=terrain.changeMapData(map),blocked=require('./safari').scopedStore(require('./pnjStore')).isPnjBlockingTile;
 const x=Math.floor(location.x/32),y=Math.floor(location.y/32),q=[[x,y,0]],seen=new Set();
 for(let at=0;at<q.length;at++){const[cx,cy,d]=q[at],key=cx+','+cy;if(seen.has(key)||d>4)continue;seen.add(key);
  if(collision[cy]?.[cx]!==0)continue;
  if(d>0&&!changes[cy]?.[cx]&&!blocked(map,cx,cy))return{map,x:cx*32+16,y:cy*32+16,landmark:'friend'};
  for(const[dx,dy]of[[0,1],[-1,0],[1,0],[0,-1]])q.push([cx+dx,cy+dy,d+1]);
 }
 throw Error('Aucune place sûre pour atterrir près de ton ami.');
}
module.exports={destination};
