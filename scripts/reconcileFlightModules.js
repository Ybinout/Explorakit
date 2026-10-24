// Additive reconciliation only. Back up affected flags/items before --apply.
const fs=require('node:fs'),{dbPool}=require('../server/config/database');
const{reconcileFlightProgress}=require('../server/persistence/flightRepository');
(async()=>{try{
 const[users]=await dbPool.execute(`SELECT id FROM users u WHERE
   NOT EXISTS(SELECT 1 FROM player_story_flags f WHERE f.user_id=u.id AND f.flag_key='fly_module_received' AND f.flag_value='true')
   AND (EXISTS(SELECT 1 FROM player_story_flags f WHERE f.user_id=u.id AND f.flag_key='wanda_defeated' AND f.flag_value='true')
     OR EXISTS(SELECT 1 FROM user_npc_battles b WHERE b.user_id=u.id AND b.battle_key='story_champion_wanda')
     OR EXISTS(SELECT 1 FROM player_badges b WHERE b.user_id=u.id AND b.badge_key='tide_badge'))`);
 if(!process.argv.includes('--apply')){console.log(JSON.stringify({eligible:users.length,dryRun:true}));return;}
 const filename=process.argv[process.argv.indexOf('--backup')+1];if(!process.argv.includes('--backup')||!filename||filename.startsWith('--'))throw Error('--backup path required');
 const records=[];for(const{id}of users){const[flags]=await dbPool.execute('SELECT * FROM player_story_flags WHERE user_id=?',[id]);const[items]=await dbPool.execute("SELECT * FROM user_items WHERE user_id=? AND item_key='fly_module'",[id]);records.push({userId:id,flags,items});}
 fs.writeFileSync(filename,JSON.stringify({at:new Date().toISOString(),records}),{mode:0o600,flag:'wx'});
 let granted=0;for(const{id}of users)if(await reconcileFlightProgress(id))granted++;
 console.log(JSON.stringify({eligible:users.length,granted,backup:filename}));
}finally{await dbPool.end();}})().catch(error=>{console.error(error.message);process.exitCode=1;});
