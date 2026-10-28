const departure=require('./lucieDeparture');
const config=Object.freeze({map:'professor_lab',door:{map:'start',x:24,y:15},rock:{map:'start',x:26,y:18},wanda:{map:'route2',x:14,y:7},arrival:{map:'professor_lab',x:432,y:528}});
const maps=new Set(['start','route2','route2_maison',config.map,'void_arena']);
const replay=p=>Boolean(p.flags?.admin_professor_departure);
const fullReplay=p=>p.flags?.admin_finale_replay==='full'
 || Boolean(p.flags?.lucie_rescued==='true'&&p.flags?.admin_lucie_departure&&p.flags?.admin_professor_departure);
const replayFlags=Object.freeze({lucie_house_exited:'admin_lucie_house_exited',professor_lead:'admin_professor_lead',lab_door_inspected:'admin_lab_door_inspected',professor_lab_key:'admin_professor_lab_key',lucie_rescued:'admin_lab_rescued'});
// A private scene projection, never a rewrite of permanent story/reward flags.
function view(progress) {
 if(!progress||(!replay(progress)&&!fullReplay(progress)))return progress;
 const f=progress.flags||{},flags={...f},advanced=['pending','seen'].includes(f.admin_professor_departure);
 if(replay(progress)){
  flags.professor_defeated=advanced?'true':'false';
  flags.professor_departure=f.admin_professor_departure;
  flags.lab_crystals_cleared=f['admin_room_obstacle:lab_crystals']==='true'?'true':'false';
  flags.lucie_rescued=f.admin_lab_rescued==='true'?'true':'false';
 }
 if(fullReplay(progress)){
  flags.lucie_departure=f.admin_lucie_departure;
  // Legacy replays already past the professor stay at the rescue stage.
  flags.lucie_house_exited=f.admin_lucie_house_exited ?? (f.admin_lucie_departure==='seen'&&f.lucie_house_exited==='true'?'true':'false');
  for(const key of ['professor_lead','lab_door_inspected','professor_lab_key'])flags[key]=f[replayFlags[key]] ?? (advanced?'true':'false');
 }
 return {...progress,flags};
}
const rescued=p=>view(p)?.flags?.lucie_rescued==='true';
function entryDialogue(map,p={}) {
 const f=view(p)?.flags||{};
 return map===config.wanda.map&&f.lucie_departure==='seen'&&f.lucie_house_exited==='true'
  &&f.professor_lead!=='true'&&f.professor_lab_key!=='true'&&f.lucie_rescued!=='true'
  ?'wanda_professor':null;
}
function actors(map,p={}) {
 const flags=view(p)?.flags||{},result=[];
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
  if(map==='start'&&rescued(p)){
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
 const f=view(progress)?.flags||{};
 if(adjacent(player,config.door))return f.professor_lab_key==='true'?{enter:true}:{dialogue:f.professor_lead==='true'?'professor_lab_door':'professor_lab_door_unknown',target:config.door};
 if(adjacent(player,config.rock)&&f.lab_door_inspected==='true')return {dialogue:f.professor_lab_key==='true'?'professor_lab_rock_empty':'professor_lab_rock',target:config.rock};
 return null;
}
module.exports={config,maps,replay,fullReplay,replayFlags,view,rescued,entryDialogue,actors,scopedStore,adjacent,interaction};
