const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
test('trash transaction: stock checks, full rollback, confirmed replay and six-for-six PC swap persist atomically',
 {skip:process.env.RUN_MYSQL_TESTS!=='1'},async()=>{
  assert.equal(process.env.DB_NAME,'explorakit_test');
  const db=require('../server/config/database').dbPool,users=require('../server/persistence/userRepository');
  const housing=require('../server/persistence/housingRepository'),trash=require('../server/persistence/housingTrashRepository');
  const teams=require('../server/persistence/teamRepository'),pc=require('../server/persistence/pokemonStorageRepository');
  const factory=require('../server/game/drift/pokemonFactory');let user;
  const request=(h,p)=>({...p,revision:h.revision,requestId:randomUUID()});
  try{
   user=await users.createUserWithStarter('TrashSwap_'+randomUUID().slice(0,8),randomUUID());
   await db.execute('UPDATE users SET money=3000000 WHERE id=?',[user.id]);
   let h=await housing.read(user.id);h=(await housing.purchase(user.id,request(h,{model:'nid',entryKey:require('../server/game/housing/entries').entries[0].key}))).home;
   h=(await housing.furniture(user.id,request(h,{key:'trash_bin',quantity:1}))).home;
   const id=randomUUID(),floor={...h.floors[0],placements:[{id,key:'trash_bin',x:12,y:10,rotation:0}]};
   h=(await housing.saveFloor(user.id,request(h,{floor:0,layout:floor}))).home;
   await db.execute("INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,'potion',10),(?,'ether',2)",[user.id,user.id]);
   const stock=async key=>Number((await db.execute('SELECT quantity FROM user_items WHERE user_id=? AND item_key=?',[user.id,key]))[0][0]?.quantity||0);
   const payload=request(h,{floor:0,furnitureId:id,confirm:true,items:[{key:'potion',quantity:4}]});
   await trash.discard(user.id,payload);const replay=await trash.discard(user.id,payload);assert(replay.duplicate);assert.equal(await stock('potion'),6);
   assert.equal((await db.execute('SELECT COUNT(*) n FROM housing_receipts WHERE request_id=?',[payload.requestId]))[0][0].n,1);
   h=await housing.read(user.id);
   await assert.rejects(()=>trash.discard(user.id,request(h,{floor:0,furnitureId:id,confirm:true,items:[{key:'ether',quantity:1},{key:'potion',quantity:99}]})),/stock/);
   assert.equal(await stock('ether'),2);assert.equal(await stock('potion'),6);assert.equal((await housing.read(user.id)).revision,h.revision);
   await assert.rejects(()=>trash.discard(user.id,{...payload,items:[{key:'potion',quantity:5}]}),/déjà/);
   const outgoing=Array.from({length:6},(_,i)=>factory.create([9,6,3,94,143,26][i],40,true));
   await teams.editEquipe(user.id,{pokemons:outgoing});
   const incoming=Array.from({length:6},(_,i)=>factory.create([65,68,112,130,134,149][i],50,true));
   incoming[0].heldItem='leftovers';incoming[0].currentHp=3;incoming[0].movePp[0]=1;
   for(const p of incoming)await pc.storeCapturedPokemon(user.id,p);
   const view=await pc.loadStorage(user.id),swap={action:'swapParty',expectedTeam:outgoing.map(p=>p.uuid),moves:view.entries.map(e=>({pokemonUuid:e.pokemon.uuid,from:{kind:'box',box:e.box,slot:e.slot}}))};
   await pc.mutateStorage(user.id,swap);
   const saved=await pc.loadStorage(user.id);assert.deepEqual(saved.team.map(p=>p.uuid),incoming.map(p=>p.uuid));assert.deepEqual(saved.entries.map(e=>e.pokemon.uuid),outgoing.map(p=>p.uuid));
   assert.equal(saved.team[0].heldItem,'leftovers');assert.equal(saved.team[0].currentHp,3);assert.equal(saved.team[0].movePp[0],1);
   await assert.rejects(()=>pc.mutateStorage(user.id,swap),/changé/);assert.deepEqual(await pc.loadStorage(user.id),saved);
  }finally{if(user)await db.execute('DELETE FROM users WHERE id=?',[user.id]);await db.end();}
 });
