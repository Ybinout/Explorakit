const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const enabled=process.env.RUN_MYSQL_TESTS==='1';if(enabled){if(!/test/i.test(process.env.DB_TEST_NAME||''))throw Error('Dedicated test database required');process.env.DB_NAME=process.env.DB_TEST_NAME;}
const{dbPool}=require('../server/config/database'),repo=require('../server/persistence/tradeRepository'),teams=require('../server/persistence/teamRepository'),pc=require('../server/persistence/pokemonStorageRepository'),friends=require('../server/persistence/trainerRepository'),items=require('../server/persistence/itemRepository');
const factory=require('../server/game/drift/pokemonFactory'),{createUserWithStarter}=require('../server/persistence/userRepository');
const ids=[];
async function user(){const u=await createUserWithStarter('trade_'+randomUUID(),'fixture-password',{starterId:7});ids.push(u.id);const team=await teams.loadEquipe(u.id);team.pokemons.push(factory.create(25,30,true),factory.create(133,25,true));await teams.editEquipe(u.id,team);await dbPool.execute("INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,'pokeball',10),(?,'leftovers',1),(?,'clear_crystal',5) ON DUPLICATE KEY UPDATE quantity=VALUES(quantity)",[u.id,u.id,u.id]);return{id:u.id,team};}
async function pair(){const a=await user(),b=await user();await friends.friendAction(a.id,b.id,'request');await friends.friendAction(b.id,a.id,'accept');return[a,b];}
async function execute(a,b,offers){const id=randomUUID(),owners=[a.id,b.id],snapshot=await repo.inspect(owners,offers);assert.equal(snapshot.review.error,'');const args={id,ids:owners,offers,digest:snapshot.review.digest};return{args,result:await repo.commit(args)};}
const offer=(p=null,list=[])=>({pokemonUuid:p?.uuid||null,items:list});
async function stock(id,key){const[[r]]=await dbPool.execute('SELECT quantity FROM user_items WHERE user_id=? AND item_key=?',[id,key]);return Number(r?.quantity)||0;}
async function snapshot(id){return{team:(await teams.loadEquipe(id)).pokemons.map(p=>JSON.parse(pc.encodePokemon(p))),entries:(await pc.loadEntries(id)).map(e=>({box:e.box,slot:e.slot,data:JSON.parse(pc.encodePokemon(e.pokemon))})),items:await dbPool.execute('SELECT item_key,quantity FROM user_items WHERE user_id=? ORDER BY item_key',[id]).then(r=>r[0])};}
test.after(async()=>{if(enabled){for(const id of ids)await dbPool.execute('DELETE FROM users WHERE id=?',[id]);await dbPool.end();}});
test('SQL trade swaps exact Pokémon between party and PC with held item, move PP, K/IV/EV, wound and order preserved',{skip:!enabled},async()=>{
 const[a,b]=await pair(),incoming=factory.create(92,40,true);incoming.k=4;incoming.iv.speed=31;incoming.ev.specialAttack=252;incoming.nature='Modest';incoming.recalculateStats();incoming.currentHp=7;incoming.movePp[0]=1;incoming.heldItem='life_orb';await pc.storeCapturedPokemon(b.id,incoming);
 const stored=(await pc.loadEntries(b.id))[0].pokemon,expected=JSON.parse(pc.encodePokemon(stored)),outgoing=a.team.pokemons[1];
 const{args,result}=await execute(a,b,[offer(outgoing,[{key:'pokeball',quantity:3}]),offer(stored,[{key:'clear_crystal',quantity:2}])]);
 const afterA=await teams.loadEquipe(a.id),afterB=await teams.loadEquipe(b.id);
 assert.deepEqual(afterA.pokemons.map(p=>p.uuid),[a.team.pokemons[0].uuid,stored.uuid,a.team.pokemons[2].uuid]);assert.deepEqual(JSON.parse(pc.encodePokemon(afterA.pokemons[1])),expected);assert.equal(afterB.pokemons.at(-1).uuid,outgoing.uuid);assert.equal((await pc.loadEntries(b.id)).length,0);
 assert.equal(await stock(a.id,'pokeball'),7);assert.equal(await stock(b.id,'pokeball'),13);assert.equal(await stock(a.id,'clear_crystal'),7);assert.equal(await stock(b.id,'clear_crystal'),3);
 const[[discovery]]=await dbPool.execute("SELECT item_key FROM user_item_discoveries WHERE user_id=? AND item_key='life_orb'",[a.id]);assert(discovery);
 const replay=await repo.commit(args);assert(replay.duplicate);assert.equal(await stock(a.id,'pokeball'),7);assert.equal(await stock(b.id,'pokeball'),13);assert.deepEqual(replay.receipt,result.receipt);
 const stranger=await user();assert.equal(await repo.loadReceipt(stranger.id,args.id),null);assert((await repo.loadReceipt(a.id,args.id)).offers[0].pokemon.uuid===outgoing.uuid);
});
test('SQL item gifts and transfers to a full party use the PC, and receipt replay never credits them twice',{skip:!enabled},async()=>{
 const[a,b]=await pair();b.team.pokemons.push(...[1,4,19].map(id=>factory.create(id,10,true)));await teams.editEquipe(b.id,b.team);
 const{args}=await execute(a,b,[offer(a.team.pokemons[1],[{key:'leftovers',quantity:1}]),offer()]);
 assert.equal((await pc.loadEntries(b.id))[0].pokemon.uuid,a.team.pokemons[1].uuid);assert.equal((await teams.loadEquipe(b.id)).pokemons.length,6);assert.equal((await teams.loadEquipe(a.id)).pokemons.length,2);assert.equal(await stock(a.id,'leftovers'),0);assert.equal(await stock(b.id,'leftovers'),2);
 await Promise.all([repo.commit(args),repo.commit(args)]);assert.equal((await pc.loadEntries(b.id)).length,1);assert.equal(await stock(b.id,'leftovers'),2);
});
test('stale quantity, IV, held item, ownership, personal items and removed friendships reject the whole offer before transfer',{skip:!enabled},async()=>{
 const[a,b]=await pair(),offers=[offer(a.team.pokemons[1],[{key:'pokeball',quantity:2}]),offer(b.team.pokemons[1])],owners=[a.id,b.id];
 let review=(await repo.inspect(owners,offers)).review;await dbPool.execute("UPDATE user_items SET quantity=quantity-1 WHERE user_id=? AND item_key='pokeball'",[a.id]);const before=await snapshot(a.id);
 await assert.rejects(repo.commit({id:randomUUID(),ids:owners,offers,digest:review.digest}),/changé/);assert.deepEqual(await snapshot(a.id),before);
 review=(await repo.inspect(owners,offers)).review;await dbPool.execute('UPDATE pokemons SET iv_speed=31 WHERE uuid=?',[a.team.pokemons[1].uuid]);await assert.rejects(repo.commit({id:randomUUID(),ids:owners,offers,digest:review.digest}),/changé/);
 await assert.rejects(repo.inspect(owners,[offer(b.team.pokemons[1]),offer()]),/plus/);await assert.rejects(repo.inspect(owners,[offer(null,[{key:'fly_module',quantity:1}]),offer()]),/échangé/);
 await dbPool.execute("UPDATE pokemons SET held_item='exp_share' WHERE uuid=?",[a.team.pokemons[1].uuid]);await assert.rejects(repo.inspect(owners,offers),/personnel/);
 await friends.friendAction(a.id,b.id,'remove');await assert.rejects(repo.inspect(owners,[offer(),offer()]),/amis/);
});
test('a database error after outgoing rows were removed rolls back Pokémon, boxes, items, Pokédex and receipt together',{skip:!enabled},async()=>{
 const[a,b]=await pair(),offers=[offer(a.team.pokemons[1],[{key:'pokeball',quantity:2}]),offer(b.team.pokemons[1])],owners=[a.id,b.id],review=(await repo.inspect(owners,offers)).review,tradeId=randomUUID();
 const before=[await snapshot(a.id),await snapshot(b.id)],teamB=await teams.getTeamRecord(b.id),trigger='trade_fail_'+randomUUID().replace(/-/g,'');
 try{
  await dbPool.query(`CREATE TRIGGER ${trigger} BEFORE INSERT ON pokemons FOR EACH ROW BEGIN IF NEW.team_id=${teamB.id} AND NEW.uuid='${a.team.pokemons[1].uuid}' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='fixture transfer failure'; END IF; END`);
  await assert.rejects(repo.commit({id:tradeId,ids:owners,offers,digest:review.digest}),/fixture transfer failure/);
  assert.deepEqual([await snapshot(a.id),await snapshot(b.id)],before);assert.equal(await repo.loadReceipt(a.id,tradeId),null);
 }finally{await dbPool.query('DROP TRIGGER IF EXISTS '+trigger);}
});
test('inventory lock also protects HTTP equipment repository writes while a negotiated trade is open',{skip:!enabled},async()=>{
 const a=await user(),lock=require('../server/game/social/tradeLocks'),team=await teams.getTeamRecord(a.id),token=randomUUID();lock.acquire([a.id],token);
 try{await assert.rejects(items.equipHeldItem(a.id,team.id,a.team.pokemons[0].uuid,'leftovers'),/échange/);assert.equal(await stock(a.id,'leftovers'),1);assert.equal((await teams.loadEquipe(a.id)).pokemons[0].heldItem,null);}finally{lock.release([a.id],token);}
 await items.equipHeldItem(a.id,team.id,a.team.pokemons[0].uuid,'leftovers');assert.equal((await teams.loadEquipe(a.id)).pokemons[0].heldItem,'leftovers');
});
