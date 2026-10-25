const { withTransaction } = require('../config/database');
const { config } = require('../game/world/arenaCollapse');
async function ensure(userId) {
    return withTransaction(async connection => {
        const [[user]] = await connection.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[userId]);
        if (!user) throw Error('Joueur introuvable.');
        const [[row]] = await connection.execute('SELECT flag_value FROM player_story_flags WHERE user_id=? AND flag_key=?',[userId,config.flag]);
        const stored = Number(row?.flag_value), now = Date.now();
        if (Number.isSafeInteger(stored) && stored > 0 && stored <= now) return stored;
        await connection.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)',[userId,config.flag,String(now)]);
        return now;
    });
}
module.exports = { ensure };
