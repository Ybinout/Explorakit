const { withTransaction } = require('../config/database');
const policy = require('../game/world/arenaTests');

async function authorizedTransaction(user, work) {
    if (!policy.isOwner(user)) throw Error('Accès réservé au compte de test.');
    return withTransaction(async connection => {
        const [[owner]] = await connection.execute('SELECT id,username FROM users WHERE id=? FOR UPDATE',[user.id]);
        if (!policy.isOwner(owner)) throw Error('Accès réservé au compte de test.');
        return work(connection, owner);
    });
}
async function rearm(user) {
    return authorizedTransaction(user, async (connection, owner) => {
        const [flags] = await connection.execute('SELECT flag_key,flag_value FROM player_story_flags WHERE user_id=?',[owner.id]);
        const [battles] = await connection.execute('SELECT battle_key FROM user_npc_battles WHERE user_id=?',[owner.id]);
        const progress = {flags:Object.fromEntries(flags.map(f=>[f.flag_key,f.flag_value])),completedNpcBattles:battles.map(b=>({battleKey:b.battle_key}))};
        const champions = policy.eligible(owner, progress);
        for (const champion of champions) await connection.execute(
            "INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,'ready') ON DUPLICATE KEY UPDATE flag_value='ready'",
            [owner.id,champion.flag]);
        for (const scene of require('../game/world/arenaScenes').scenes.filter(s=>champions.some(c=>c.name===s.champion))) {
            await connection.execute('DELETE FROM player_story_flags WHERE user_id=? AND flag_key=?',[owner.id,scene.flag]);
        }
        if (champions.some(c=>c.name==='lucie_route2')) for (const obstacle of require('../game/world/roomObstacles').obstacles) {
            await connection.execute('DELETE FROM player_story_flags WHERE user_id=? AND flag_key=?',
                [owner.id,require('../game/world/testReplayState').obstacleFlag(obstacle)]);
        }
        await connection.execute('DELETE FROM player_story_flags WHERE user_id=? AND flag_key=?',[owner.id,require('../game/world/arenaCollapse').config.flag]);
        return {count:champions.length};
    });
}
async function complete(user, name) {
    const champion = policy.encounters.find(c=>c.name===name);
    if (!champion) throw Error('Rencontre de test inconnue.');
    return authorizedTransaction(user, async (connection, owner) => {
        await connection.execute("DELETE FROM player_story_flags WHERE user_id=? AND flag_key=? AND flag_value='ready'",[owner.id,champion.flag]);
    });
}
module.exports = { rearm, complete };
