const {getRegionMap}=require('./regionMap'),terrain=require('./mapRepository'),gates=require('./storyGates');
const INACCESSIBLE='Zone inaccessible : vous ne pouvez pas rejoindre cet ami.';
const inaccessible=()=>Object.assign(Error(INACCESSIBLE),{code:'zone_inaccessible'});
function destination(location,state,progress={}){
 const map=location?.map,node=getRegionMap().nodes.find(n=>n.id===map);
 if(location?.mode!=='adventure'||!node||!['town','route'].includes(node.kind)||require('./darkContinent').isMap(map))throw inaccessible();
 if(!(state.visitedRegions||state.visited||[]).includes(map))throw inaccessible();
 if(/^safari/.test(map)&&!(state.visited||[]).includes('safari8'))throw inaccessible();
 if(gates.gates.some(g=>(g.map===map||g.nextMap===map)&&gates.isLocked(g,progress)))throw inaccessible();
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
module.exports={destination,INACCESSIBLE};
