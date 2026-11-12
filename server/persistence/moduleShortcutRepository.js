const {dbPool,withTransaction}=require('../config/database');
const MODULE_KEYS=Object.freeze(['mysterious_speed_module','experience_module','fly_module','professional_trainer_card','super_tournament_pass','void_teleporter','dark_aerial_module']);
const FLAG='module_shortcut';
async function load(userId,c=dbPool) {
    const [[row]]=await c.execute('SELECT f.flag_value AS item_key FROM player_story_flags f JOIN user_items i ON i.user_id=f.user_id AND i.item_key=f.flag_value AND i.quantity>0 WHERE f.user_id=? AND f.flag_key=?',[userId,FLAG]);
    return {itemKey:MODULE_KEYS.includes(row?.item_key)?row.item_key:null};
}
async function assign(userId,itemKey) {
    if(itemKey!==null&&!MODULE_KEYS.includes(itemKey))throw Error('Choisis un module de ton sac.');
    return withTransaction(async c=>{
        await c.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[userId]);
        if(itemKey!==null){
            const items=await require('./itemRepository').loadUserItems(userId,c),item=items.find(i=>i.key===itemKey&&i.quantity>0);
            if(!item||item.voidTravel&&!item.usable)throw Error('Ce module n’est pas disponible.');
            await c.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)',[userId,FLAG,itemKey]);
        }else await c.execute('DELETE FROM player_story_flags WHERE user_id=? AND flag_key=?',[userId,FLAG]);
        return {itemKey};
    });
}
module.exports={MODULE_KEYS,load,assign};
