const {withTransaction}=require('../config/database');
const scene=require('../game/world/lucieDeparture'),policy=require('../game/world/arenaTests');
async function begin(userId,profile=scene.config) {
 if(!Number.isInteger(userId)||userId<=0)throw Error('Utilisateur invalide.');
 if(!(scene.profiles||[scene.config]).includes(profile))throw Error('Scène inconnue.');
 return withTransaction(async connection=>{
  // Serialize tabs/reconnects; neither a client flag nor a dialogue alone can win the duel.
  const [[owner]]=await connection.execute('SELECT id,username FROM users WHERE id=? FOR UPDATE',[userId]);
  if(!owner)return false;
  const [flags]=await connection.execute('SELECT flag_key,flag_value FROM player_story_flags WHERE user_id=?',[userId]);
  const [battles]=await connection.execute('SELECT battle_key FROM user_npc_battles WHERE user_id=?',[userId]);
  const progress={flags:Object.fromEntries(flags.map(f=>[f.flag_key,f.flag_value])),completedNpcBattles:battles.map(b=>({battleKey:b.battle_key}))};
  progress.testReplays=policy.eligible(owner,progress).filter(c=>progress.flags[c.flag]==='ready').map(c=>c.name);
  if(!scene.pending(progress,profile))return false;
  await connection.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,'seen') ON DUPLICATE KEY UPDATE flag_value='seen'",[userId,scene.flag(progress,profile)]);
  return true;
 });
}
module.exports={begin};
