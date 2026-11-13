const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
test('group party exchange persists exact origins, rejects races/foreign requests, and rolls back an interrupted swap',{skip:process.env.RUN_MYSQL_TESTS!=='1'},async()=>{
 assert.equal(process.env.DB_NAME,'explorakit_test');
 const db=require('../server/config/database').dbPool,users=require('../server/persistence/userRepository'),teams=require('../server/persistence/teamRepository'),pc=require('../server/persistence/pokemonStorageRepository'),factory=require('../server/game/drift/pokemonFactory');
 let user,other;
 try{
  user=await users.createUserWithStarter('GroupPC_'+randomUUID().slice(0,8),randomUUID());other=await users.createUserWithStarter('GroupOther_'+randomUUID().slice(0,8),randomUUID());
  const outgoing=Array.from({length:6},()=>factory.create(9,50,true));await teams.editEquipe(user.id,{pokemons:outgoing});
  const incoming=Array.from({length:6},()=>factory.create(6,50,true));incoming[0].heldItem='leftovers';incoming[0].currentHp=2;incoming[0].movePp[0]=0;
  for(const p of incoming)await pc.storeCapturedPokemon(user.id,p);
  await db.execute('UPDATE pokemon_storage SET box_index=7,slot_index=24 WHERE user_id=? AND uuid=?',[user.id,incoming[1].uuid]);
  const before=await pc.loadStorage(user.id),selected=before.entries.slice(0,2),request={action:'swapParty',teamIndex:2,expectedTeam:before.team.map(p=>p.uuid),moves:selected.map(e=>({pokemonUuid:e.pokemon.uuid,from:{kind:'box',box:e.box,slot:e.slot}}))};
  await assert.rejects(pc.mutateStorage(other.id,request));assert.deepEqual(await pc.loadStorage(user.id),before);
  const getConnection=db.getConnection.bind(db);db.getConnection=async()=>{const c=await getConnection(),execute=c.execute.bind(c);c.execute=async(sql,args)=>{if(/^INSERT INTO pokemon_storage\(/.test(sql))throw Error('injected swap failure');return execute(sql,args);};return c;};
  try{await assert.rejects(pc.mutateStorage(user.id,request),/injected/);}finally{db.getConnection=getConnection;}
  assert.deepEqual(await pc.loadStorage(user.id),before);
  const concurrent=await Promise.allSettled([pc.mutateStorage(user.id,request),pc.mutateStorage(user.id,request)]);assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1);assert.equal(concurrent.filter(r=>r.status==='rejected').length,1);
  const after=await pc.loadStorage(user.id);assert.deepEqual(after.team.map(p=>p.uuid),[...before.team.slice(0,2),...selected.map(e=>e.pokemon),...before.team.slice(4)].map(p=>p.uuid));
  for(const[e,i]of selected.map((e,i)=>[e,i]))assert.deepEqual(after.entries.find(v=>v.box===e.box&&v.slot===e.slot).pokemon,before.team[2+i]);
  const signature=view=>[...view.team,...view.entries.map(e=>e.pokemon)].sort((a,b)=>a.uuid.localeCompare(b.uuid));assert.deepEqual(signature(after),signature(before));
  const full={action:'swapParty',expectedTeam:after.team.map(p=>p.uuid),moves:after.entries.map(e=>({pokemonUuid:e.pokemon.uuid,from:{kind:'box',box:e.box,slot:e.slot}}))};
  await pc.mutateStorage(user.id,full);const last=await pc.loadStorage(user.id);assert.deepEqual(signature(last),signature(before));assert.deepEqual(last.team.map(p=>p.uuid),after.entries.map(e=>e.pokemon.uuid));
  const[[wallet]]=await db.execute('SELECT money FROM users WHERE id=?',[user.id]);assert.equal(Number(wallet.money),Number(user.money));
 }finally{for(const u of[user,other])if(u)await db.execute('DELETE FROM users WHERE id=?',[u.id]);await db.end();}
});
