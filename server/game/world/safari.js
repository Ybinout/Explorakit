const signs=require('../../../data/game/safari_signs.json');
const config=require('../../../data/game/safari_encounters.json');
const ZONE='Europe/Paris',ARRIVAL=Object.freeze({map:'safari1',x:208,y:464}),LOBBY=Object.freeze({map:'super_tournament_lobby',x:752,y:496});
const isMap=map=>/^safari(?:[1-9]|1[0-5])$/.test(String(map||''));
const index=map=>isMap(map)?Number(map.slice(6))-1:null;
const dayFormat=new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit'});
function calendar(now=Date.now()){
 const parts=Object.fromEntries(dayFormat.formatToParts(new Date(now)).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
 return{date:`${parts.year}-${parts.month}-${parts.day}`,parity:Number(parts.day)%2?'odd':'even',timeZone:ZONE};
}
function pool(map,method='grass',now=Date.now()){
 const zone=config.maps[map],day=calendar(now);if(!zone)return[];
 return(zone[method]||[]).filter(p=>p.day==='all'||p.day===day.parity).map(p=>[p.id,p.weight]);
}
function choose(entries,random=Math.random){
 if(!entries.length)return null;let roll=random()*entries.reduce((sum,[,weight])=>sum+weight,0);
 for(const[id,weight]of entries){roll-=weight;if(roll<0)return id;}return entries.at(-1)[0];
}
function encounter(map,method='grass',random=Math.random,now=Date.now()){
 if(!isMap(map))return null;
 const rare=pool(map,'rare',now);
 if(rare.length&&random()<1/config.legendaryOneIn)return choose(rare,random);
 return choose(pool(map,method,now),random);
}
function actors(map){
 const place=map===LOBBY.map?{name:'safari_captain',x:24,y:15}:map==='safari1'?{name:'safari_return',x:7,y:14}:null;
 return [...signs.filter(s=>s.map===map).map(s=>({...s,name:'safari_bourg_'+map,interactionName:'safari_bourg_sign',sprite:'6931.png',block:true,roamRadius:0,safariSign:true,signDirection:s.direction})),...(place?[{...place,interactionName:place.name,map,sprite:'6931.png',spriteFrame:{columns:8,rows:4,index:6},block:true,roamRadius:0}]:[])];
}
function near(player){
 if(!player)return null;const x=Math.floor(player.x/32),y=Math.floor(player.y/32);
 return actors(player.currentmap).filter(a=>!a.safariSign).find(a=>Math.abs(x-a.x)+Math.min(Math.abs(y-a.y),Math.abs(y-(a.y-1)))<=1)||null;
}
function scopedStore(base){
 const at=(map,x,y)=>actors(map).find(a=>a.x===x&&(a.y===y||a.y-1===y));
 return{...base,getPnjsForMap:map=>[...base.getPnjsForMap(map),...actors(map)],getPnjAtTile:(map,x,y)=>at(map,x,y)||base.getPnjAtTile(map,x,y),isPnjBlockingTile:(map,x,y)=>!!at(map,x,y)||base.isPnjBlockingTile(map,x,y)};
}
function departure(player,direction){
 if(!isMap(player?.currentmap))return null;
 const delta={up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]}[direction];if(!delta)return null;
 const x=Math.floor(player.x/32),y=Math.floor(player.y/32);
 return x+delta[0]<0||x+delta[0]>=28||y+delta[1]<0||y+delta[1]>=20?require('./mapRepository').getNextMap(player.currentmap,x,y,direction):null;
}
module.exports={ZONE,ARRIVAL,LOBBY,isMap,index,calendar,pool,choose,encounter,actors,near,scopedStore,departure};
