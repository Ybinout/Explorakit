const {dbPool,withTransaction}=require('../config/database');
const KEY='gwenn_house_key', FLAG='gwenn_house_key_received';
async function grant(userId,connection) {
    // Permanent unique key: retries or legacy reconciliation never add a second copy.
    await connection.execute('INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,?,1) ON DUPLICATE KEY UPDATE quantity=GREATEST(quantity,1)',[userId,KEY]);
    await connection.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,'true') ON DUPLICATE KEY UPDATE flag_value='true'",[userId,FLAG]);
}
async function reconcile(userId) {
    const [[eligible]]=await dbPool.execute(`SELECT u.id FROM users u WHERE u.id=?
        AND NOT EXISTS(SELECT 1 FROM player_story_flags WHERE user_id=u.id AND flag_key=? AND flag_value='true')
        AND (EXISTS(SELECT 1 FROM player_story_flags WHERE user_id=u.id AND flag_key='wanda_defeated' AND flag_value='true')
        OR EXISTS(SELECT 1 FROM user_npc_battles WHERE user_id=u.id AND battle_key='story_champion_wanda')
        OR EXISTS(SELECT 1 FROM player_badges WHERE user_id=u.id AND badge_key='tide_badge'))`,[userId,FLAG]);
    if(!eligible)return false;
    return withTransaction(async connection=>{
        await connection.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[userId]);
        await grant(userId,connection);
        // A genuine historical receipt/badge also satisfies the encounter requirement.
        await connection.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,'wanda_defeated','true') ON DUPLICATE KEY UPDATE flag_value='true'",[userId]);
        return true;
    });
}
module.exports={grant,reconcile,KEY,FLAG};
