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
        if (champions.some(c=>c.name==='lucie_route2')) for (const obstacle of require('../game/world/roomObstacles').obstacles.filter(o=>o.map==='route2_maison')) {
            await connection.execute('DELETE FROM player_story_flags WHERE user_id=? AND flag_key=?',
                [owner.id,require('../game/world/testReplayState').obstacleFlag(obstacle)]);
        }
        if(champions.some(c=>c.name==='lucie_route2'))await connection.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,'armed') ON DUPLICATE KEY UPDATE flag_value='armed'",[owner.id,require('../game/world/lucieDeparture').config.adminFlag]);
        if(champions.some(c=>c.name==='professor_story')){
            for(const [key,value]of [['admin_professor_departure','armed'],['admin_lab_rescued','false']])await connection.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)',[owner.id,key,value]);
            for(const o of require('../game/world/roomObstacles').obstacles.filter(o=>o.map==='professor_lab'))await connection.execute('DELETE FROM player_story_flags WHERE user_id=? AND flag_key=?',[owner.id,require('../game/world/testReplayState').obstacleFlag(o)]);
            if(champions.some(c=>c.name==='lucie_route2')&&progress.flags.lucie_rescued==='true'){
                const values={admin_finale_replay:'full',admin_lucie_house_exited:'false',admin_professor_lead:'false',admin_lab_door_inspected:'false',admin_professor_lab_key:'false'};
                for(const[key,value]of Object.entries(values))await connection.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value)VALUES(?,?,?) ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)',[owner.id,key,value]);
            }
        }
        await connection.execute('DELETE FROM player_story_flags WHERE user_id=? AND flag_key=?',[owner.id,require('../game/world/arenaCollapse').config.flag]);
        if(champions.some(c=>c.name==='champion_raphael'))await connection.execute('DELETE FROM player_story_flags WHERE user_id=? AND flag_key=?',[owner.id,require('../game/world/raphTrial').config.flag]);
        return {count:champions.length};
    });
}
async function complete(user, name) {
    const champion = policy.encounters.find(c=>c.name===name);
    if (!champion) throw Error('Rencontre de test inconnue.');
    return authorizedTransaction(user, async (connection, owner) => {
        await connection.execute("DELETE FROM player_story_flags WHERE user_id=? AND flag_key=? AND flag_value='ready'",[owner.id,champion.flag]);
        if(name==='lucie_route2')await connection.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,'pending') ON DUPLICATE KEY UPDATE flag_value='pending'",[owner.id,require('../game/world/lucieDeparture').config.adminFlag]);
        if(name==='professor_story')await connection.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,'pending') ON DUPLICATE KEY UPDATE flag_value='pending'",[owner.id,require('../game/world/lucieDeparture').professor.adminFlag]);
    });
}
module.exports = { rearm, complete };
