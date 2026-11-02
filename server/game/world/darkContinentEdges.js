const {isMap}=require('./darkContinent');
const vectors={up:[0,-1],right:[1,0],down:[0,1],left:[-1,0]};
function directionBetween(from,to){
 if(!isMap(from)||!isMap(to))return null;
 const a=Number(from.slice(6))-1,b=Number(to.slice(6))-1,dx=b%3-a%3,dy=Math.floor(b/3)-Math.floor(a/3);
 return Object.keys(vectors).find(k=>vectors[k][0]===dx&&vectors[k][1]===dy)||null;
}
// Derive only transition config: the author's maps and both art layers stay intact.
function linksFor(name,readMap){
 const source=readMap(name),layer=n=>source.layers.find(l=>l.name===n)?.data||[],links=[];
 for(const o of source.layers.find(l=>l.name==='liaisons').objects){
  const p=Object.fromEntries((o.properties||[]).map(p=>[p.name,p.value]));if(!p.destination)continue;
  const x=o.x/source.tilewidth,y=o.y/source.tileheight,direction=directionBetween(name,p.destination);
  if(!Number.isInteger(x)||!Number.isInteger(y)||layer('coll')[y*source.width+x]||!layer('change')[y*source.width+x])continue;
  const target=readMap(p.destination),tx=p.destination_x,ty=p.destination_y;
  if(!direction||target.layers.find(l=>l.name==='coll').data[ty*target.width+tx]!==0)throw Error('Invalid authored Dark edge: '+name+' -> '+p.destination);
  if(links.some(l=>l.valX===x&&l.valY===y&&l.edgeDirection===direction))continue;
  links.push({valX:x,valY:y,goto:p.destination,nexX:tx*32,nexY:ty*32+32,edgeDirection:direction});
 }
 return links;
}
// A trainer landing on the edge can turn back immediately; walking along it
// must not activate a perpendicular link (including the shared corner cells).
function departure(player,direction){
 if(!isMap(player?.currentmap)||!vectors[direction])return null;
 const terrain=require('./mapRepository'),map=terrain.readMap(player.currentmap),x=Math.floor(player.x/32),y=Math.floor(player.y/32),[dx,dy]=vectors[direction];
 if(x+dx>=0&&x+dx<map.width&&y+dy>=0&&y+dy<map.height)return null;
 return terrain.getNextMap(player.currentmap,x,y,direction);
}
module.exports={directionBetween,linksFor,departure};
