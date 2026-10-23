const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const enabled=process.env.RUN_MYSQL_TESTS==='1';let db,items,users,teams,machines;
test.before(()=>{if(!enabled)return;if(!/test/i.test(process.env.DB_NAME||''))throw Error('Dedicated test database required');db=require('../server/config/database').dbPool;items=require('../server/persistence/itemRepository');users=require('../server/persistence/userRepository');teams=require('../server/persistence/teamRepository');machines=require('../server/persistence/machineRepository');});
test.after(async()=>{await db?.end();});
test('CS SQL: ownership, stale choices, concurrent consumption, moves/PP and stock persisted atomically',{skip:!enabled},async()=>{
 const u=await users.createUserWithStarter('cs_'+randomUUID(),'Machine-test-password-2026',{starterId:7,sprite:'sprite.png'});
 try{
  await db.execute('UPDATE users SET money=50000 WHERE id=?',[u.id]);const team=await teams.loadEquipe(u.id),p=team.pokemons[0];p.abilities=['Tackle','Tail Whip','Water Gun','Withdraw'];p.movePp=[2,3,4,5];await teams.editEquipe(u.id,team);
  assert((await items.purchaseUserItem(u.id,'cs_surf',2,{mapName:'tour_etage1'})).success);
  const c={slot:2,expectedMoves:[...p.abilities]};
  await assert.rejects(machines.useMachine(u.id+100000,p.uuid,'cs_surf',c),/appartient/);
  await assert.rejects(machines.useMachine(u.id,p.uuid,'cs_surf',{...c,expectedMoves:['Tackle']}),/changé/);
  assert.equal((await items.loadUserItems(u.id)).find(i=>i.key==='cs_surf').quantity,2);
  const results=await Promise.allSettled([1,2].map(()=>machines.useMachine(u.id,p.uuid,'cs_surf',c)));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const saved=(await teams.loadEquipe(u.id)).pokemons[0];assert.deepEqual(saved.abilities,['Tackle','Tail Whip','Surf','Withdraw']);assert.deepEqual(saved.movePp,[2,3,15,5]);assert.equal((await items.loadUserItems(u.id)).find(i=>i.key==='cs_surf').quantity,1);
  await assert.rejects(machines.useMachine(u.id,p.uuid,'cs_ice_beam',{slot:1,expectedMoves:saved.abilities}),/sac/);assert.deepEqual((await teams.loadEquipe(u.id)).pokemons[0].abilities,saved.abilities);
 }finally{await db.execute('DELETE FROM users WHERE id=?',[u.id]);}
});
