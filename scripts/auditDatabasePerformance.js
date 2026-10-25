// Read-only production diagnostics: aggregate metadata, no player identities.
const {dbPool:db}=require('../server/config/database');
(async()=>{try{
 const [variables]=await db.query("SHOW GLOBAL VARIABLES WHERE Variable_name IN ('innodb_buffer_pool_size','innodb_flush_log_at_trx_commit','sync_binlog','performance_schema','slow_query_log','long_query_time')");
 const [status]=await db.query("SHOW GLOBAL STATUS WHERE Variable_name IN ('Threads_connected','Threads_running','Slow_queries','Questions','Innodb_buffer_pool_reads','Innodb_buffer_pool_read_requests','Innodb_row_lock_waits','Innodb_row_lock_time')");
 const [tables]=await db.execute('SELECT TABLE_NAME,TABLE_ROWS,DATA_LENGTH,INDEX_LENGTH FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() ORDER BY DATA_LENGTH+INDEX_LENGTH DESC');
 const [indexes]=await db.execute('SELECT TABLE_NAME,INDEX_NAME,GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() GROUP BY TABLE_NAME,INDEX_NAME ORDER BY TABLE_NAME,INDEX_NAME');
 const plans=[];for(const query of ['SELECT * FROM pokemons WHERE team_id=1 ORDER BY position','SELECT flag_key,flag_value FROM player_story_flags WHERE user_id=1','SELECT uuid,box_index,slot_index,pokemon_data FROM pokemon_storage WHERE user_id=1 ORDER BY box_index,slot_index','SELECT id,score,wins,finished_at FROM colosseum_runs WHERE user_id=1 ORDER BY finished_at DESC LIMIT 20']){const [plan]=await db.query('EXPLAIN '+query);plans.push({query,plan});}
 console.log(JSON.stringify({at:new Date().toISOString(),variables,status,tables,indexes,plans,estimatedTableRows:true,readOnly:true},null,2));
}finally{await db.end();}})().catch(e=>{console.error(e.message);process.exitCode=1});
