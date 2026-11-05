const MODES=['1v1','2v1','2v2'];
function modeOf(offers){return offers?.houseVersion?offers.config?.mode:'1v1';}
function ranked(result){return !result.refunded||['finished','draw','both_fled'].includes(result.reason);}
function teamIds(team){return Array.isArray(team)?team.slice(0,12).map(p=>Number(p?.data?.id)).filter(id=>Number.isInteger(id)&&id>0&&id<=649):[];}
function participants(row,offers){return offers.houseVersion?offers.ids:[Number(row.user_a),Number(row.user_b)];}
function outcome(userId,offers,result){const win=offers.houseVersion?result.winners?.includes(userId):result.winnerId===userId;return{wins:win?1:0,losses:result.winnerId!==null&&!win?1:0,draws:result.winnerId===null?1:0};}
function history(rows,oldScores){
 const grouped=new Map(),modes=new Map();
 for(const row of rows){const offers=typeof row.offers_json==='string'?JSON.parse(row.offers_json):row.offers_json,result=typeof row.result_json==='string'?JSON.parse(row.result_json):row.result_json,mode=modeOf(offers);
  if(!MODES.includes(mode)||!result||row.phase!=='finished'||!ranked(result))continue;
  for(const id of participants(row,offers)){const key=mode+':'+id,s=grouped.get(key)||{mode,userId:id,wins:0,losses:0,draws:0,points:0},o=outcome(id,offers,result);
   s.wins+=o.wins;s.losses+=o.losses;s.draws+=o.draws;s.points=Math.max(0,s.points+(o.wins?30:o.losses?-10:0));grouped.set(key,s);
   if(!modes.has(id))modes.set(id,new Set());modes.get(id).add(mode);
  }
 }
 // Preserve the exact existing score when its entire history belongs to one mode.
 for(const old of oldScores){const id=Number(old.user_id),known=modes.get(id);if(known?.size===1){const mode=[...known][0];Object.assign(grouped.get(mode+':'+id),{wins:Number(old.wins),losses:Number(old.losses),draws:Number(old.draws),points:Number(old.points)});}
  else if(!known)grouped.set('1v1:'+id,{mode:'1v1',userId:id,wins:Number(old.wins),losses:Number(old.losses),draws:Number(old.draws),points:Number(old.points)});
 }
 return [...grouped.values()];
}
module.exports={MODES,modeOf,ranked,teamIds,participants,outcome,history};
