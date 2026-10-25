const { dbPool } = require('../config/database');
const { scenes } = require('../game/world/arenaScenes');
async function acknowledge(userId, name) {
    const scene = scenes.find(s => s.name === name);
    if (!scene) return;
    await dbPool.execute('INSERT IGNORE INTO player_story_flags (user_id, flag_key, flag_value) VALUES (?, ?, ?)', [userId, scene.flag, 'true']);
}
module.exports = { acknowledge };
