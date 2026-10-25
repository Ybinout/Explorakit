const {withTransaction} = require('../config/database');
const rules = require('../game/world/raphTrial');
const definition = require('../../data/game/progression.json').npcBattles.champion_raphael;

async function update(userId,player,move) {
    return withTransaction(async connection=>{
        const [[user]]=await connection.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[userId]);
        if(!user)throw Error('Joueur introuvable.');
        const [rows]=await connection.execute('SELECT flag_key,flag_value FROM player_story_flags WHERE user_id=? AND flag_key IN (?,?,?)',
            [userId,rules.config.flag,'raphael_defeated',`admin_arena_replay:${definition.battleKey}`]);
        const flags=Object.fromEntries(rows.map(r=>[r.flag_key,r.flag_value]));
        let state=rules.normalize(flags[rules.config.flag]);
        if(flags.raphael_defeated==='true'&&flags[`admin_arena_replay:${definition.battleKey}`]!=='ready')return {state:null,changed:false};
        const created=!state;
        state ||= rules.create(player);
        const result=move?rules.advance(state,player):{state,changed:false};
        if(created||result.changed)await connection.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)',
            [userId,rules.config.flag,JSON.stringify(result.state)]);
        return result;
    });
}
module.exports = {ensure:async(userId,player)=>(await update(userId,player,false)).state,advance:(userId,player)=>update(userId,player,true)};
