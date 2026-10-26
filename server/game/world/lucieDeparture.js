const {hasCompletedBattle}=require('./storyProgression');
const {npcBattles}=require('../../../data/game/progression.json');
const config=Object.freeze({map:'route2_maison',actor:'lucie_route2',dialogue:'lucie_route2_after',flag:'lucie_departure',adminFlag:'admin_lucie_departure',duration:4200,x:13,y:5});
function flag(progress={}) {return progress.flags?.[config.adminFlag] ? config.adminFlag : config.flag;}
function won(progress) {return hasCompletedBattle(npcBattles[config.actor],progress);}
function hidden(progress={}) {return won(progress)&&!require('./testReplayState').active(progress,config.actor)&&progress.flags?.[flag(progress)]==='seen';}
function pending(progress={}) {return won(progress)&&!require('./testReplayState').active(progress,config.actor)&&!hidden(progress);}
function scopedStore(base,getProgress,isLeaving=()=>false) {
 const omit=p=>p?.name===config.actor&&hidden(getProgress())&&!isLeaving();
 return {
  getPnjsForMap(map){return base.getPnjsForMap(map).filter(p=>!omit(p));},
  getPnjAtTile(map,x,y){const p=base.getPnjAtTile(map,x,y);return omit(p)?null:p;},
  isPnjBlockingTile(map,x,y){const p=base.getPnjAtTile(map,x,y);return omit(p)?false:base.isPnjBlockingTile(map,x,y);}
 };
}
module.exports={config,flag,hidden,pending,scopedStore};
