const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const enabled=process.env.RUN_MYSQL_TESTS==='1';let db,users,teams,pc,items,factory,owner,other,team,stored;
test.before(async()=>{
 if(!enabled)return;if(process.env.DB_NAME!=='explorakit_test')throw Error('Dedicated test DB required');
 db=require('../server/config/database').dbPool;users=require('../server/persistence/userRepository');teams=require('../server/persistence/teamRepository');pc=require('../server/persistence/pokemonStorageRepository');items=require('../server/persistence/itemRepository');factory=require('../server/game/drift/pokemonFactory');
 owner=await users.createUserWithStarter('pc_item_'+randomUUID(),randomUUID(),{starterId:7});other=await users.createUserWithStarter('pc_foreign_'+randomUUID(),randomUUID(),{starterId:7});
});
test.after(async()=>{if(!db)return;for(const u of[owner,other])if(u)await db.execute('DELETE FROM users WHERE id=?',[u.id]);await db.end();});
test.beforeEach(async()=>{
 if(!enabled)return;await db.execute('DELETE FROM pokemon_storage WHERE user_id=?',[owner.id]);await db.execute('DELETE FROM user_items WHERE user_id=?',[owner.id]);
 team=[9,94].map(id=>factory.create(id,30,true));team[0].heldItem='choice_scarf';team[0].currentHp=3;team[0].movePp[0]=0;await teams.editEquipe(owner.id,{pokemons:team});
 stored=factory.create(25,20,true);stored.heldItem='leftovers';stored.currentHp=2;stored.status='burn';stored.movePp[0]=0;await pc.storeCapturedPokemon(owner.id,stored);
 await db.execute("INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,'leftovers',2)",[owner.id]);
});
const request=(extra={})=>({action:'takeItem',source:'box',pokemonUuid:stored.uuid,expectedItem:'leftovers',...extra});
async function raw(){const[[row]]=await db.execute('SELECT pokemon_data FROM pokemon_storage WHERE user_id=? AND uuid=?',[owner.id,stored.uuid]);return typeof row.pokemon_data==='string'?JSON.parse(row.pokemon_data):row.pokemon_data;}
async function snapshot(){return{party:await teams.getTeamPokemons((await teams.getTeamRecord(owner.id)).id),entries:await pc.loadStorage(owner.id),raw:await raw(),items:await items.loadUserItems(owner.id)};}
test('SQL PC : l’objet rejoint le sac, seule la donnée held_item change, même avec des métadonnées inconnues',{skip:!enabled},async()=>{
 const data=await raw();data.futureMetadata={notes:['preserve'],version:99};await db.execute('UPDATE pokemon_storage SET pokemon_data=? WHERE user_id=? AND uuid=?',[JSON.stringify(data),owner.id,stored.uuid]);
 const before=await snapshot(),result=await pc.mutateStorage(owner.id,request()),after=await snapshot();assert.equal(result.takenItem,'leftovers');assert.equal(result.state.entries[0].pokemon.heldItem,null);assert.equal(result.state.entries[0].pokemon.heldItemName,null);
 assert.deepEqual(after.raw,{...before.raw,held_item:null});assert.deepEqual(after.party,before.party);assert.equal(after.entries.count,before.entries.count);assert.deepEqual(after.entries.entries.map(e=>[e.box,e.slot,e.pokemon.uuid]),before.entries.entries.map(e=>[e.box,e.slot,e.pokemon.uuid]));assert.equal(after.items.find(i=>i.key==='leftovers').quantity,3);
 await assert.rejects(pc.mutateStorage(owner.id,request()),/aucun objet/);assert.deepEqual(await snapshot(),after);
});
test('SQL PC : prendre aussi l’objet de l’équipe ne déplace ni ne soigne un Pokémon',{skip:!enabled},async()=>{
 const before=await snapshot();await pc.mutateStorage(owner.id,request({source:'team',pokemonUuid:team[0].uuid,expectedItem:'choice_scarf'}));const after=await snapshot();
 const expected=before.party.map(p=>({...p}));expected[0].held_item=null;assert.deepEqual(after.party,expected);assert.deepEqual(after.raw,before.raw);assert.equal(after.items.find(i=>i.key==='choice_scarf').quantity,1);assert.equal(after.items.find(i=>i.key==='leftovers').quantity,2);
});
test('SQL PC : propriétaire, emplacement, objet périmé et verrou d’échange vérifiés sans mutation',{skip:!enabled},async()=>{
 const before=await snapshot();for(const payload of[request({source:'team'}),request({expectedItem:'life_orb'}),request({expectedItem:null}),request({pokemonUuid:'foreign'})])await assert.rejects(pc.mutateStorage(owner.id,payload));
 await assert.rejects(pc.mutateStorage(other.id,request()),/emplacement/);
 const locks=require('../server/game/social/tradeLocks'),token=randomUUID();locks.acquire([owner.id],token);try{await assert.rejects(pc.mutateStorage(owner.id,request()),/échange/);}finally{locks.release([owner.id],token);}
 assert.deepEqual(await snapshot(),before);
});
test('SQL PC : deux demandes simultanées rendent exactement un objet',{skip:!enabled},async()=>{
 const result=await Promise.allSettled([pc.mutateStorage(owner.id,request()),pc.mutateStorage(owner.id,request())]);assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal(result.filter(r=>r.status==='rejected').length,1);assert.equal((await raw()).held_item,null);assert.equal((await items.loadUserItems(owner.id)).find(i=>i.key==='leftovers').quantity,3);
});
test('SQL PC : échec d’ajout au sac annule aussi le retrait de l’objet',{skip:!enabled},async()=>{
 const before=await snapshot(),acquire=db.getConnection.bind(db);db.getConnection=async()=>{
  const c=await acquire(),execute=c.execute.bind(c);c.execute=async(sql,...args)=>{if(sql.startsWith('INSERT INTO user_items'))throw Error('injected_bag_failure');return execute(sql,...args);};const release=c.release.bind(c);c.release=()=>{c.execute=execute;c.release=release;release();};return c;
 };
 try{await assert.rejects(pc.mutateStorage(owner.id,request()),/injected_bag_failure/);}finally{db.getConnection=acquire;}
 assert.deepEqual(await snapshot(),before);
});
