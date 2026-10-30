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

 test('abandonment durably returns to the shared Center and preserves its own city exit, Adventure team and score even if map delivery fails',async()=>{
  const {TournamentController}=require('../server/game/superTournament/controller'),factory=require('../server/game/drift/pokemonFactory');
  const teams=require('../server/persistence/teamRepository'),players=require('../server/persistence/playerRepository');
  const codec=require('../server/game/drift/checkpointCodec'),{getPokemonCenterExit}=require('../server/game/world/pokemonCenterTravel');
  for(const origin of [{map:'ville1',x:496,y:304},{map:'route4',x:720,y:144},{map:'ville5',x:144,y:240}]){
   const [created]=await db.execute("INSERT INTO users(username,password_hash,map,x,y,center_return_map,center_return_x,center_return_y) VALUES(?,?,'super_tournament_room',448,496,?,?,?)",['exit_'+randomUUID(),'test',origin.map,origin.x,origin.y]);const userId=created.insertId;
   try{
    const realTeam={pokemons:[9,94].map(id=>factory.create(id,100,true))};await teams.editEquipe(userId,realTeam);const before=codec.encode(await teams.loadEquipe(userId));
    const create=()=>new TournamentController({userId,getPlayer:()=>({id:'sql-exit',username:'sql-exit',centerReturnPoint:origin}),emit:()=>{},travel:async()=>{throw Error('map delivery lost');}});
    const c=create();await c.load();await c.register(realTeam);await c.next();await c.atomic(()=>c.startBattle());
    await c.atomic(()=>{const b=c.run.battle;b.b.equipe.pokemons[0].currentHp=0;b.prune();c.reconcile();});assert.equal(c.run.score,100);
    await assert.rejects(()=>c.abandon(),/map delivery lost/);
    const saved=await players.loadUserPosition(userId);assert.equal(saved.map,'centre');assert.equal(saved.x,304);assert.equal(saved.y,432);
    assert.deepEqual(saved.centerReturnPoint,origin);assert.deepEqual(getPokemonCenterExit(saved.centerReturnPoint),origin);
    assert.equal((await repo.load(userId)).run,null);assert.equal(Number((await repo.leaderboard(userId)).personal.score),100);
    assert.deepEqual(codec.encode(await teams.loadEquipe(userId)),before);
    const resumed=create();await resumed.load();assert.equal(resumed.active,false);
   }finally{await db.execute('DELETE FROM users WHERE id=?',[userId]);}
  }
 });
 test('stale finalization rolls back the Center position and cannot erase another controller’s run',async()=>{
  const [created]=await db.execute("INSERT INTO users(username,password_hash,map,x,y) VALUES(?,?,'super_tournament_room',448,496)",['exit_stale_'+randomUUID(),'test']);const userId=created.insertId;
  try{
   const v=await repo.save(userId,{score:200,cleared:1},0);
   await assert.rejects(()=>repo.save(userId,null,0,{score:9999,rooms:99,returnToCenter:true}),/tentative a changé/);
   const [[position]]=await db.execute('SELECT map,x,y FROM users WHERE id=?',[userId]);assert.deepEqual(position,{map:content.MAPS.room,x:448,y:496});
   assert.equal((await repo.load(userId)).run.score,200);
   await repo.save(userId,null,v,{score:200,rooms:1,returnToCenter:true});
   assert.equal(Number((await repo.leaderboard(userId)).personal.score),200);
  }finally{await db.execute('DELETE FROM users WHERE id=?',[userId]);}
 });
}
