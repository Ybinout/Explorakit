const {dbPool,withTransaction} = require('../config/database');
const RECEIPT = 'hoze_exp_share_received';
// Caller owns the user lock. Existing drops, held items, PC items and historical
// discoveries count: the unique reward must never produce a second copy.
async function grantHozeExpShare(userId, connection) {
    const [[receipt]] = await connection.execute('SELECT flag_value FROM player_story_flags WHERE user_id=? AND flag_key=?',[userId,RECEIPT]);
    if (receipt) return false;
    const [owned] = await connection.execute(`SELECT item_key FROM user_items WHERE user_id=? AND item_key='exp_share' AND quantity>0
        UNION SELECT item_key FROM user_item_discoveries WHERE user_id=? AND item_key='exp_share'
        UNION SELECT p.held_item FROM pokemons p JOIN teams t ON t.id=p.team_id WHERE t.user_id=? AND p.held_item='exp_share'
        UNION SELECT 'exp_share' FROM pokemon_storage WHERE user_id=? AND JSON_UNQUOTE(COALESCE(JSON_EXTRACT(pokemon_data,'$.held_item'),JSON_EXTRACT(pokemon_data,'$.heldItem')))='exp_share'`,[userId,userId,userId,userId]);
    if (!owned.length) await connection.execute("INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,'exp_share',1) ON DUPLICATE KEY UPDATE quantity=quantity+1",[userId]);
    await connection.execute("INSERT IGNORE INTO user_item_discoveries(user_id,item_key) VALUES(?,'exp_share')",[userId]);
    await connection.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,'true')",[userId,RECEIPT]);
    return !owned.length;
}
async function reconcileHozeExpShare(userId) {
    const [[eligible]] = await dbPool.execute(`SELECT u.id FROM users u WHERE u.id=?
        AND NOT EXISTS(SELECT 1 FROM player_story_flags WHERE user_id=u.id AND flag_key=?)
        AND (EXISTS(SELECT 1 FROM player_story_flags WHERE user_id=u.id AND flag_key='hoze_defeated' AND flag_value='true')
          OR EXISTS(SELECT 1 FROM user_npc_battles WHERE user_id=u.id AND battle_key='story_champion_hoze'))`,[userId,RECEIPT]);
    if (!eligible) return false;
    return withTransaction(async connection=>{
        await connection.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[userId]);
        return grantHozeExpShare(userId,connection);
    });
}
module.exports={grantHozeExpShare,reconcileHozeExpShare};
