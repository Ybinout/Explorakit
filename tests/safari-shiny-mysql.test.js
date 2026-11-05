const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{randomUUID}=require('node:crypto');
const enabled=process.env.RUN_MYSQL_TESTS==='1';let db,users,teams,pc,progress,flight,user;
test.before(async()=>{if(!enabled)return;if(process.env.DB_NAME!=='explorakit_test')throw Error('Dedicated test DB required');process.env.BATTLE_DELAY_SCALE='0';process.env.NODE_ENV='test';
 db=require('../server/config/database').dbPool;users=require('../server/persistence/userRepository');teams=require('../server/persistence/teamRepository');pc=require('../server/persistence/pokemonStorageRepository');progress=require('../server/persistence/progressionRepository');flight=require('../server/persistence/flightRepository');user=await users.createUserWithStarter('Safari_'+randomUUID().slice(0,8),randomUUID());
});
test.after(async()=>{if(db){if(user)await db.execute('DELETE FROM users WHERE id=?',[user.id]);await db.end();}});
for(const size of[1,6])test('SQL: real shiny Gen5 capture to '+(size===6?'PC':'party')+', dex, party/PC transfers and reconnect preserve exact identity',{skip:!enabled,timeout:30000},async()=>{
 const factory=require('../server/game/drift/pokemonFactory'),team=Array.from({length:size},()=>factory.create(129,30,true));await teams.editEquipe(user.id,{pokemons:team});await db.execute('DELETE FROM pokemon_storage WHERE user_id=?',[user.id]);
 const target=await require('../server/game/world/wildPokemonFactory').createAtLevel(570,5);target.shiny=true;target.passiveAbility='Illusion';target.heldItem='life_orb';target.currentHp=1;
 await db.execute("INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,'pokeball',1) ON DUPLICATE KEY UPDATE quantity=1",[user.id]);
 const socket=new EventEmitter(),send=socket.emit.bind(socket);socket.connected=true;socket.emit=(event,data)=>{if(event==='requestAction'){setImmediate(()=>send('actionResponse',{action:'bag',itemKey:'pokeball'}));return true;}return send(event,data);};
 const events=[],io={sockets:{sockets:new Map([['owner',socket]])},to:()=>({emit:(event,data)=>events.push({event,data})})},p={id:'owner',userId:user.id,currentmap:'safari1',equipe:{pokemons:team}};
 const old=Math.random;try{Math.random=()=>0;await require('../server/game/battle/wildBattle')(p,target,io,user.id);}finally{Math.random=old;}
 assert(events.some(e=>e.event==='captureAnimation'&&e.data.success));
 const caught=size===6?(await pc.loadEntries(user.id))[0].pokemon:(await teams.loadEquipe(user.id)).pokemons.at(-1);assert.equal(caught.uuid,target.uuid);assert(caught.shiny);assert.equal(caught.data.id,570);assert.equal(caught.passiveAbility,'Illusion');assert.equal(caught.heldItem,'life_orb');assert.deepEqual(caught.iv,target.iv);
 if(size===6)await pc.mutateStorage(user.id,{action:'swap',pokemonUuid:caught.uuid,teamUuid:team[0].uuid});else{await pc.mutateStorage(user.id,{action:'deposit',pokemonUuid:caught.uuid,box:2});await pc.mutateStorage(user.id,{action:'withdraw',pokemonUuid:caught.uuid});}
 const loaded=(await teams.loadEquipe(user.id)).pokemons.find(q=>q.uuid===caught.uuid);assert(loaded.shiny);
 const dex=await progress.loadPokedex(user.id),entry=dex.entries.find(q=>q.id===570);assert(entry.shinySeen&&entry.shinyCaught);assert.equal(dex.total,649);
 const [[before]]=await db.execute('SELECT shiny_seen_count,shiny_caught_count FROM user_pokedex WHERE user_id=? AND pokemon_id=570',[user.id]);await progress.synchronizeCaughtPokemon(user.id,[loaded]);await progress.synchronizeCaughtPokemon(user.id,[loaded]);const [[after]]=await db.execute('SELECT shiny_seen_count,shiny_caught_count FROM user_pokedex WHERE user_id=? AND pokemon_id=570',[user.id]);assert.deepEqual(after,before);
});
test('SQL: Safari flight unlock requires the actual Center, persists on reconnect, and is not reconstructed from merely owning Flight',{skip:!enabled},async()=>{
 await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,'fly_module_received','true') ON DUPLICATE KEY UPDATE flag_value='true'",[user.id]);
 assert.equal(await flight.recordTownVisit(user.id,'safari8'),false);assert.equal(await flight.recordTownVisit(user.id,'safari_shop'),false);assert(!(await flight.loadFlightState(user.id)).visited.includes('safari8'));
 assert(await flight.recordTownVisit(user.id,'centre',{map:'safari8',x:208,y:272}));assert((await flight.loadFlightState(user.id)).visited.includes('safari8'));assert.equal(await flight.recordTownVisit(user.id,'centre',{map:'safari8'}),false);
 await flight.reconcileFlightProgress(user.id);assert((await flight.loadFlightState(user.id)).visited.includes('safari8'));
});
