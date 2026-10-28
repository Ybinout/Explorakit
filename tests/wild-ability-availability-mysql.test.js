const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{randomUUID}=require('node:crypto');
const enabled=process.env.RUN_MYSQL_TESTS==='1';let db,users,teams,pc,wildFactory,factory;
test.before(()=>{
 if(!enabled)return;
 assert.match(process.env.DB_NAME||'',/test/i,'Dedicated test database required');
 process.env.BATTLE_DELAY_SCALE='0';process.env.NODE_ENV='test';
 db=require('../server/config/database').dbPool;users=require('../server/persistence/userRepository');teams=require('../server/persistence/teamRepository');pc=require('../server/persistence/pokemonStorageRepository');wildFactory=require('../server/game/world/wildPokemonFactory');factory=require('../server/game/drift/pokemonFactory');
});
test.after(async()=>{await db?.end();});
for(const partySize of [1,6])test(`Adventure SQL: real captures to ${partySize===6?'PC':'party'} keep ordinary/hidden abilities after transient copies, PC swaps, saves and reload`,{skip:!enabled,timeout:30000},async()=>{
 const oldRandom=Math.random;let user;
 try{
  user=await users.createUserWithStarter('wild_ability_'+randomUUID(),'Wild-ability-test-2026',{starterId:7,sprite:'sprite.png'});
  for(const [id,roll,name]of[[37,0,'Drought'],[63,0,'Magic Guard'],[130,0,'Moxie'],[143,0,'Gluttony'],[132,0,'Imposter'],[280,.1,'Synchronize'],[280,.99,'Trace'],[328,.1,'Hyper Cutter'],[328,.99,'Arena Trap'],[133,.99,'Adaptability'],[133,0,'Anticipation']]){
   Math.random=()=>roll;const target=await wildFactory.createAtLevel(id,5);assert.equal(target.passiveAbility,name);Math.random=oldRandom;
   const team=Array.from({length:partySize},()=>factory.create(129,30,true));team.forEach(p=>{p.abilities=['Splash'];p.movePp=[40];});
   await teams.editEquipe(user.id,{pokemons:team});await db.execute('DELETE FROM pokemon_storage WHERE user_id=?',[user.id]);await db.execute('INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,?,1) ON DUPLICATE KEY UPDATE quantity=1',[user.id,'pokeball']);
   const socket=new EventEmitter(),send=socket.emit.bind(socket);socket.connected=true;socket.emit=(event,data)=>{if(event==='requestAction'){setImmediate(()=>send('actionResponse',{action:'bag',itemKey:'pokeball'}));return true;}return send(event,data);};
   const events=[],io={sockets:{sockets:new Map([['owner',socket]])},to:()=>({emit:(event,data)=>events.push({event,data})})};
   const player={id:'owner',userId:user.id,currentmap:'start',equipe:{pokemons:team}};
   Math.random=()=>0;await require('../server/game/battle/wildBattle')(player,target,io,user.id);Math.random=oldRandom;
   assert(events.some(e=>e.event==='captureAnimation'&&e.data.success),name);assert.equal(target.passiveAbility,name);assert(!Object.hasOwn(target,'__passiveAbilityBeforeBattle'));
   const saved=partySize===6?(await pc.loadEntries(user.id))[0].pokemon:(await teams.loadEquipe(user.id)).pokemons.at(-1);
   assert.equal(saved.uuid,target.uuid);assert.equal(saved.passiveAbility,name);assert.equal(saved.data.id,id);assert.deepEqual(saved.iv,target.iv);assert.deepEqual(saved.abilities,target.abilities);
   if(partySize===6){await pc.mutateStorage(user.id,{action:'swap',pokemonUuid:target.uuid,teamUuid:team[0].uuid});const reloaded=(await teams.loadEquipe(user.id)).pokemons[0];assert.equal(reloaded.passiveAbility,name);assert.equal(reloaded.uuid,target.uuid);}
   else{await pc.mutateStorage(user.id,{action:'deposit',pokemonUuid:target.uuid,box:0});assert.equal((await pc.loadEntries(user.id))[0].pokemon.passiveAbility,name);await pc.mutateStorage(user.id,{action:'withdraw',pokemonUuid:target.uuid});assert.equal((await teams.loadEquipe(user.id)).pokemons.at(-1).passiveAbility,name);}
   if(id===133){
    await db.execute('INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,?,1) ON DUPLICATE KEY UPDATE quantity=1',[user.id,'water_stone']);
    Math.random=()=>0;await require('../server/persistence/evolutionRepository').evolvePokemonWithStone(user.id,target.uuid,'water_stone');Math.random=oldRandom;
    const evolved=(await teams.loadEquipe(user.id)).pokemons.find(p=>p.uuid===target.uuid);assert.equal(evolved.data.id,134);assert.equal(evolved.passiveAbility,name==='Anticipation'?'Hydration':'Water Absorb');
   }
  }
 }finally{Math.random=oldRandom;if(user)await db.execute('DELETE FROM users WHERE id=?',[user.id]);}
});
