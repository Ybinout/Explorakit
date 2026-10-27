const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{randomUUID}=require('node:crypto');
const enabled=process.env.RUN_MYSQL_TESTS==='1';let db,users,teams,factory;
test.before(()=>{if(!enabled)return;if(!/test/i.test(process.env.DB_NAME||''))throw Error('Dedicated test database required');db=require('../server/config/database').dbPool;users=require('../server/persistence/userRepository');teams=require('../server/persistence/teamRepository');factory=require('../server/game/drift/pokemonFactory');});test.after(async()=>{await db?.end();});
for(const type of ['wild','trainer'])for(const item of ['choice_band','choice_specs','choice_scarf'])test(`SQL ${type} ${item}: only locked attack is offered, invalid input keeps the same turn`,{skip:!enabled,timeout:15000},async()=>{
 let user;const old=Math.random;try{
  user=await users.createUserWithStarter('choice_'+randomUUID(),'Choice-test-password-2026',{starterId:7,sprite:'sprite.png'});
  const lead=factory.create(143,30,true),foe=factory.create(143,30,true);for(const p of [lead,foe]){p.passiveAbility=null;p.maxHp=p.currentHp=10000;}
  lead.heldItem=item;lead.abilities=['Tackle','Crunch'];lead.movePp=[35,15];foe.abilities=['Splash'];foe.movePp=[40];await teams.editEquipe(user.id,{pokemons:[lead]});
  const player={id:'owner',userId:user.id,currentmap:'route1',equipe:{pokemons:[lead]}},events=[];let turn=0,error,afterFirst;
  const socket=new EventEmitter(),emit=socket.emit.bind(socket);socket.emit=(event,data)=>{
   if(event!=='requestAction')return emit(event,data);const n=turn++;
   setImmediate(()=>{try{
    const state=events.filter(e=>e.event==='introAnimation').at(-1)?.data;
    assert.deepEqual(state?.usableMoveIndexes,n===0?[0,1]:[0]);
    if(n===0)return emit('actionResponse',{action:'attack',number:0});
    if(n===1){afterFirst=[...lead.movePp,foe.movePp[0],lead.currentHp,foe.currentHp];return emit('actionResponse',{action:'attack',number:1});}
    if(n===2){assert.deepEqual([...lead.movePp,foe.movePp[0],lead.currentHp,foe.currentHp],afterFirst);return emit('actionResponse',{action:'attack',number:0});}
    return emit('actionResponse',{action:'flee'});
   }catch(e){error=e;emit('disconnect');}});return true;
  };
  const io={sockets:{sockets:new Map([['owner',socket]])},to:()=>({emit:(event,data)=>events.push({event,data:JSON.parse(JSON.stringify(data))})})};Math.random=()=>.5;
  if(type==='wild')await require('../server/game/battle/wildBattle')(player,foe,io,user.id);else await require('../server/game/battle/trainerBattle')(player,{pokemons:[foe]},io,user.id,{grantBaseMoney:false});
  if(error)throw error;assert.equal(turn,4);assert.equal(lead.movePp[0],33);assert.equal(lead.movePp[1],15);assert.equal(foe.movePp[0],38);assert.equal((await teams.loadEquipe(user.id)).pokemons[0].heldItem,item);
  assert.equal(events.filter(e=>e.event==='battleMoveResult'&&e.data.actor==='player'&&e.data.moveName==='Tackle').length,2);
 }finally{Math.random=old;if(user)await db.execute('DELETE FROM users WHERE id=?',[user.id]);}
});
test('SQL PvP: each side sees its own lock and an invalid command preserves the other committed choice',{skip:!enabled,timeout:15000},async()=>{
 const made=[];const old=Math.random;try{
  const players=[];for(const item of ['choice_band','choice_specs']){
   const u=await users.createUserWithStarter('choice_'+randomUUID(),'Choice-test-password-2026',{starterId:7,sprite:'sprite.png'});made.push(u.id);
   const p=factory.create(143,30,true);p.passiveAbility=null;p.heldItem=item;p.abilities=['Tackle','Crunch'];p.movePp=[35,15];p.maxHp=p.currentHp=10000;
   const owner={id:'p'+u.id,userId:u.id,currentmap:'route1',equipe:{pokemons:[p]}};await teams.editEquipe(u.id,owner.equipe);players.push(owner);
  }
  const events=[],sockets=new Map(),counts=[0,0];let error;
  for(const [i,owner] of players.entries()){
   const socket=new EventEmitter(),emit=socket.emit.bind(socket);sockets.set(owner.id,socket);socket.emit=(event,data)=>{
    if(event!=='requestAction')return emit(event,data);const n=counts[i]++;
    setImmediate(()=>{try{
     const state=events.filter(e=>e.id===owner.id&&e.event==='introAnimation').at(-1)?.data;assert.deepEqual(state.usableMoveIndexes,n===0?[0,1]:[i]);
     if(n===0)return emit('actionResponse',{action:'attack',number:i});
     if(n===1&&i===0)return emit('actionResponse',{action:'attack',number:1});
     if((n===1&&i===1)||(n===2&&i===0))return emit('actionResponse',{action:'attack',number:i});
     emit('actionResponse',{action:'flee'});
    }catch(e){error=e;emit('actionResponse',{action:'flee'});}});return true;
   };
  }
  const io={sockets:{sockets},to:id=>({emit:(event,data)=>events.push({id,event,data:JSON.parse(JSON.stringify(data))})})};Math.random=()=>.5;
  await require('../server/game/battle/pvpBattle').startPvpBattle(...players,io);if(error)throw error;
  assert.deepEqual(counts,[4,3]);assert.deepEqual(players.map(p=>p.equipe.pokemons[0].movePp),[[33,15],[35,13]]);
  for(const p of players)assert.equal((await teams.loadEquipe(p.userId)).pokemons[0].heldItem,p.equipe.pokemons[0].heldItem);
 }finally{Math.random=old;for(const id of made)await db.execute('DELETE FROM users WHERE id=?',[id]);}
});
