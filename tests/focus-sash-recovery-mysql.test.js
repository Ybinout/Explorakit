const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{randomUUID}=require('node:crypto');
const enabled=process.env.RUN_MYSQL_TESTS==='1';let db,users,teams,factory;
test.before(()=>{if(!enabled)return;if(!/test/i.test(process.env.DB_NAME||''))throw Error('Dedicated test database required');db=require('../server/config/database').dbPool;users=require('../server/persistence/userRepository');teams=require('../server/persistence/teamRepository');factory=require('../server/game/drift/pokemonFactory');});
test.after(async()=>{await db?.end();});
for(const type of ['wild','trainer'])for(const ending of ['fled','disconnect','victory','defeat'])test(`SQL ${type} ${ending}: used sash stays inactive in the live fight, persists safely and returns after cleanup`,{skip:!enabled},async()=>{
 let user;const random=Math.random;try{
  user=await users.createUserWithStarter('sash_'+randomUUID(),'Sash-test-password-2026',{starterId:7,sprite:'sprite.png'});
  const lead=factory.create(143,50,true),foe=factory.create(68,50,true);lead.passiveAbility=foe.passiveAbility=null;foe.heldItem=null;
  lead.heldItem='focus_sash';lead.abilities=['Splash','Tackle'];lead.movePp=[40,35];lead.currentAttack=99999;lead.currentSpeed=999;lead.maxHp=lead.currentHp=40;
  foe.abilities=['Seismic Toss'];foe.movePp=[20];await teams.editEquipe(user.id,{pokemons:[lead]});
  const player={id:'sash-owner',userId:user.id,currentmap:'route1',equipe:{pokemons:[lead]}},events=[];let turn=0,midSaved=false,error;
  const socket=new EventEmitter(),emit=socket.emit.bind(socket);socket.emit=(event,...args)=>{
   if(event!=='requestAction')return emit(event,...args);
   const n=turn++;setImmediate(async()=>{try{
    if(n===0)return emit('actionResponse',{action:'attack',number:0});
    assert.equal(lead.currentHp,1);assert.equal(lead.heldItem,null);assert.equal(lead.__heldItemBeforeExchange,'focus_sash');
    await teams.editEquipe(user.id,player.equipe);assert.equal((await teams.loadEquipe(user.id)).pokemons[0].heldItem,'focus_sash');assert.equal(lead.heldItem,null);midSaved=true;
    if(ending==='disconnect')emit('disconnect');else emit('actionResponse',ending==='fled'?{action:'flee'}:{action:'attack',number:ending==='victory'?1:0});
   }catch(e){error=e;emit('disconnect');}});return true;
  };
  const io={sockets:{sockets:new Map([[player.id,socket]])},to:()=>({emit:(event,data)=>events.push({event,data})})};Math.random=()=>.5;
  if(type==='wild')await require('../server/game/battle/wildBattle')(player,foe,io,user.id);else await require('../server/game/battle/trainerBattle')(player,{pokemons:[foe]},io,user.id,{grantBaseMoney:false});
  if(error)throw error;assert(midSaved);assert.equal(lead.heldItem,'focus_sash');assert.equal((await teams.loadEquipe(user.id)).pokemons[0].heldItem,'focus_sash');
  const [bag]=await db.execute("SELECT quantity FROM user_items WHERE user_id=? AND item_key='focus_sash'",[user.id]);assert(!bag.length||bag[0].quantity===0);
  const end=events.filter(e=>e.event==='endbattle');assert.equal(end.length,1);assert.equal(end[0].data.reason,ending==='disconnect'?'player_disconnected':ending);
 }finally{Math.random=random;if(user)await db.execute('DELETE FROM users WHERE id=?',[user.id]);}
});

test('SQL arena XP staging saves the original sash without reactivating it in the current battle',{skip:!enabled},async()=>{
 let user;const random=Math.random;try{
  user=await users.createUserWithStarter('sash_xp_'+randomUUID(),'Sash-test-password-2026',{starterId:7,sprite:'sprite.png'});
  const lead=factory.create(143,50,true),foe=factory.create(19,5,true),striker=factory.create(68,50,true);
  lead.passiveAbility=striker.passiveAbility=null;lead.heldItem='focus_sash';lead.maxHp=lead.currentHp=40;striker.abilities=['Seismic Toss'];striker.movePp=[20];
  const player={id:'sash-owner',userId:user.id,equipe:{pokemons:[lead]}};await teams.editEquipe(user.id,player.equipe);Math.random=()=>.5;
  require('../server/game/battle/battleEngine').useattack('Seismic Toss',striker,lead,{battleState:require('../server/game/battle/battleEngine').createBattleState()});assert.equal(lead.heldItem,null);
  const tracker=new(require('../server/game/battle/adventureExperience').AdventureExperience)();tracker.enter(lead,foe);foe.currentHp=0;
  await require('../server/game/battle/arenaExperience').createArenaExperience('sash_staged',[foe]).reward(user.id,player,foe,2,{to:()=>({emit(){}})},tracker);
  assert.equal(lead.heldItem,null);assert.equal(lead.__heldItemBeforeExchange,'focus_sash');assert.equal((await teams.loadEquipe(user.id)).pokemons[0].heldItem,'focus_sash');
  require('../server/game/battle/battleOutcome').clearBattleTransientState(player.equipe.pokemons);assert.equal(lead.heldItem,'focus_sash');
 }finally{Math.random=random;if(user)await db.execute('DELETE FROM users WHERE id=?',[user.id]);}
});
