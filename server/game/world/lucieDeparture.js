const {hasCompletedBattle}=require('./storyProgression');
const {npcBattles}=require('../../../data/game/progression.json');
const config=Object.freeze({map:'route2_maison',actor:'lucie_route2',dialogue:'lucie_route2_after',afterDialogue:'lucie_departure_outside',flag:'lucie_departure',adminFlag:'admin_lucie_departure',duration:4200,x:13,y:5});
const professor=Object.freeze({map:'professor_lab',actor:'professor_story',dialogue:'professor_story_after',flag:'professor_departure',adminFlag:'admin_professor_departure',duration:4200,x:13,y:11});
const profiles=Object.freeze([config,professor]);
function flag(progress={},scene=config) {return progress.flags?.[scene.adminFlag] ? scene.adminFlag : scene.flag;}
function won(progress,scene=config) {return hasCompletedBattle(npcBattles[scene.actor],progress);}
function hidden(progress={},scene=config) {return won(progress,scene)&&!require('./testReplayState').active(progress,scene.actor)&&progress.flags?.[flag(progress,scene)]==='seen';}
function pending(progress={},scene=config) {return won(progress,scene)&&!require('./testReplayState').active(progress,scene.actor)&&!hidden(progress,scene);}
function scopedStore(base,getProgress,isLeaving=()=>false) {
 const omit=p=>profiles.some(scene=>p?.name===scene.actor&&hidden(getProgress(),scene))&&!isLeaving();
 return {
  getPnjsForMap(map){return base.getPnjsForMap(map).filter(p=>!omit(p));},
  getPnjAtTile(map,x,y){const p=base.getPnjAtTile(map,x,y);return omit(p)?null:p;},
  isPnjBlockingTile(map,x,y){const p=base.getPnjAtTile(map,x,y);return omit(p)?false:base.isPnjBlockingTile(map,x,y);}
 };
}
module.exports={config,professor,profiles,flag,hidden,pending,scopedStore};
