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
 test('persisted reward is stable across owners/reconnect, claimed once despite a stale controller',async()=>{
  const {TournamentController}=require('../server/game/superTournament/controller'),factory=require('../server/game/drift/pokemonFactory');
  const create=()=>new TournamentController({userId:other,getPlayer:()=>({id:'sql-test',username:'sql-test'}),emit:()=>{},travel:async()=>{}});
  const c=create();await c.load();await c.register({pokemons:[factory.create(9,85,true)]});await c.atomic(()=>{const p=c.run.player.equipe.pokemons[0];p.currentHp=1;c.run.phase='reward';c.run.score=4800;c.run.cleared=16;c.run.room=15;c.run.reward={id:'sql-offer',afterRoom:16,cards:['heal_10','pp_3','revive_50']};});
  const a=create(),b=create();await a.load();await b.load();assert.deepEqual(a.run.reward,b.run.reward);const uuid=a.run.player.equipe.pokemons[0].uuid;
  await assert.rejects(()=>a.claimReward({offerId:'sql-offer',cardKey:'full_reset',pokemonUuid:uuid}));
  const data={offerId:'sql-offer',cardKey:'heal_10',pokemonUuid:uuid};await a.claimReward(data);await assert.rejects(()=>b.claimReward(data),/tentative a changé/);
  const loaded=await repo.load(other);assert.equal(loaded.run.phase,'cleared');assert.equal(loaded.run.reward,null);assert.equal(loaded.run.player.equipe.pokemons[0].currentHp,1+Math.floor(loaded.run.player.equipe.pokemons[0].maxHp*.1));
  await b.load();await assert.rejects(()=>b.claimReward(data));await b.next();assert.equal(content.state(b.run).cycle,2);assert.equal(content.state(b.run).opponent,'Wayne');await b.abandon();
 });
 test('endless leaderboard stores more than 65535 rooms and 32-bit points without losing existing records',async()=>{const current=await repo.load(other);await repo.save(other,null,current.version,{score:5000000000,rooms:70000});const rank=await repo.leaderboard(other);assert.equal(Number(rank.personal.score),5000000000);assert.equal(Number(rank.personal.rooms),70000);assert.equal(Number((await repo.leaderboard(id)).personal.score),300);});
}
