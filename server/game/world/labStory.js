const departure=require('./lucieDeparture');
const config=Object.freeze({map:'professor_lab',door:{map:'start',x:24,y:15},rock:{map:'start',x:26,y:18},wanda:{map:'route2',x:14,y:7},arrival:{map:'professor_lab',x:432,y:528}});
const maps=new Set(['start','route2','route2_maison',config.map]);
const replay=p=>Boolean(p.flags?.admin_professor_departure);
const rescued=p=>replay(p)?p.flags?.admin_lab_rescued==='true':p.flags?.lucie_rescued==='true';
function actors(map,p={}) {
 const flags=p.flags||{},result=[];
 if(map==='route2'&&flags.lucie_house_exited==='true'&&flags.professor_lab_key!=='true')result.push({name:'wanda_professor',interactionName:'wanda_professor',sprite:'wanda.png',map,x:14,y:7,block:true,blockingWidth:1});
 if(map===config.map){
  result.push({name:'professor_story',interactionName:'professor_story',sprite:'prof2.png',spriteFrame:{columns:1,rows:1,index:0},map,x:13,y:11,block:true});
  if(!rescued(p))result.push({name:'lucie_lab',interactionName:'lucie_lab_rescue',sprite:'lucie-pixel-v2.png',spriteFrame:{columns:1,rows:1,index:0},map,x:13,y:5,block:true});
 }
 if(map==='start'&&flags.lucie_rescued==='true')result.push({name:'lucie_home',interactionName:'lucie_home',sprite:'lucie-pixel-v2.png',spriteFrame:{columns:1,rows:1,index:0},map,x:5,y:8,block:true});
 return result;
}
function scopedStore(base,getProgress) {
 const extra=map=>{
  const p=getProgress(),result=actors(map,p);
  if(map==='start'&&p.flags?.lucie_rescued==='true'){
   const mother=base.getPnjsForMap(map).find(n=>n.name==='mere_clara');
   if(mother)result.push({...mother,x:6,y:8,roamRadius:0});
  }
  return result;
 };
 const at=(map,x,y)=>extra(map).find(p=>x>=p.x&&x<p.x+(p.blockingWidth||1)&&(y===p.y||y===p.y-1));
 return {
  getPnjsForMap(map){const additions=extra(map),names=new Set(additions.map(n=>n.name));return [...base.getPnjsForMap(map).filter(n=>!names.has(n.name)),...additions];},
  getPnjAtTile(map,x,y){const own=at(map,x,y),old=base.getPnjAtTile(map,x,y);return own||(extra(map).some(n=>n.name===old?.name)?null:old);},
  isPnjBlockingTile(map,x,y){const own=at(map,x,y),old=base.getPnjAtTile(map,x,y);return own?own.block!==false:extra(map).some(n=>n.name===old?.name)?false:base.isPnjBlockingTile(map,x,y);}
 };
}
function adjacent(player,target) {return player.currentmap===target.map&&Math.abs(Math.floor(player.x/32)-target.x)+Math.abs(Math.floor(player.y/32)-target.y)<=1;}
function interaction(player,progress={}) {
 const f=progress.flags||{};
 if(adjacent(player,config.door))return f.professor_lab_key==='true'?{enter:true}:{dialogue:f.professor_lead==='true'?'professor_lab_door':'professor_lab_door_unknown',target:config.door};
 if(adjacent(player,config.rock)&&f.lab_door_inspected==='true')return {dialogue:f.professor_lab_key==='true'?'professor_lab_rock_empty':'professor_lab_rock',target:config.rock};
 return null;
}
module.exports={config,maps,replay,rescued,actors,scopedStore,adjacent,interaction};
