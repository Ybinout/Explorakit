const config = require('../../../data/game/raid_world_motion.json');
function position(r, now) {
  const t=Math.max(0,Math.min(1,(now-r.movedAt)/(r.moveDurationMs||4000)));
  return {x:r.from.x+(r.to.x-r.from.x)*t,y:r.from.y+(r.to.y-r.from.y)*t};
}
function step(r, now, players, choices, pick) {
  const pos=position(r,now),near=players.some(p=>p.currentmap===r.map&&Math.hypot(p.x-pos.x,p.y-pos.y)<=config.stopRadiusPx);
  if(near){
    let changed=false;
    if(r.from.x!==r.to.x||r.from.y!==r.to.y){r.resumeTo={...r.to};Object.assign(r,pos);r.from={...pos};r.to={...pos};changed=true;}
    r.nextMove=now+config.pauseMs;return changed;
  }
  if(now<r.nextMove)return false;
  const candidates=choices(r.map,Math.floor(pos.x/32),Math.floor(pos.y/32));
  // Resume the interrupted axis-aligned segment before choosing a new neighbour.
  const target=r.resumeTo|| (candidates.length?candidates[pick(candidates.length)]:pos);
  delete r.resumeTo;Object.assign(r,pos);r.from={...pos};r.to={...target};
  r.moveDurationMs=Math.max(180,Math.round(Math.hypot(target.x-pos.x,target.y-pos.y)/32*config.travelMs));
  r.movedAt=now;r.nextMove=now+r.moveDurationMs+config.pauseMs;return true;
}
module.exports={config,position,step};
