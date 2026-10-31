const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{randomUUID}=require('node:crypto');
const enabled=process.env.RUN_MYSQL_TESTS==='1';process.env.NODE_ENV='test';process.env.BATTLE_DELAY_SCALE='0';let db,users,teams,factory;
test.before(()=>{if(!enabled)return;if(process.env.DB_NAME!=='explorakit_test')throw Error('Dedicated test DB required');db=require('../server/config/database').dbPool;users=require('../server/persistence/userRepository');teams=require('../server/persistence/teamRepository');factory=require('../server/game/drift/pokemonFactory');});
test.after(async()=>{await db?.end();});
for(const kind of ['wild','trainer'])test(`SQL ${kind} real turn publishes encounter kind and anonymous injured party states`,{skip:!enabled},async()=>{
 let user;const random=Math.random;try{
  user=await users.createUserWithStarter('indicator_'+randomUUID(),randomUUID(),{starterId:7});const lead=factory.create(9,30,true);lead.abilities=['Dragon Rage'];lead.movePp=[10];lead.passiveAbility=null;lead.heldItem=null;await teams.editEquipe(user.id,{pokemons:[lead]});
  const foes=[143,143,143].map(id=>{const p=factory.create(id,30,true);p.abilities=['Splash'];p.movePp=[40];p.passiveAbility=null;p.heldItem=null;p.maxHp=p.currentHp=1000;return p;});
  const player={id:'indicator-player',userId:user.id,currentmap:'centre',equipe:{pokemons:[lead]}},events=[],socket=new EventEmitter();let turn=0;
  socket.on('requestAction',()=>setImmediate(()=>socket.emit('actionResponse',turn++===0?{action:'attack',number:0}:{action:'flee'})));
  const io={sockets:{sockets:new Map([[player.id,socket]])},to:()=>({emit:(name,payload)=>events.push({name,payload:structuredClone(payload)})})};Math.random=()=>.5;
  if(kind==='wild')await require('../server/game/battle/wildBattle')(player,foes[0],io,user.id);else await require('../server/game/battle/trainerBattle')(player,{pokemons:foes},io,user.id);
  const frames=events.filter(e=>e.name==='introAnimation').map(e=>e.payload);assert(frames.length>=2);assert(frames.every(f=>f.battleType===kind));
  if(kind==='trainer'){assert.deepEqual(frames[0].opponentPartyStates,['ready','ready','ready']);assert(frames.some(f=>f.opponentPartyStates.includes('hurt')));assert(frames.every(f=>f.opponentParty.every(value=>typeof value==='boolean')));}
  else assert(frames.every(f=>!f.opponentParty&&!f.opponentPartyStates));
 }finally{Math.random=random;if(user)await db.execute('DELETE FROM users WHERE id=?',[user.id]);}
});
