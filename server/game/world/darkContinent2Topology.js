const dc2=require('./darkContinent2');let floor;
function build(){if(floor)return floor;const t=require('./mapRepository'),queue=[[dc2.config.arrival.map,Math.floor(dc2.config.arrival.x/32),Math.floor(dc2.config.arrival.y/32)]],seen=new Set();
 for(let i=0;i<queue.length;i++){const[map,x,y]=queue[i],key=map+':'+x+':'+y;if(seen.has(key))continue;const grid=t.loadCollisionData(map);if(grid[y]?.[x]!==0)continue;seen.add(key);
 for(const[dx,dy,d]of[[1,0,'right'],[-1,0,'left'],[0,1,'down'],[0,-1,'up']]){if(x+dx<0||x+dx>=28||y+dy<0||y+dy>=20){const next=t.getNextMap(map,x,y,d);if(next&&dc2.isMap(next.nextMap))queue.push([next.nextMap,Math.floor(next.nextX/32),Math.floor(next.nextY/32)]);}else queue.push([map,x+dx,y+dy]);}}
 floor=seen;return floor;}
const reachable=(map,x,y)=>build().has(map+':'+Math.floor(x/32)+':'+Math.floor(y/32));
module.exports={build,reachable};
