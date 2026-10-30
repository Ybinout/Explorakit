const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
if(process.env.RUN_MYSQL_TESTS!=='1')test('Super Tournoi SQL (dedicated database required)',{skip:true},()=>{});
else {
 if(process.env.DB_NAME!=='explorakit_test')throw Error('Dedicated test database required');
 const {dbPool:db}=require('../server/config/database'),repo=require('../server/persistence/superTournamentRepository'),content=require('../server/game/superTournament/content');
 let id,other;
 test.before(async()=>{for(const name of ['tour','other']){const[r]=await db.execute("INSERT INTO users(username,password_hash,map,x,y) VALUES(?,?,'start',176,304)",[name+'_'+randomUUID(),'test']);if(name==='tour')id=r.insertId;else other=r.insertId;}});
 test.after(async()=>{for(const uid of [id,other])if(uid)await db.execute('DELETE FROM users WHERE id=?',[uid]);await db.end();});
 test('pass eligibility, unique grant and owner-scoped inventory',async()=>{assert.equal(await repo.grantPass(id),false);await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,'mirror_stage','complete')",[id]);assert.equal(await repo.grantPass(id),true);assert.equal(await repo.grantPass(id),false);assert.equal(await repo.ownsPass(id),true);assert.equal(await repo.ownsPass(other),false);const [[r]]=await db.execute('SELECT quantity FROM user_items WHERE user_id=? AND item_key=?',[id,content.PASS]);assert.equal(r.quantity,1);});
 test('compressed snapshots, optimistic version and monotonic personal score',async()=>{let row=await repo.load(id);assert.equal(row.run,null);let v=await repo.save(id,{score:100,cleared:0,credited:new Set(['0:0'])},row.version);row=await repo.load(id);assert.equal(row.run.score,100);assert.deepEqual([...row.run.credited],['0:0']);await assert.rejects(()=>repo.save(id,{score:9999},0));v=await repo.save(id,null,v,{score:300,rooms:1});await repo.save(id,null,v,{score:100,rooms:0});const rank=await repo.leaderboard(id);assert.equal(Number(rank.personal.score),300);assert.ok(rank.rows.some(r=>r.id===id&&r.self));assert.equal((await repo.load(other)).run,null);assert.equal((await repo.load(other)).best,0);});
}
