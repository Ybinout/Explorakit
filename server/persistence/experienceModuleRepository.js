const {dbPool,withTransaction}=require('../config/database');
const {ITEM_KEY,ACTIVE_FLAG,RECEIPT_FLAG,view}=require('../game/items/experienceModule');
const eligibleSql=`EXISTS(SELECT 1 FROM player_story_flags f WHERE f.user_id=u.id AND f.flag_value='true' AND f.flag_key IN ('sevenp_defeated','experience_module_received'))
 OR EXISTS(SELECT 1 FROM user_npc_battles b WHERE b.user_id=u.id AND b.battle_key='story_champion_7p')
 OR EXISTS(SELECT 1 FROM player_badges b WHERE b.user_id=u.id AND b.badge_key='summit_badge')`;
async function loadState(userId,c=dbPool){
 const [[row]]=await c.execute(`SELECT COALESCE(i.quantity,0) AS quantity,f.flag_value AS enabled FROM users u
 LEFT JOIN user_items i ON i.user_id=u.id AND i.item_key=?
 LEFT JOIN player_story_flags f ON f.user_id=u.id AND f.flag_key=? WHERE u.id=?`,[ITEM_KEY,ACTIVE_FLAG,userId]);
 return view(row?.quantity>0,row?.enabled);
}
// Called with the user row locked. Replays/reconciliation never add a second copy or reset the switch.
async function grant(userId,c){
 const [[previous]]=await c.execute('SELECT quantity FROM user_items WHERE user_id=? AND item_key=?',[userId,ITEM_KEY]);
 await c.execute('INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,?,1) ON DUPLICATE KEY UPDATE quantity=GREATEST(quantity,1)',[userId,ITEM_KEY]);
 await c.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,'true') ON DUPLICATE KEY UPDATE flag_value='true'",[userId,RECEIPT_FLAG]);
 await c.execute("INSERT IGNORE INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,'false')",[userId,ACTIVE_FLAG]);
 return !(previous?.quantity>0);
}
async function reconcile(userId){
 const [[eligible]]=await dbPool.execute(`SELECT u.id FROM users u WHERE u.id=? AND (${eligibleSql})
 AND (NOT EXISTS(SELECT 1 FROM user_items i WHERE i.user_id=u.id AND i.item_key='experience_module' AND i.quantity>0)
 OR NOT EXISTS(SELECT 1 FROM player_story_flags f WHERE f.user_id=u.id AND f.flag_key='experience_module_received' AND f.flag_value='true'))`,[userId]);
 if(!eligible)return false;
 return withTransaction(async c=>{await c.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[userId]);return grant(userId,c);});
}
async function eligibleUserIds(c=dbPool){const[rows]=await c.query(`SELECT u.id FROM users u WHERE ${eligibleSql}`);return rows.map(r=>r.id);}
async function setActive(userId,active){
 if(typeof active!=='boolean')throw Error('Choisis d’activer ou de désactiver le module.');
 return withTransaction(async c=>{
  await c.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[userId]);
  const state=await loadState(userId,c);if(!state.owned)throw Error('Tu ne possèdes pas le Module d’expérience.');
  await c.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)',[userId,ACTIVE_FLAG,String(active)]);
  return view(true,String(active));
 });
}
module.exports={grant,reconcile,loadState,setActive,eligibleUserIds};
