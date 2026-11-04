const MAP='ville4_maison2',PRICE=1000000;
const SCIENTIST=Object.freeze({name:'rochebrume_scientist',map:MAP,x:14,y:9});
function nearby(player){return player?.currentmap===MAP&&Math.abs(Math.floor(player.x/32)-SCIENTIST.x)+Math.min(Math.abs(Math.floor(player.y/32)-SCIENTIST.y),Math.abs(Math.floor(player.y/32)-(SCIENTIST.y-1)))===1;}
function project(source){
 const layers={coll:Array(560).fill(1),change:Array(560).fill(0),int:Array(560).fill(0),battle:Array(560).fill(0)};
 for(let y=6;y<=15;y++)for(let x=4;x<=23;x++)layers.coll[y*28+x]=0;
 for(const [left,top,right,bottom]of [[5,6,8,8],[11,6,16,8],[19,6,22,8],[5,12,8,14],[19,12,22,13]])for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++)layers.coll[y*28+x]=1;
 for(const x of [13,14])for(const y of [16,17]){layers.coll[y*28+x]=0;if(y===17)layers.change[y*28+x]=1;}
 return {...source,layers:source.layers.map(layer=>layers[layer.name]?{...layer,width:28,height:20,data:layers[layer.name]}:layer)};
}
module.exports={MAP,PRICE,SCIENTIST,nearby,project};
