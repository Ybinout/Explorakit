const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const enabled=process.env.RUN_MYSQL_TESTS==='1'&&process.env.DB_NAME==='explorakit_test';
if(!enabled)test('quest journal SQL requires the dedicated test database',{skip:true},()=>{});
else {
 const{dbPool:db}=require('../server/config/database'),repo=require('../server/persistence/questJournalRepository'),users=require('../server/persistence/userRepository'),progress=require('../server/persistence/progressionRepository');
 const accounts=[];
 test.after(async()=>{for(const id of accounts)await db.execute('DELETE FROM users WHERE id=?',[id]);await db.end();});
 async function create(){const u=await users.createUserWithStarter('Journal_'+randomUUID().slice(0,8),randomUUID());accounts.push(u.id);return u.id;}
 async function flags(id,entries){for(const[k,v]of Object.entries(entries))await db.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)',[id,k,String(v)]);}
 const active=j=>j.entries.filter(e=>e.status==='active').map(e=>e.key);
 test('initialization is idempotent, creates only released quests, and preserves account assets',async()=>{
  const id=await create(),[[money]]=await db.execute('SELECT money FROM users WHERE id=?',[id]),[before]=await db.execute('SELECT p.* FROM pokemons p JOIN teams t ON t.id=p.team_id WHERE t.user_id=?',[id]);
  const a=await repo.reconcile(id),b=await repo.reconcile(id);assert.deepEqual(a,b);assert.deepEqual(active(a),['journal_wayne']);assert.equal(a.unreadCount,1);
  const[rows]=await db.execute('SELECT quest_key FROM player_quests WHERE user_id=? AND quest_key LIKE ?', [id,'journal_%']);assert.deepEqual(rows.map(r=>r.quest_key),['journal_wayne']);
  assert.deepEqual((await db.execute('SELECT p.* FROM pokemons p JOIN teams t ON t.id=p.team_id WHERE t.user_id=?',[id]))[0],before);assert.equal((await db.execute('SELECT money FROM users WHERE id=?',[id]))[0][0].money,money.money);
 });
 test('read state is durable and only the next real objective triggers another unread marker',async()=>{
  const id=await create();await repo.reconcile(id);let j=await repo.markRead(id,['journal_wayne']);assert.equal(j.unreadCount,0);assert(j.entries[0].updatedAt);
  j=await repo.reconcile(id);assert.equal(j.unreadCount,0);
  await flags(id,{route_guard_defeated:'true'});j=await repo.reconcile(id);assert.deepEqual(active(j),['journal_aspha']);assert.equal(j.unreadCount,1);assert(j.entries.find(e=>e.key==='journal_wayne').completedAt);
  await repo.markRead(id,['journal_aspha']);assert.equal((await repo.reconcile(id)).unreadCount,0);
 });
 test('future/arbitrary keys cannot be acknowledged and other accounts are untouched',async()=>{
  const a=await create(),b=await create();await repo.reconcile(a);await repo.reconcile(b);
  await assert.rejects(()=>repo.markRead(a,['journal_sevenp']),/pas encore/);await assert.rejects(()=>repo.markRead(a,['professor_defeated']),/invalides/);await assert.rejects(()=>repo.markRead(a,'all'),/invalides/);
  await repo.markRead(a,['journal_wayne']);assert.equal((await repo.reconcile(b)).unreadCount,1);
 });
 test('parallel reads and reconciliation never duplicate or reopen a completed quest',async()=>{
  const id=await create();await flags(id,{route_guard_defeated:'true'});await repo.reconcile(id);
  await Promise.all(Array.from({length:6},(_,i)=>i%2?repo.reconcile(id):repo.markRead(id,['journal_aspha'])));
  const j=await repo.reconcile(id);assert.equal(j.unreadCount,0);assert(j.entries.find(e=>e.key==='journal_wayne').completedAt);
  const[rows]=await db.execute('SELECT quest_key,COUNT(*) n FROM player_quests WHERE user_id=? GROUP BY quest_key',[id]);assert(rows.every(r=>Number(r.n)===1));
 });
 test('legacy arena receipts reconcile the full order without paying rewards or replaying fights',async()=>{
  const id=await create();await flags(id,{sevenp_defeated:'true'});const[[before]]=await db.execute('SELECT money FROM users WHERE id=?',[id]);
  let j=await repo.reconcile(id);assert.deepEqual(active(j),['journal_lucie']);assert.equal(j.entries.filter(e=>e.status==='completed').length,11);assert(j.entries.find(e=>e.key==='journal_comptoir').completedAt);
  j=await repo.reconcile(id);assert.deepEqual(active(j),['journal_lucie']);assert.equal((await db.execute('SELECT money FROM users WHERE id=?',[id]))[0][0].money,before.money);
  const[badges]=await db.execute('SELECT * FROM player_badges WHERE user_id=?',[id]);assert.equal(badges.length,0);
 });
 test('new saves keep the shopping objective until an actual tower visit, then continue with Ana',async()=>{
  const id=await create();await repo.reconcile(id);await flags(id,{raphael_defeated:'true'});let j=await repo.reconcile(id);assert.deepEqual(active(j),['journal_comptoir']);
  await repo.noteVisit(id,'ville_commerciale');assert.deepEqual(active(await repo.reconcile(id)),['journal_comptoir']);
  assert(await repo.noteVisit(id,'tour_etage1'));assert(!await repo.noteVisit(id,'tour_etage1'));j=await repo.reconcile(id);assert.deepEqual(active(j),['journal_ana']);
  const p=await progress.loadProgressState(id);assert.equal(p.objective.title,'Défier Ana – Arène 4');assert.equal(p.journal.version,1);assert(p.quests.some(q=>q.key==='main_sister_search'));
 });
 test('rescue, pickup, use and either ending advance separate persisted objectives',async()=>{
  const id=await create();await flags(id,{professor_defeated:'true'});let j=await repo.reconcile(id);assert.deepEqual(active(j),['journal_rescue']);
  await flags(id,{lucie_rescued:'true'});j=await repo.reconcile(id);assert.deepEqual(active(j),['journal_teleporter']);
  assert(await require('../server/persistence/voidEndingRepository').pickup(id));j=await repo.reconcile(id);assert.deepEqual(active(j),['journal_teleporter_use']);
  await repo.noteVisit(id,'void_arena');j=await repo.reconcile(id);assert.deepEqual(active(j),['journal_finale']);
  await flags(id,{void_charge:'5'});assert(await require('../server/persistence/voidEndingRepository').resolveOutcome(id,'pardon'));j=await repo.reconcile(id);assert.deepEqual(active(j),['journal_rift']);
  assert(await require('../server/persistence/voidEndingRepository').acknowledgePardon(id));assert(!await require('../server/persistence/voidEndingRepository').acknowledgeFinalWords(id));
  await flags(id,{mirror_stage:'complete'});j=await repo.reconcile(id);assert.deepEqual(active(j),[]);
 });
 test('the final warning is acknowledged once and admin replays can replay it without erasing the real journal',async()=>{
  const id=await create(),ending=require('../server/persistence/voidEndingRepository');await flags(id,{lucie_rescued:'true'});await ending.pickup(id);await flags(id,{void_charge:'5'});await ending.resolveOutcome(id,'violence');
  assert(await ending.acknowledgeFinalWords(id));assert(!await ending.acknowledgeFinalWords(id));assert((await ending.read(id)).state.finalWordsSeen);
  const c=await db.getConnection();try{await ending.resetReplay(c,id);}finally{c.release();}
  const j=await repo.reconcile(id);assert.deepEqual(active(j),['journal_rift']);
 });
 test('new NPCs only grant their quest after a genuine completed story dialogue and elite uses the old best record',async()=>{
  const id=await create();let c=await progress.completeStoryEvent(id,'super_elite_mentor');assert(!c.granted);
  await flags(id,{super_tournament_invited:'true'});await db.execute("INSERT INTO super_tournament_profiles(user_id,best_rooms) VALUES(?,32)",[id]);
  c=await progress.completeStoryEvent(id,'super_elite_mentor');assert(c.granted);const q=c.progress.journal.entries.find(q=>q.key==='journal_super_elite');assert.equal(q.status,'completed');assert.equal(q.progress,32);
  assert(!(await progress.completeStoryEvent(id,'super_elite_mentor')).granted);
  await db.execute("INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,'professional_trainer_card',1)",[id]);await repo.noteVisit(id,'jungle9');
  c=await progress.completeStoryEvent(id,'dark_horizon_explorer');assert(c.granted);assert.equal(c.progress.journal.entries.find(q=>q.key==='journal_dark_research').status,'completed');assert(!(await progress.completeStoryEvent(id,'dark_horizon_explorer')).granted);
 });
}
