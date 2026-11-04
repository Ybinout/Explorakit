const {withTransaction}=require('../config/database');
const trainers=require('./trainerRepository');
const {userId}=require('./socialMessageRepository');
const badges=require('../../data/game/progression.json').badges;
async function details(viewer,target,view){
 viewer=userId(viewer);target=userId(target);
 if(!['badges','rankings'].includes(view))throw Object.assign(Error('Fiche demandée invalide.'),{statusCode:400});
 return withTransaction(async c=>{
  if(await trainers.relationship(viewer,target,c)!=='friends')throw Object.assign(Error('Cette fiche est réservée à tes amis.'),{statusCode:403});
  if(view==='badges'){
   const [rows]=await c.execute('SELECT badge_key,awarded_at FROM player_badges WHERE user_id=?',[target]);
   // Only earned badges: locked finale names and future champions stay hidden.
   return {targetId:target,view,badges:badges.flatMap(b=>{const row=rows.find(r=>r.badge_key===b.key);return row?[{key:b.key,name:b.name,awardedAt:row.awarded_at}]:[]})};
  }
  return {targetId:target,view,house:await require('./whitepeakRankingRepository').standings(target,c),tower:await require('./superTournamentRepository').standing(target,c)};
 });
}
module.exports={details};
