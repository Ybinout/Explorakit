const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
test('real House controller: mutant berries activate on battle copies, remain owned in PvE, and still consume in PvP',{skip:process.env.RUN_MYSQL_TESTS!=='1'},async()=>{
 assert.equal(process.env.DB_NAME,'explorakit_test');
 const {dbPool:db}=require('../server/config/database'),users=require('../server/persistence/userRepository');
 const teams=require('../server/persistence/teamRepository'),pc=require('../server/persistence/pokemonStorageRepository');
 const {createDuelHouse}=require('../server/game/whitepeak/duelHouse'),rules=require('../server/game/whitepeak/rules');
 const factory=require('../server/game/drift/pokemonFactory'),ids=[],contexts=new Map();
 const item='mutant_stat_attack_common_berry';let room=null,time=100000,house;
 const held=async id=>(await teams.loadEquipe(id)).pokemons[0].heldItem;
 const receipts=async id=>Number((await db.execute('SELECT COUNT(*) n FROM berry_consumption_receipts WHERE user_id=?',[id]))[0][0].n);
 try{
  for(let i=0;i<2;i++){
   const u=await users.createUserWithStarter('TrainingBerry_'+randomUUID().slice(0,8),randomUUID());ids.push(u.id);
   const first=factory.create(143,100,true),second=factory.create(9,100,true);for(const p of[first,second]){p.abilities=['Splash'];p.movePp=[40];p.heldItem=null;}first.heldItem=item;
   await teams.editEquipe(u.id,{pokemons:[first,second]});
   const reserve=factory.create(35,100,true);reserve.heldItem=item;await pc.storeCapturedPokemon(u.id,reserve);
   const player={currentmap:rules.HALL,x:13*32+16,y:5*32+16,equipe:await teams.loadEquipe(u.id),inventoryBusy:false,inbattle:false};
   const socket={connected:true,handshake:{auth:{houseDoubles:1}},emit(){}};
   contexts.set(u.id,{id:u.id,username:u.username,socket,account:{active:()=>socket.connected},getPlayer:()=>player,canUse:()=>true,reload:async()=>{player.equipe=await teams.loadEquipe(u.id);}});
  }
  house=createDuelHouse({contexts,getRoom:()=>room,setRoom:r=>{room=r;},emitRoom(){},now:()=>time,emitSpectator(){},wallet(){}});
  const saved=await held(ids[0]),before=pc.encodePokemon((await pc.loadEntries(ids[0]))[0].pokemon);
  for(const win of[true,false]){
   await house.create(ids[0],rules.settings({mode:'pve',trainerKey:'dia1',level:100}));assert.equal(room.phase,'battle');
   const active=room.copies[0].equipe.pokemons[0];assert.equal(active.heldItem,null);assert(active.__battle.mutationBerry);assert(active.__berrySpent.some(r=>r.itemKey===item));
   assert.equal(await held(ids[0]),saved);assert.equal(await receipts(ids[0]),0);
   time+=2000;await house.tick();assert.equal(await held(ids[0]),saved);assert.equal(await receipts(ids[0]),0);
   room.engine.finish(room.copies[win?0:1],win?'finished':'abandoned');await house.tick();assert.equal(room.phase,'finished');
   assert.equal(await held(ids[0]),saved);assert.equal(await receipts(ids[0]),0);assert.equal(contexts.get(ids[0]).getPlayer().equipe.pokemons[0].heldItem,item);
  }
  assert.equal(pc.encodePokemon((await pc.loadEntries(ids[0]))[0].pokemon),before);
  await house.create(ids[0],rules.settings({mode:'1v1',level:100}));
  for(const[i,id]of ids.entries()){Object.assign(contexts.get(id).getPlayer(),{x:(i?19:8)*32+16,y:8*32+16});await house.step(id);}
  assert.equal(room.phase,'preparation');for(const id of ids){const side=room.sides.find(s=>s.ids.includes(id));await house.command('confirm',id,{id:room.id,sideRevision:side.revision});}
  assert.equal(room.phase,'battle');for(const id of ids){assert.equal(await held(id),null);assert.equal(await receipts(id),1);}
  room.engine.finish(room.copies[0],'finished');await house.tick();assert.equal(room.phase,'finished');for(const id of ids)assert.equal(await receipts(id),1);
 }finally{
  if(room?.phase==='battle'){room.engine.finish(null,'interrupted');await house.tick();}
  for(const id of ids)await db.execute('DELETE FROM users WHERE id=?',[id]);await db.end();
 }
});
