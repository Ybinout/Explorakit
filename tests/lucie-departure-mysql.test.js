const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const enabled=process.env.RUN_MYSQL_TESTS==='1';
if(enabled&&!/test/i.test(process.env.DB_NAME||''))throw Error('Dedicated test database required');
const {dbPool:db}=require('../server/config/database'),{createUserWithStarter}=require('../server/persistence/userRepository');
const departure=require('../server/persistence/lucieDepartureRepository'),admin=require('../server/persistence/arenaTestRepository'),policy=require('../server/game/world/arenaTests'),{loadProgressState}=require('../server/persistence/progressionRepository');
test('SQL departure: victory required, concurrency/idempotency, player isolation and replay reset without duplicate rewards',{skip:!enabled},async()=>{
 const ids=[],oldOwner=policy.isOwner;
 try{
  const a=await createUserWithStarter('void_'+randomUUID(),'password-test',{starterId:7});ids.push(a.id);
  const b=await createUserWithStarter('void_'+randomUUID(),'password-test',{starterId:7});ids.push(b.id);
  assert.equal(await departure.begin(a.id),false);
  for(const key of ['sevenp_defeated','lucie_freed'])await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,'true') ON DUPLICATE KEY UPDATE flag_value='true'",[a.id,key]);
  const [[before]]=await db.execute('SELECT money FROM users WHERE id=?',[a.id]);
  assert.deepEqual((await Promise.all([departure.begin(a.id),departure.begin(a.id)])).sort(),[false,true]);assert.equal(await departure.begin(b.id),false);
  assert.equal((await loadProgressState(a.id)).flags.lucie_departure,'seen');
  policy.isOwner=user=>user?.id===a.id&&user?.username===a.username;
  await admin.rearm(a);const ready=await loadProgressState(a.id);assert(ready.testReplays.includes('lucie_route2'));assert.equal(ready.flags.admin_lucie_departure,'armed');assert.equal(await departure.begin(a.id),false);
  await admin.complete(a,'lucie_route2');assert.equal((await loadProgressState(a.id)).flags.admin_lucie_departure,'pending');assert.equal(await departure.begin(a.id),true);
  const done=await loadProgressState(a.id);assert.equal(done.flags.lucie_departure,'seen');assert.equal(done.flags.admin_lucie_departure,'seen');assert.equal(done.flags.lucie_freed,'true');assert.equal(await departure.begin(a.id),false);
  const [[after]]=await db.execute('SELECT money FROM users WHERE id=?',[a.id]);assert.equal(after.money,before.money);
 }finally{policy.isOwner=oldOwner;for(const id of ids)await db.execute('DELETE FROM users WHERE id=?',[id]);}
});
test.after(async()=>{if(enabled)await db.end();});
