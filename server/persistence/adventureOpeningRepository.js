const { dbPool } = require('../config/database');
const { config } = require('../game/world/adventureOpening');

async function advance(userId, from, to) {
    const [result] = await dbPool.execute(
        `UPDATE player_story_flags SET flag_value=? WHERE user_id=? AND flag_key=? AND flag_value IN (${from.map(() => '?').join(',')})`,
        [to, userId, config.flag, ...from]
    );
    return result.affectedRows === 1;
}
const awaken = id => advance(id, ['sleeping'], 'awake');
const noteExit = id => advance(id, ['sleeping', 'awake'], 'outside');
const finishMother = id => advance(id, ['outside'], 'complete');
module.exports = { awaken, noteExit, finishMother };
