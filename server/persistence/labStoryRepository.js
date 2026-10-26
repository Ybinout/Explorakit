const {withTransaction}=require('../config/database');
async function noteExit(userId) {
 return withTransaction(async c=>{
  await c.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[userId]);
  const [[seen]]=await c.execute("SELECT flag_value FROM player_story_flags WHERE user_id=? AND flag_key='lucie_departure'",[userId]);
  if(seen?.flag_value!=='seen')return false;
  const [r]=await c.execute("INSERT IGNORE INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,'lucie_house_exited','true')",[userId]);return r.affectedRows>0;
 });
}
async function rescueReplay(userId) {
 return withTransaction(async c=>{
  const [[owner]]=await c.execute('SELECT id,username FROM users WHERE id=? FOR UPDATE',[userId]);
  if(!require('../game/world/arenaTests').isOwner(owner))return false;
  const [rows]=await c.execute('SELECT flag_key,flag_value FROM player_story_flags WHERE user_id=?',[userId]),f=Object.fromEntries(rows.map(r=>[r.flag_key,r.flag_value]));
  if(f.admin_professor_departure!=='seen'||f['admin_room_obstacle:lab_crystals']!=='true')return false;
  await c.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,'admin_lab_rescued','true') ON DUPLICATE KEY UPDATE flag_value='true'",[userId]);return true;
 });
}
module.exports={noteExit,rescueReplay};
