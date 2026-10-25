const {dbPool,withTransaction}=require('../config/database');
const KEY='gwenn_house_key', FLAG='gwenn_house_key_received';
async function grant(userId,connection) {
    // Permanent unique key: retries or legacy reconciliation never add a second copy.
    await connection.execute('INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,?,1) ON DUPLICATE KEY UPDATE quantity=GREATEST(quantity,1)',[userId,KEY]);
    await connection.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,'true') ON DUPLICATE KEY UPDATE flag_value='true'",[userId,FLAG]);
}
async function evidence(userId,executor) {
    const [[row]]=await executor.execute(`SELECT
        EXISTS(SELECT 1 FROM player_story_flags WHERE user_id=u.id AND flag_key='wanda_defeated' AND flag_value='true') AS wandaFlag,
        (EXISTS(SELECT 1 FROM user_npc_battles WHERE user_id=u.id AND battle_key='story_champion_wanda')
        OR EXISTS(SELECT 1 FROM player_badges WHERE user_id=u.id AND badge_key='tide_badge')) AS wandaProof,
        EXISTS(SELECT 1 FROM player_story_flags WHERE user_id=u.id AND flag_key=? AND flag_value='true') AS keyFlag,
        EXISTS(SELECT 1 FROM user_items WHERE user_id=u.id AND item_key=? AND quantity>0) AS keyItem,
        (EXISTS(SELECT 1 FROM player_story_flags WHERE user_id=u.id AND flag_key='gwenn_rochebrume_defeated' AND flag_value='true')
        OR EXISTS(SELECT 1 FROM user_npc_battles WHERE user_id=u.id AND battle_key='story_gwenn_rochebrume')) AS gwennWin
        FROM users u WHERE u.id=?`,[FLAG,KEY,userId]);
    return row;
}
const needsWanda=row=>row&&!row.wandaFlag&&row.wandaProof;
const needsKey=row=>row&&(row.keyFlag||row.keyItem||row.gwennWin)&&(!row.keyFlag||!row.keyItem);
async function reconcile(userId) {
    const before=await evidence(userId,dbPool);
    if(!needsWanda(before)&&!needsKey(before))return false;
    return withTransaction(async connection=>{
        // Use the same user lock as story rewards; recheck after concurrent handovers.
        await connection.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[userId]);
        const row=await evidence(userId,connection);
        // Historical Wanda wins unlock the dialogue, never a new key.
        if(needsWanda(row))await connection.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,'wanda_defeated','true') ON DUPLICATE KEY UPDATE flag_value='true'",[userId]);
        // Preserve already received keys and completed Gwenn saves.
        if(needsKey(row))await grant(userId,connection);
        return Boolean(needsWanda(row)||needsKey(row));
    });
}
module.exports={grant,reconcile,KEY,FLAG};
