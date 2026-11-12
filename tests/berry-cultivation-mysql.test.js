const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
test('berry SQL: atomic independent growth, offline harvest, canonical discovery, replay and permanent PC/party debit',{skip:process.env.RUN_MYSQL_TESTS!=='1'},async()=>{
 assert.equal(process.env.DB_NAME,'explorakit_test');
 const {dbPool:db}=require('../server/config/database'),users=require('../server/persistence/userRepository'),repo=require('../server/persistence/housingRepository'),garden=require('../server/persistence/berryGardenRepository'),teamRepo=require('../server/persistence/teamRepository'),storage=require('../server/persistence/pokemonStorageRepository'),consume=require('../server/persistence/berryConsumptionRepository');
 let id;try{
  id=(await users.createUserWithStarter('BerrySQL_'+randomUUID().slice(0,8),randomUUID())).id;await db.execute('UPDATE users SET money=20000000 WHERE id=?',[id]);
  let home=(await repo.purchase(id,{requestId:randomUUID(),revision:0,entryKey:require('../server/game/housing/entries').entries[0].key,model:'nid'})).home;
  for(const key of ['berry_pot','berry_planter','berry_mutator'])home=(await repo.furniture(id,{requestId:randomUUID(),revision:home.revision,key,quantity:1})).home;
  const ids={pot:randomUUID(),planter:randomUUID(),mutator:randomUUID()},placements=[{id:ids.pot,key:'berry_pot',x:11,y:11,rotation:0},{id:ids.planter,key:'berry_planter',x:10,y:13,rotation:0},{id:ids.mutator,key:'berry_mutator',x:15,y:11,rotation:0}];
  home=(await repo.saveFloor(id,{requestId:randomUUID(),revision:home.revision,floor:0,layout:{...home.floors[0],placements}})).home;
  for(const key of ['oran_berry','sitrus_berry','cheri_berry','crystal_shard'])await db.execute('INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,?,?) ON DUPLICATE KEY UPDATE quantity=VALUES(quantity)',[id,key,key==='crystal_shard'?9:8]);
  const req=(more)=>({requestId:randomUUID(),revision:home.revision,floor:0,furnitureId:ids.planter,...more});
  await assert.rejects(garden.plant(id,req({slot:0,berryKey:'oran_berry'})),/manque/);
  assert.equal((await garden.crops(id)).length,0);assert.equal((await require('../server/persistence/itemRepository').loadUserItems(id)).find(i=>i.key==='oran_berry').quantity,8);
  await db.execute("UPDATE user_items SET quantity=1000 WHERE user_id=? AND item_key='crystal_shard'",[id]);
  const seed=req({slot:0,berryKey:'oran_berry'}),a=await garden.plant(id,seed);home=a.home;
  assert.equal((await garden.plant(id,seed)).duplicate,true);
  home=(await garden.plant(id,req({slot:1,berryKey:'sitrus_berry'}))).home;
  const race=await Promise.allSettled([garden.plant(id,req({slot:2,berryKey:'cheri_berry'})),garden.plant(id,req({slot:2,berryKey:'oran_berry'}))]);assert.equal(race.filter(r=>r.status==='fulfilled').length,1);home=await repo.read(id);
  assert.equal(home.crops.length,3);assert.equal((await require('../server/persistence/itemRepository').loadUserItems(id)).find(i=>i.key==='crystal_shard').quantity,970);
  await assert.rejects(garden.harvest(id,req({slot:0})),/mûre/);
  await assert.rejects(repo.saveFloor(id,{...req({}),layout:{...home.floors[0],placements:placements.filter(p=>p.id!==ids.planter)}}),/Récolte/);
  await db.execute('UPDATE housing_berry_crops SET planted_at=planted_at-900000 WHERE user_id=?',[id]);home=await repo.read(id);
  for(let slot=0;slot<3;slot++){const request=req({slot}),result=await garden.harvest(id,request);home=result.home;assert.equal((await garden.harvest(id,request)).duplicate,true);}
  assert.equal(home.crops.length,0);
  await db.execute("UPDATE user_items SET quantity=10 WHERE user_id=? AND item_key='crystal_shard'",[id]);
  const exact=req({furnitureId:ids.pot,slot:0,berryKey:'oran_berry'});home=(await garden.plant(id,exact)).home;
  assert.equal((await garden.plant(id,exact)).duplicate,true);
  const [[emptyStock]]=await db.execute("SELECT quantity FROM user_items WHERE user_id=? AND item_key='crystal_shard'",[id]);assert.equal(Number(emptyStock.quantity),0);
  const ingredients=['corrupted_oran_berry','corrupted_sitrus_berry','corrupted_cheri_berry'];for(const key of ingredients)await db.execute('INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,?,3) ON DUPLICATE KEY UPDATE quantity=3',[id,key]);
  const mix=req({furnitureId:ids.mutator,ingredients}),first=await garden.mutate(id,mix);home=first.home;const again=await garden.mutate(id,mix);assert.equal(again.duplicate,true);assert.deepEqual(again.receipt.mutation,first.receipt.mutation);
  const[discovered]=await db.execute('SELECT attempts FROM berry_recipe_discoveries WHERE user_id=?',[id]);assert.equal(discovered.length,1);assert.equal(discovered[0].attempts,1);
  for(const key of ingredients){const[[i]]=await db.execute('SELECT quantity FROM user_items WHERE user_id=? AND item_key=?',[id,key]);assert.equal(i.quantity,2);}
  for(const key of ingredients)await db.execute('UPDATE user_items SET quantity=12 WHERE user_id=? AND item_key=?',[id,key]);
  const bulk=req({furnitureId:ids.mutator,ingredients,quantity:5}),batch=await garden.mutate(id,bulk);home=batch.home;
  assert.equal(batch.receipt.quantity,5);assert.equal(batch.receipt.mutations.reduce((n,r)=>n+r.quantity,0),5);
  assert.equal((await garden.mutate(id,bulk)).duplicate,true);
  for(const key of ingredients){const[[i]]=await db.execute('SELECT quantity FROM user_items WHERE user_id=? AND item_key=?',[id,key]);assert.equal(i.quantity,7);}
  const[[attempts]]=await db.execute('SELECT attempts FROM berry_recipe_discoveries WHERE user_id=?',[id]);assert.equal(attempts.attempts,6);
  await assert.rejects(garden.mutate(id,req({furnitureId:ids.mutator,ingredients,quantity:8})),/manque/);
  for(const key of ingredients){const[[i]]=await db.execute('SELECT quantity FROM user_items WHERE user_id=? AND item_key=?',[id,key]);assert.equal(i.quantity,7);}
  const team=await teamRepo.loadEquipe(id),p=team.pokemons[0],key='mutant_stat_attack_common_berry';p.heldItem=key;await teamRepo.editEquipe(id,team);
  const record={battleId:randomUUID(),pokemonUuid:p.uuid,itemKey:key};await consume.flush([{__berrySpent:[record]}]);assert.equal((await teamRepo.loadEquipe(id)).pokemons[0].heldItem,null);
  // Replaying an old checkpoint must not consume a newly equipped second copy.
  p.heldItem=key;await teamRepo.editEquipe(id,team);await consume.flush([{__berrySpent:[record]}]);assert.equal((await teamRepo.loadEquipe(id)).pokemons[0].heldItem,key);
  const pc=Object.assign(Object.create(Object.getPrototypeOf(p)),p,{uuid:randomUUID()});await storage.storeCapturedPokemon(id,pc);
  await consume.flush([{__berrySpent:[{...record,battleId:randomUUID(),pokemonUuid:pc.uuid}]}]);assert.equal((await storage.loadEntries(id))[0].pokemon.heldItem,null);
  const[[before]]=await db.execute('SELECT COUNT(*) n FROM berry_consumption_receipts WHERE user_id=?',[id]);assert.equal(Number(before.n),2);
 }finally{if(id)await db.execute('DELETE FROM users WHERE id=?',[id]);await db.end();}
});
