const {dbPool,withTransaction}=require('../config/database');
const {VISIT_PREFIX,townForMap,flightState}=require('../game/world/flightTravel');
const victories=[['moonpunch_defeated','moonpunch_ville1','ville1','lake_badge'],['hoze_defeated','story_champion_hoze','ville_safe1','dune_badge'],['raphael_defeated','story_champion_raphael','gen_ville5','bloom_badge'],['ana_defeated','story_champion_ana','ville3','ore_badge'],['wanda_defeated','story_champion_wanda','ville4','tide_badge'],['sevenp_defeated','story_champion_7p','ville5','summit_badge']];
async function reconcileFlightProgress(userId){
    return withTransaction(async connection=>{
        await connection.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[userId]);
        const[rows]=await connection.execute('SELECT flag_key,flag_value FROM player_story_flags WHERE user_id=?',[userId]);
        const[battles]=await connection.execute('SELECT battle_key FROM user_npc_battles WHERE user_id=?',[userId]);
        const[badges]=await connection.execute('SELECT badge_key FROM player_badges WHERE user_id=?',[userId]);
        const earned=new Set(badges.map(r=>r.badge_key));
        const flags=Object.fromEntries(rows.map(r=>[r.flag_key,r.flag_value])),won=new Set(battles.map(r=>r.battle_key));
        // Legacy saves have no complete travel history. Only reconstruct proven
        // visits, never grant optional/future towns merely for owning the module.
        for(const town of ['start',...victories.filter(([flag,battle,,badge])=>flags[flag]==='true'||won.has(battle)||earned.has(badge)).map(v=>v[2])]){
            if(flags[VISIT_PREFIX+town]==='true')continue;
            await connection.execute("INSERT IGNORE INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,'true')",[userId,VISIT_PREFIX+town]);
        }
        if(flags.fly_module_received==='true'||!victories.slice(2).some(([flag,battle,,badge])=>flags[flag]==='true'||won.has(battle)||earned.has(badge)))return false;
        await connection.execute("INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,'fly_module',1) ON DUPLICATE KEY UPDATE quantity=GREATEST(quantity,1)",[userId]);
        await connection.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,'fly_module_received','true') ON DUPLICATE KEY UPDATE flag_value='true'",[userId]);
        return true;
    });
}
async function recordTownVisit(userId,map,returnPoint){
    const town=townForMap(map,returnPoint);if(!town)return false;
    const[result]=await dbPool.execute("INSERT IGNORE INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,'true')",[userId,VISIT_PREFIX+town]);
    return result.affectedRows>0;
}
async function loadFlightState(userId){
    const[rows]=await dbPool.execute('SELECT flag_key,flag_value FROM player_story_flags WHERE user_id=?',[userId]);
    return flightState(Object.fromEntries(rows.map(r=>[r.flag_key,r.flag_value])));
}
module.exports={reconcileFlightProgress,recordTownVisit,loadFlightState};
