// Remove four empty aisle columns, keeping every fixture and its native proportions.
const FLOORS=new Set(['tour_rdc','tour_etage1','tour_etage2','tour_etage3']);
const COLUMNS=Array.from({length:28},(_,i)=>i).filter(x=>![5,6,21,22].includes(x));
function compactTile(map,x){return FLOORS.has(map)?2+COLUMNS.indexOf(x):x;}
function sourceTile(map,x){return FLOORS.has(map)?COLUMNS[x-2]??-1:x;}
function project(map,source){
 if(!FLOORS.has(map))return source;
 return {...source,layers:source.layers.map(layer=>{
  if(layer.type==='tilelayer')return {...layer,data:Array.from({length:source.height},(_,y)=>Array.from({length:source.width},(_,x)=>{const old=sourceTile(map,x);return old<0?(layer.name==='coll'?1:0):layer.data[y*source.width+old];})).flat()};
  if(layer.type==='objectgroup')return {...layer,objects:layer.objects.map(o=>{const properties=o.properties.map(p=>({...p})),destination=properties.find(p=>p.name==='destination')?.value;const arrival=properties.find(p=>p.name==='destination_x');if(arrival)arrival.value=compactTile(destination,arrival.value);return {...o,x:compactTile(map,o.x/16)*16,properties};})};
  return layer;
 })};
}
module.exports={FLOORS,COLUMNS,compactTile,sourceTile,project};
