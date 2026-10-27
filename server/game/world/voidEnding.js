const lab=require('./labStory');
const dialogues=require('../../../data/game/void_dialogues.json');
const config=Object.freeze({map:'void_arena',item:'void_teleporter',badge:'violence_badge',actor:'professor_final',
 pickup:{map:'professor_lab',x:16,y:9},professor:{map:'void_arena',x:13,y:4},arrival:{map:'void_arena',x:432,y:528},exit:{map:'professor_lab',x:432,y:496}});
function replay(p={}){return p.flags?.admin_void_replay==='true';}
function key(p,name){return (replay(p)?'admin_void_':'void_')+name;}
function state(p={}){const f=p.flags||{},charge=Math.max(0,Math.min(5,Number.parseInt(f[key(p,'charge')],10)||0));return{
 available:lab.rescued(p),replay:replay(p),pickup:config.pickup,found:f[key(p,'found')]==='true',charge,
 introduced:f[key(p,'intro')]==='true',defeated:f[key(p,'defeated')]==='true',claimed:f[key(p,'claimed')]==='true'};}
function entryDialogue(p){const s=state(p);return s.available&&s.found&&s.charge===5&&!s.defeated&&!s.introduced?dialogues.entry:null;}
function itemView(s){return {name:s.charge===5?'Téléporteur chargé':'Téléporteur déchargé',description:`Semble se charger à proximité de l’électricité. ${s.charge}/5`,charge:s.charge,usable:s.available&&s.found&&s.charge===5};}
function adjacent(p,target){return p?.currentmap===target.map&&Math.abs(Math.floor(p.x/32)-target.x)+Math.abs(Math.floor(p.y/32)-target.y)<=1;}
function actors(map,p){if(map!==config.map)return[];const s=state(p);if(!s.available||!s.found)return[];return[{name:config.actor,interactionName:config.actor,map,x:13,y:4,block:true,blockingWidth:1,
 sprite:s.defeated?'professor-ko-pixel-v1.png':'professor-pixel-v1.png',spriteFrame:{columns:1,rows:1,index:0}}];}
function scopedStore(base,getProgress){const extra=map=>actors(map,getProgress()),at=(map,x,y)=>extra(map).find(p=>p.x===x&&(p.y===y||p.y-1===y));return{
 getPnjsForMap:map=>[...base.getPnjsForMap(map),...extra(map)],
 getPnjAtTile:(map,x,y)=>at(map,x,y)||base.getPnjAtTile(map,x,y),
 isPnjBlockingTile:(map,x,y)=>Boolean(at(map,x,y))||base.isPnjBlockingTile(map,x,y)};}
module.exports={config,dialogues,entryDialogue,replay,key,state,itemView,adjacent,actors,scopedStore};
