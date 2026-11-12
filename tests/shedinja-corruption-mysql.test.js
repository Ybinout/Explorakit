const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
test('team/PC Shedinja rejects a module atomically, with unchanged stock, Pokémon and receipts',{skip:process.env.RUN_MYSQL_TESTS!=='1'},async()=>{
 assert.equal(process.env.DB_NAME,'explorakit_test');
 const {dbPool:db}=require('../server/config/database'),users=require('../server/persistence/userRepository');
 const teams=require('../server/persistence/teamRepository'),pc=require('../server/persistence/pokemonStorageRepository');
 const repo=require('../server/persistence/corruptionRepository'),factory=require('../server/game/drift/pokemonFactory');
 let user;try{
  user=await users.createUserWithStarter('MunjaGuard_'+randomUUID().slice(0,8),randomUUID());
  await db.execute('INSERT INTO super_tournament_profiles(user_id,best_rooms) VALUES(?,48)',[user.id]);await db.execute('UPDATE users SET money=2000000 WHERE id=?',[user.id]);await require('../server/persistence/darkContinentRepository').grantCard(user.id);
  const first=factory.create(292,100,true),stored=factory.create(292,100,true);await teams.editEquipe(user.id,{pokemons:[first]});await pc.storeCapturedPokemon(user.id,stored);
  await db.execute('INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,?,1)',[user.id,'cmod_ability_sturdy']);
  const initial=[pc.encodePokemon((await teams.loadEquipe(user.id)).pokemons[0]),pc.encodePokemon((await pc.loadEntries(user.id))[0].pokemon)];
  const [[countBefore]]=await db.execute('SELECT COUNT(*) n FROM corruption_receipts WHERE user_id=?',[user.id]);
  for(const[source,p]of[['team',first],['box',stored]])await assert.rejects(repo.install(user.id,{requestId:randomUUID(),itemKey:'cmod_ability_sturdy',pokemonUuid:p.uuid,source,expectedRevision:0,expectedMoves:p.abilities,slot:p.abilities.length}),/Munja ne peut pas être corrompu/);
  assert.deepEqual([pc.encodePokemon((await teams.loadEquipe(user.id)).pokemons[0]),pc.encodePokemon((await pc.loadEntries(user.id))[0].pokemon)],initial);
  assert.equal((await db.execute("SELECT quantity FROM user_items WHERE user_id=? AND item_key='cmod_ability_sturdy'",[user.id]))[0][0].quantity,1);
  assert.equal((await db.execute('SELECT COUNT(*) n FROM corruption_receipts WHERE user_id=?',[user.id]))[0][0].n,countBefore.n);
 }finally{if(user)await db.execute('DELETE FROM users WHERE id=?',[user.id]);await db.end();}
});
