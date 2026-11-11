const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
test('raid encounter is recorded transactionally once, remains after reconnect and retroactive reconciliation is idempotent',{skip:process.env.RUN_MYSQL_TESTS!=='1'},async()=>{
 assert.equal(process.env.DB_NAME,'explorakit_test');const {dbPool:db}=require('../server/config/database'),users=require('../server/persistence/userRepository'),repo=require('../server/persistence/raidRepository'),factory=require('../server/game/drift/pokemonFactory'),codec=require('../server/game/drift/checkpointCodec');let user,run;
 try{user=await users.createUserWithStarter('raid_dex_'+randomUUID().slice(0,8),randomUUID());const team=await require('../server/persistence/teamRepository').loadEquipe(user.id);
 run={id:randomUUID(),phase:'active',version:0,rift:{map:'safari7',difficulty:'easy'},members:[{id:user.id,name:user.username,team}],combat:{boss:factory.create(149,100,true),models:team.pokemons.map(p=>({ownerId:user.id,pokemon:p}))}};
 run.version=await repo.save(run,{partyChanged:false});assert(run.pokedexSeen);
 let [[seen]]=await db.execute('SELECT seen_count,caught_count FROM user_pokedex WHERE user_id=? AND pokemon_id=149',[user.id]);assert.equal(seen.seen_count,1);assert.equal(seen.caught_count,0);
 const restored=codec.decode(codec.encode(run));restored.version=await repo.save(restored,{partyChanged:false});[[seen]]=await db.execute('SELECT seen_count FROM user_pokedex WHERE user_id=? AND pokemon_id=149',[user.id]);assert.equal(seen.seen_count,1);
 const backfill=require('../scripts/backfillRaidPokedex').backfill;await backfill(db,true);await backfill(db,true);[[seen]]=await db.execute('SELECT seen_count FROM user_pokedex WHERE user_id=? AND pokemon_id=149',[user.id]);assert.equal(seen.seen_count,1);
 }finally{if(run)await db.execute('DELETE FROM corruption_raids WHERE id=?',[run.id]);if(user)await db.execute('DELETE FROM users WHERE id=?',[user.id]);await db.end();}
});
