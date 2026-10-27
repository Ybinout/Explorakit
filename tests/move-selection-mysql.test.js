const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{randomUUID}=require('node:crypto');
const enabled=process.env.RUN_MYSQL_TESTS==='1';let db,users,teams,factory;
test.before(()=>{if(!enabled)return;if(!/test/i.test(process.env.DB_NAME||''))throw Error('Dedicated test database required');db=require('../server/config/database').dbPool;users=require('../server/persistence/userRepository');teams=require('../server/persistence/teamRepository');factory=require('../server/game/drift/pokemonFactory');});test.after(async()=>{await db?.end();});
class Socket extends EventEmitter{constructor(){super();this.turns=0;}emit(event){if(event==='requestAction'){const turn=this.turns++;setImmediate(()=>turn<5?super.emit('actionResponse',{action:'attack',number:0}):super.emit('disconnect'));return true;}return super.emit(...arguments);}}
for(const type of['wild','trainer'])test(`SQL Adventure ${type}: no repeated Bluff after actual execution, including legacy state without action counter`,{skip:!enabled},async()=>{
 let user;const random=Math.random;
 try{
  user=await users.createUserWithStarter('select_'+randomUUID(),'Move-selection-test-2026',{starterId:7,sprite:'sprite.png'});
  const lead=factory.create(143,30,true);lead.passiveAbility=null;lead.abilities=['Splash'];lead.movePp=[40];lead.currentHp=lead.maxHp=10000;
  const foe=factory.create(53,30,true);foe.passiveAbility=null;foe.abilities=['Fake Out','Scratch'];foe.movePp=[10,35];
  await teams.editEquipe(user.id,{pokemons:[lead]});const player={id:'owner',userId:user.id,currentmap:'route1',equipe:{pokemons:[lead]}},socket=new Socket(),moves=[];
  const io={sockets:{sockets:new Map([['owner',socket]])},to:()=>({emit:(event,data)=>{
   if(event==='battleMoveResult'&&data.actor==='opponent'){moves.push(data.moveName);delete foe.__battle.activeMoveActions;}
  }})};Math.random=()=>0;
  if(type==='wild')await require('../server/game/battle/wildBattle')(player,foe,io,user.id);
  else await require('../server/game/battle/trainerBattle')(player,{pokemons:[foe]},io,user.id,{grantBaseMoney:false});
  assert(moves.length>=4);assert(moves.slice(1).every(m=>m==='Scratch'),JSON.stringify(moves));assert.equal(foe.movePp[0],moves[0]==='Fake Out'?9:10);assert.equal((await teams.loadEquipe(user.id)).pokemons[0].uuid,lead.uuid);
 }finally{Math.random=random;if(user)await db.execute('DELETE FROM users WHERE id=?',[user.id]);}
});
