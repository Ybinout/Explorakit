const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{randomUUID}=require('node:crypto');
const enabled=process.env.RUN_MYSQL_TESTS==='1';let db,users,teams,factory;
test.before(()=>{if(!enabled)return;if(!/test/i.test(process.env.DB_NAME||''))throw Error('Dedicated test database required');db=require('../server/config/database').dbPool;users=require('../server/persistence/userRepository');teams=require('../server/persistence/teamRepository');factory=require('../server/game/drift/pokemonFactory');});test.after(async()=>{await db?.end();});
for(const type of ['wild','trainer'])for(const scenario of ['bite-flinch','bite-no-flinch','bite-slower','feint','hyperspace'])test(`SQL ${type} ${scenario}: real damage, action order, PP and protection`,{skip:!enabled,timeout:15000},async()=>{
 let user;const old=Math.random;try{
  user=await users.createUserWithStarter('attacks_'+randomUUID(),'Attacks-test-password-2026',{starterId:7,sprite:'sprite.png'});
  const lead=factory.create(7,30,true),foe=factory.create(7,30,true);for(const p of [lead,foe]){p.passiveAbility=null;p.heldItem=null;p.currentHp=p.maxHp=10000;}
  const name=scenario==='feint'?'Feint':scenario==='hyperspace'?'Hyperspace Hole':'Bite';lead.abilities=[name];lead.movePp=[25];lead.currentSpeed=scenario==='bite-slower'||scenario==='hyperspace'?1:999;
  foe.abilities=[scenario==='feint'?'Protect':scenario==='hyperspace'?'Substitute':'Tackle'];foe.movePp=[35];foe.currentSpeed=100;
  const player={id:'owner',userId:user.id,currentmap:'route3',equipe:{pokemons:[lead]}};await teams.editEquipe(user.id,player.equipe);
  const events=[],socket=new EventEmitter(),emit=socket.emit.bind(socket);let prompt=0,error;
  socket.emit=(event,data)=>{if(event!=='requestAction')return emit(event,data);const n=prompt++;setImmediate(()=>{try{
   if(n===0)return emit('actionResponse',{action:'attack',number:0});
   const own=events.find(e=>e.event==='battleMoveResult'&&e.data.actor==='player');assert(own?.data.damage>0);assert.equal(lead.movePp[0],require('../server/game/battle/battleResources').getMaxMovePp(name)-1);
   if(scenario==='bite-flinch'){assert.equal(lead.currentHp,10000);assert.equal(foe.movePp[0],35);assert(events.some(e=>e.event==='battleText'&&/apeuré/.test(e.data.message)));}
   else if(scenario.startsWith('bite-')){assert(lead.currentHp<10000);assert.equal(foe.movePp[0],34);}
   else if(scenario==='feint'){assert(foe.currentHp<10000);assert.equal(foe.__battle.protect,false);assert(events.some(e=>e.event==='battleText'&&/brise la protection/.test(e.data.message)));}
   else {assert(foe.currentHp<7500);assert.equal(foe.__battle.substituteHp,2500);}
   emit('disconnect');
  }catch(e){error=e;emit('disconnect');}});return true;};
  const io={sockets:{sockets:new Map([['owner',socket]])},to:()=>({emit:(event,data)=>events.push({event,data:JSON.parse(JSON.stringify(data))})})};Math.random=()=>scenario==='bite-no-flinch'?.9:0;
  if(type==='wild')await require('../server/game/battle/wildBattle')(player,foe,io,user.id);else await require('../server/game/battle/trainerBattle')(player,{pokemons:[foe]},io,user.id,{grantBaseMoney:false});
  if(error)throw error;assert.equal(prompt,2);assert.equal((await teams.loadEquipe(user.id)).pokemons[0].movePp[0],lead.movePp[0]);assert.equal(events.filter(e=>e.event==='endbattle').length,1);
 }finally{Math.random=old;if(user)await db.execute('DELETE FROM users WHERE id=?',[user.id]);}
});
