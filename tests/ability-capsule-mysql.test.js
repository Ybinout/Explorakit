const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const enabled=process.env.RUN_MYSQL_TESTS==='1';let db,teams,items,medicine,users,factory,pc;
test.before(()=>{if(!enabled)return;assert.match(process.env.DB_NAME||'',/test/i);db=require('../server/config/database').dbPool;teams=require('../server/persistence/teamRepository');items=require('../server/persistence/itemRepository');medicine=require('../server/persistence/medicineRepository');users=require('../server/persistence/userRepository');factory=require('../server/game/drift/pokemonFactory');pc=require('../server/persistence/pokemonStorageRepository');});
test.after(async()=>{await db?.end();});
test('SQL Pilule Talent: real purchase, persistent ability, no-op refusal, ownership and concurrent last-stock consumption are authoritative',{skip:!enabled},async()=>{
 let u,other;const old=Math.random;
 try{
  u=await users.createUserWithStarter('capsule_'+randomUUID(),'Capsule-test-2026',{starterId:7,sprite:'sprite.png'});other=await users.createUserWithStarter('capsule_'+randomUUID(),'Capsule-test-2026',{starterId:7,sprite:'sprite.png'});
  const p=factory.create(63,20,true);p.passiveAbility='Synchronize';const single=factory.create(92,20,true);await teams.editEquipe(u.id,{pokemons:[p,single]});await db.execute('UPDATE users SET money=30000 WHERE id=?',[u.id]);
  assert.equal((await items.purchaseUserItem(u.id,'ability_capsule',1,{mapName:'ville1_shop'})).success,false);
  await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,'hoze_defeated','true')",[u.id]);const progress=await require('../server/persistence/progressionRepository').loadProgressState(u.id);
  assert((await items.purchaseUserItem(u.id,'ability_capsule',1,{mapName:'ville1_shop',flags:progress.flags})).success);const[[money]]=await db.execute('SELECT money FROM users WHERE id=?',[u.id]);assert.equal(Number(money.money),20000);
  const view=(await items.loadUserItems(u.id)).find(i=>i.key==='ability_capsule');assert.deepEqual(view.abilityOptions[p.uuid],['Inner Focus','Magic Guard']);assert.deepEqual(view.abilityOptions[single.uuid],[]);
  await assert.rejects(medicine.useMedicine(u.id,single,'ability_capsule'),/aucun autre talent/);await assert.rejects(medicine.useMedicine(other.id,p,'ability_capsule'),/appartient/);assert.equal((await items.loadUserItems(u.id)).find(i=>i.key==='ability_capsule').quantity,1);
  Math.random=()=>.999;const results=await Promise.allSettled([medicine.useMedicine(u.id,p,'ability_capsule'),medicine.useMedicine(u.id,p,'ability_capsule')]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);const result=results.find(r=>r.status==='fulfilled').value;assert.equal(result.passiveAbility,'Magic Guard');assert.equal(result.trainingChange.before,'Synchronize');assert.equal((await teams.loadEquipe(u.id)).pokemons[0].passiveAbility,'Magic Guard');assert(!(await items.loadUserItems(u.id)).some(i=>i.key==='ability_capsule'));
  await pc.mutateStorage(u.id,{action:'deposit',pokemonUuid:p.uuid,box:0});assert.equal((await pc.loadEntries(u.id))[0].pokemon.passiveAbility,'Magic Guard');await pc.mutateStorage(u.id,{action:'withdraw',pokemonUuid:p.uuid});assert.equal((await teams.loadEquipe(u.id)).pokemons.find(q=>q.uuid===p.uuid).passiveAbility,'Magic Guard');
 }finally{Math.random=old;for(const owner of[u,other])if(owner)await db.execute('DELETE FROM users WHERE id=?',[owner.id]);}
});
