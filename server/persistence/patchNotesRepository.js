const { dbPool } = require('../config/database');
const latest = require('../../data/game/latest_patch.json');

// One small receipt per published patch, shared across devices. Reading never
// acknowledges it: a reload before closing the announcement must show it again.
const flag = `patch_seen:${latest.version}`;
async function unread(userId) {
    const [[seen]] = await dbPool.execute(
        'SELECT flag_value FROM player_story_flags WHERE user_id=? AND flag_key=?',
        [userId, flag]
    );
    return seen ? null : latest;
}
async function acknowledge(userId, version) {
    if (version !== latest.version) {
        const error = new Error('Cette annonce a été remplacée.');
        error.statusCode = 409;
        throw error;
    }
    await dbPool.execute(
        "INSERT IGNORE INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,'true')",
        [userId, flag]
    );
}
module.exports = { unread, acknowledge };
