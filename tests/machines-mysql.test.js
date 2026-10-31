const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const enabled=process.env.RUN_MYSQL_TESTS==='1';let db,items,users,teams,machines;
test.before(()=>{if(!enabled)return;if(!/test/i.test(process.env.DB_NAME||''))throw Error('Dedicated test database required');db=require('../server/config/database').dbPool;items=require('../server/persistence/itemRepository');users=require('../server/persistence/userRepository');teams=require('../server/persistence/teamRepository');machines=require('../server/persistence/machineRepository');});
test.after(async()=>{await db?.end();});
test('all-method CS SQL: natural, egg, event, pre-evolution, Sketch and native/story Purify persist after real purchases', {skip:!enabled}, async()=>{
 const u=await users.createUserWithStarter('all_cs_'+randomUUID(),'All-method-CS-test-2026',{starterId:7,sprite:'sprite.png'});
 try {
  await db.execute('UPDATE users SET money=100000 WHERE id=?',[u.id]);
  await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,'hoze_defeated','true')",[u.id]);
  let balance=100000;
  for(const [id,key] of [[7,'cs_bite'],[7,'cs_aqua_jet'],[129,'cs_hydro_pump'],[26,'cs_celebrate'],[235,'cs_dark_void'],[94,'cs_purify'],[771,'cs_purify']]) {
   const p=require('../server/game/drift/pokemonFactory').create(id,30,true);p.abilities=['Tackle'];p.movePp=[2];await teams.editEquipe(u.id,{pokemons:[p]});
   const machine=require('../server/game/items/machines').machines[key];
   const purchase=await items.purchaseUserItem(u.id,key,1,{mapName:'tour_etage1'});assert(purchase.success);balance-=machine.price;assert.equal(purchase.totalPrice,machine.price);
   await machines.useMachine(u.id,p.uuid,key,{slot:1,expectedMoves:p.abilities});
   const saved=(await teams.loadEquipe(u.id)).pokemons[0];assert.deepEqual(saved.abilities,['Tackle',machine.move]);
   assert.deepEqual(saved.movePp,[2,require('../server/game/battle/battleResources').getMaxMovePp(machine.move)]);
   assert.equal((await items.loadUserItems(u.id)).find(i=>i.key===key)?.quantity||0,0);
   const [[wallet]]=await db.execute('SELECT money FROM users WHERE id=?',[u.id]);assert.equal(Number(wallet.money),balance);
  }
  const p=require('../server/game/drift/pokemonFactory').create(4,30,true);p.abilities=['Tackle'];p.movePp=[2];await teams.editEquipe(u.id,{pokemons:[p]});
  await items.purchaseUserItem(u.id,'cs_surf',1,{mapName:'tour_etage1'});
  await assert.rejects(machines.useMachine(u.id,p.uuid,'cs_surf',{slot:1,expectedMoves:p.abilities}),/compatible/);
  assert.equal((await items.loadUserItems(u.id)).find(i=>i.key==='cs_surf').quantity,1);
  assert.deepEqual((await teams.loadEquipe(u.id)).pokemons[0].abilities,['Tackle']);
 }finally{await db.execute('DELETE FROM users WHERE id=?',[u.id]);}
});
test('CS Aurore SQL: actual shop price, compatible teaching, five PP and one consumption persisted', {skip:!enabled}, async()=>{
 const u=await users.createUserWithStarter('aurore_'+randomUUID(),'Morning-Sun-test-2026',{starterId:7,sprite:'sprite.png'});
 try {
  await db.execute('UPDATE users SET money=10000 WHERE id=?',[u.id]);
  await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,'hoze_defeated','true')",[u.id]);
  const p=require('../server/game/drift/pokemonFactory').create(58,40,true);p.abilities=['Tackle'];p.movePp=[2];await teams.editEquipe(u.id,{pokemons:[p]});
  const purchase=await items.purchaseUserItem(u.id,'cs_morning_sun',1,{mapName:'tour_etage1'});
  assert(purchase.success);assert.equal(purchase.totalPrice,3000);
  await machines.useMachine(u.id,p.uuid,'cs_morning_sun',{slot:1,expectedMoves:p.abilities});
  const saved=(await teams.loadEquipe(u.id)).pokemons[0];assert.deepEqual(saved.abilities,['Tackle','Morning Sun']);assert.deepEqual(saved.movePp,[2,5]);
  assert.equal((await items.loadUserItems(u.id)).find(i=>i.key==='cs_morning_sun')?.quantity||0,0);
  const [[wallet]]=await db.execute('SELECT money FROM users WHERE id=?',[u.id]);assert.equal(Number(wallet.money),7000);
 }finally{await db.execute('DELETE FROM users WHERE id=?',[u.id]);}
});
test('CS SQL: ownership, stale choices, concurrent consumption, moves/PP and stock persisted atomically',{skip:!enabled},async()=>{
 const u=await users.createUserWithStarter('cs_'+randomUUID(),'Machine-test-password-2026',{starterId:7,sprite:'sprite.png'});
 try{
  await db.execute('UPDATE users SET money=50000 WHERE id=?',[u.id]);const team=await teams.loadEquipe(u.id),p=team.pokemons[0];p.abilities=['Tackle','Tail Whip','Water Gun','Withdraw'];p.movePp=[2,3,4,5];await teams.editEquipe(u.id,team);
  await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,'raphael_defeated','true')",[u.id]);
  const purchase=await items.purchaseUserItem(u.id,'cs_surf',2,{mapName:'tour_etage1',price:1});assert(purchase.success);assert.equal(purchase.totalPrice,8000);
  const [[wallet]]=await db.execute('SELECT money FROM users WHERE id=?',[u.id]);assert.equal(Number(wallet.money),42000);
  const c={slot:2,expectedMoves:[...p.abilities]};
  await assert.rejects(machines.useMachine(u.id+100000,p.uuid,'cs_surf',c),/appartient/);
  await assert.rejects(machines.useMachine(u.id,p.uuid,'cs_surf',{...c,expectedMoves:['Tackle']}),/changé/);
  assert.equal((await items.loadUserItems(u.id)).find(i=>i.key==='cs_surf').quantity,2);
  const results=await Promise.allSettled([1,2].map(()=>machines.useMachine(u.id,p.uuid,'cs_surf',c)));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const saved=(await teams.loadEquipe(u.id)).pokemons[0];assert.deepEqual(saved.abilities,['Tackle','Tail Whip','Surf','Withdraw']);assert.deepEqual(saved.movePp,[2,3,15,5]);assert.equal((await items.loadUserItems(u.id)).find(i=>i.key==='cs_surf').quantity,1);
  await assert.rejects(machines.useMachine(u.id,p.uuid,'cs_ice_beam',{slot:1,expectedMoves:saved.abilities}),/sac/);assert.deepEqual((await teams.loadEquipe(u.id)).pokemons[0].abilities,saved.abilities);
 }finally{await db.execute('DELETE FROM users WHERE id=?',[u.id]);}
});
