const {dbPool,withTransaction} = require('../config/database');
const loot = require('../game/items/wildLoot');
async function hasExpShare(userId) {
    const [[row]] = await dbPool.execute("SELECT EXISTS(SELECT 1 FROM user_items WHERE user_id=? AND item_key='exp_share' AND quantity>0) AS owned", [userId]);
    return Boolean(row.owned);
}
async function awardWildLoot(userId, random = Math.random) {
    if (random() >= loot.CHANCE) return null;
    return withTransaction(async c => {
        const [[owner]] = await c.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[userId]);
        if (!owner) throw Error('Joueur introuvable.');
        const [found] = await c.execute(`SELECT item_key FROM user_item_discoveries WHERE user_id=?
            UNION SELECT item_key FROM user_items WHERE user_id=? AND quantity>0
            UNION SELECT p.held_item FROM pokemons p JOIN teams t ON t.id=p.team_id WHERE t.user_id=? AND p.held_item IS NOT NULL
            UNION SELECT JSON_UNQUOTE(COALESCE(JSON_EXTRACT(pokemon_data,'$.held_item'),JSON_EXTRACT(pokemon_data,'$.heldItem'))) FROM pokemon_storage WHERE user_id=?`,[userId,userId,userId,userId]);
        const claimed = new Set(found.map(r => r.item_key));
        const existing = loot.uniqueKeys.filter(key => claimed.has(key));
        if (existing.length) await c.execute(`INSERT IGNORE INTO user_item_discoveries(user_id,item_key) VALUES ${existing.map(()=>'(?,?)').join(',')}`,
            existing.flatMap(key => [userId,key]));
        const item = loot.select(claimed,random);
        if (!item) return null;
        if (item.unique) await c.execute('INSERT INTO user_item_discoveries(user_id,item_key) VALUES(?,?)',[userId,item.key]);
        await c.execute('INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,?,1) ON DUPLICATE KEY UPDATE quantity=quantity+1',[userId,item.key]);
        return item;
    });
}
module.exports = {awardWildLoot,hasExpShare};
