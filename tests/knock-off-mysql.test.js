const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{randomUUID}=require('node:crypto');
const enabled=process.env.RUN_MYSQL_TESTS==='1';let db,users,teams,factory;
test.before(()=>{if(!enabled)return;if(!/test/i.test(process.env.DB_NAME||''))throw Error('Dedicated test database required');db=require('../server/config/database').dbPool;users=require('../server/persistence/userRepository');teams=require('../server/persistence/teamRepository');factory=require('../server/game/drift/pokemonFactory');});test.after(async()=>{await db?.end();});
for(const type of['wild','trainer'])for(const ending of['fled','disconnect'])test(`SQL ${type} ${ending}: removed in battle, original saved during combat and restored at end`,{skip:!enabled},async()=>{
 let user;const random=Math.random;try{
  user=await users.createUserWithStarter('knock_'+randomUUID(),'Knock-test-password-2026',{starterId:7,sprite:'sprite.png'});
  const lead=factory.create(143,30,true);lead.passiveAbility=null;lead.heldItem='leftovers';lead.abilities=['Splash'];lead.movePp=[40];lead.maxHp=lead.currentHp=5000;
  const foe=factory.create(197,30,true);foe.passiveAbility=null;foe.abilities=['Knock Off'];foe.movePp=[20];await teams.editEquipe(user.id,{pokemons:[lead]});
  const player={id:'owner',userId:user.id,currentmap:'route1',equipe:{pokemons:[lead]}},events=[];let turns=0,midSaved=false,error;
  const socket=new EventEmitter();const originalEmit=socket.emit.bind(socket);socket.emit=(event,...args)=>{
   if(event!=='requestAction')return originalEmit(event,...args);
   const turn=turns++;setImmediate(async()=>{try{
    if(turn===0)return originalEmit('actionResponse',{action:'attack',number:0});
    assert.equal(lead.heldItem,null);assert.equal(lead.__heldItemKnockedOff,'leftovers');await teams.editEquipe(user.id,player.equipe);assert.equal((await teams.loadEquipe(user.id)).pokemons[0].heldItem,'leftovers');midSaved=true;
    if(ending==='disconnect')originalEmit('disconnect');else originalEmit('actionResponse',{action:'flee'});
   }catch(e){error=e;originalEmit('disconnect');}});return true;
  };
  const io={sockets:{sockets:new Map([['owner',socket]])},to:()=>({emit:(event,data)=>events.push({event,data})})};Math.random=()=>0;
  if(type==='wild')await require('../server/game/battle/wildBattle')(player,foe,io,user.id);else await require('../server/game/battle/trainerBattle')(player,{pokemons:[foe]},io,user.id,{grantBaseMoney:false});
  if(error)throw error;assert(midSaved);assert.equal(lead.heldItem,'leftovers');assert.equal((await teams.loadEquipe(user.id)).pokemons[0].heldItem,'leftovers');const [bag]=await db.execute("SELECT quantity FROM user_items WHERE user_id=? AND item_key='leftovers'",[user.id]);assert(!bag.length||bag[0].quantity===0);assert.equal(events.filter(e=>e.event==='endbattle').length,1);
 }finally{Math.random=random;if(user)await db.execute('DELETE FROM users WHERE id=?',[user.id]);}
});
test('SQL arena XP staging preserves the live removed item while persisting its permanent ownership',{skip:!enabled},async()=>{
 let user;try{
  user=await users.createUserWithStarter('knock_xp_'+randomUUID(),'Knock-test-password-2026',{starterId:7,sprite:'sprite.png'});
  const lead=factory.create(143,30,true),foe=factory.create(19,5,true);lead.heldItem='leftovers';lead.passiveAbility=null;
  const player={id:'owner',userId:user.id,equipe:{pokemons:[lead]}};await teams.editEquipe(user.id,player.equipe);
  const engine=require('../server/game/battle/battleEngine');engine.knockOffHeldItem(foe,lead);assert.equal(lead.heldItem,null);
  const tracker=new(require('../server/game/battle/adventureExperience').AdventureExperience)();tracker.enter(lead,foe);foe.currentHp=0;
  const arena=require('../server/game/battle/arenaExperience').createArenaExperience('knock_staged',[foe]);await arena.reward(user.id,player,foe,2,{to:()=>({emit(){}})},tracker);
  assert.equal(lead.heldItem,null);assert.equal(lead.__heldItemKnockedOff,'leftovers');assert.equal((await teams.loadEquipe(user.id)).pokemons[0].heldItem,'leftovers');require('../server/game/battle/battleOutcome').clearBattleTransientState(player.equipe.pokemons);assert.equal(lead.heldItem,'leftovers');
 }finally{if(user)await db.execute('DELETE FROM users WHERE id=?',[user.id]);}
});
