const { withTransaction } = require('../config/database');
const obstacles = require('../game/world/roomObstacles');
const replay = require('../game/world/testReplayState');
const lab = require('../game/world/labStory');
const policy = require('../game/world/arenaTests');

// A transaction records exactly one real action, never a timed series of hits.
async function strike(userId, player, isCurrent) {
    return withTransaction(async connection => {
        const [[owner]] = await connection.execute('SELECT id,username FROM users WHERE id=? FOR UPDATE', [userId]);
        if (!owner || !isCurrent()) return null;
        const [flags] = await connection.execute('SELECT flag_key,flag_value FROM player_story_flags WHERE user_id=?', [userId]);
        const [battles] = await connection.execute('SELECT battle_key FROM user_npc_battles WHERE user_id=?', [userId]);
        const progress = { flags: Object.fromEntries(flags.map(f => [f.flag_key, f.flag_value])),
            completedNpcBattles: battles.map(b => ({ battleKey: b.battle_key })) };
        progress.testReplays = policy.eligible(owner, progress).filter(c => progress.flags[c.flag] === 'ready').map(c => c.name);
        const obstacle = obstacles.nearby(player, progress);
        if (!obstacle || !isCurrent()) return null;
        if (obstacle.requiresFlag && (lab.view(progress).flags[obstacle.requiresFlag] !== 'true' || replay.active(progress, 'professor_story')))
            return { blocked: obstacle.requiresMessage || obstacle.blockedMessage };
        const hits = obstacles.hitCount(obstacle, progress) + 1;
        await connection.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)',
            [userId, obstacles.hitFlag(obstacle, progress), String(hits)]);
        if (hits === 10) await connection.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,'true') ON DUPLICATE KEY UPDATE flag_value='true'",
            [userId, obstacles.progressFlag(obstacle, progress)]);
        return { obstacle, hits };
    });
}

module.exports = { strike };
