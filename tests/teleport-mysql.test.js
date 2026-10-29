const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{randomUUID}=require('node:crypto');
const enabled=process.env.RUN_MYSQL_TESTS==='1';let db,users,teams,factory,progress;
test.before(()=>{if(!enabled)return;if(!/test/i.test(process.env.DB_NAME||''))throw Error('Dedicated test database required');db=require('../server/config/database').dbPool;users=require('../server/persistence/userRepository');teams=require('../server/persistence/teamRepository');progress=require('../server/persistence/progressionRepository');factory=require('../server/game/drift/pokemonFactory');});test.after(async()=>{await db?.end();});
class Socket extends EventEmitter{constructor(actions){super();this.actions=actions;}emit(event,data){if(event==='requestAction'){const action=this.actions.shift()||{action:'disconnect'};setImmediate(()=>action.action==='disconnect'?super.emit('disconnect'):super.emit('actionResponse',action));return true;}return super.emit(event,data);}}
function mon(move,speed){const p=factory.create(63,20,true);p.passiveAbility=null;p.abilities=[];p.movePp=[];p.addAbility(move);p.currentSpeed=speed;return p;}
for(const scenario of['enemy-first','enemy-last','own-first','own-last','after-switch','after-failed-ball','asleep'])test(`SQL wild battle Teleport: ${scenario}`,{skip:!enabled},async()=>{
 let user;const oldRandom=Math.random;
 try{
  user=await users.createUserWithStarter('teleport_'+randomUUID(),'Teleport-test-password-2026',{starterId:7,sprite:'sprite.png'});
  const own=scenario.startsWith('own'),first=scenario.endsWith('first'),lead=mon(own?'Teleport':'Splash',first?own?999:1:own?1:999),reserve=mon('Splash',1),foe=mon(own?'Splash':'Teleport',first?own?1:999:own?999:1);
  if(scenario==='asleep'){foe.status='sleep';foe.__battle={sleepTurns:2};}
  const action=scenario==='after-switch'?{action:'change',number:1}:scenario==='after-failed-ball'?{action:'bag',itemKey:'pokeball'}:{action:'attack',number:0};
  const player={id:'owner',userId:user.id,currentmap:'route1',equipe:{pokemons:[lead,reserve]}},socket=new Socket([action]);const events=[],io={sockets:{sockets:new Map([['owner',socket]])},to:id=>({emit:(event,data)=>events.push({id,event,data})})};
  await teams.editEquipe(user.id,player.equipe);await db.execute("INSERT INTO user_items(user_id,item_key,quantity)VALUES(?,'pokeball',1)ON DUPLICATE KEY UPDATE quantity=1",[user.id]);
  const money=(await progress.loadProgressState(user.id)).money,xp=lead.experience,hp=lead.currentHp;Math.random=()=>.99;
  await require('../server/game/battle/wildBattle')(player,foe,io,user.id);
  const results=events.filter(e=>e.event==='endbattle');assert.equal(results.length,1);const result=results[0].data;
  if(scenario==='asleep'){assert.equal(result.escapeActor,undefined);assert.equal(result.summary.outcome,'interrupted');}
  else{assert.equal(result.escapeActor,own?'player':'opponent');assert.equal(result.reason,'fled');assert.equal(result.summary.outcome,'fled');assert.equal(result.summary.money,0);assert.deepEqual(result.summary.loot,[]);assert.deepEqual(result.summary.experience,[]);}
  const saved=await teams.loadEquipe(user.id);assert.equal(saved.pokemons[0].uuid,lead.uuid);assert.equal(saved.pokemons[0].experience,xp);assert.equal(saved.pokemons[0].currentHp,hp);assert.equal((await progress.loadProgressState(user.id)).money,money);
  if(scenario==='enemy-first')assert.equal(lead.movePp[0],39,'priority -6 allows player Splash before escape despite the wild speed');
  if(scenario==='own-first')assert.equal(foe.movePp[0],39,'priority -6 allows wild Splash before escape despite player speed');
 }finally{Math.random=oldRandom;if(user)await db.execute('DELETE FROM users WHERE id=?',[user.id]);}
});
