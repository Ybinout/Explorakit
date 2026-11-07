const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{randomUUID}=require('node:crypto');
const enabled=process.env.RUN_MYSQL_TESTS==='1';let db,users,teams,factory;
test.before(()=>{if(!enabled)return;assert.equal(process.env.DB_NAME,'explorakit_test');process.env.NODE_ENV='test';process.env.BATTLE_DELAY_SCALE='0';db=require('../server/config/database').dbPool;users=require('../server/persistence/userRepository');teams=require('../server/persistence/teamRepository');factory=require('../server/game/drift/pokemonFactory');});
test.after(async()=>{await db?.end();});
class Socket extends EventEmitter{constructor(steps){super();this.steps=steps;this.connected=true;}emit(name,data){if(name!=='requestAction')return super.emit(name,data);const step=this.steps.shift()||{action:'disconnect'};setImmediate(()=>step.action==='disconnect'?(this.connected=false,super.emit('disconnect')):super.emit('actionResponse',{...step,turnId:data.turnId,replacementId:data.replacementId}));return true;}}
function mon(id,move,ability,item=null){const p=factory.create(id,50,true);p.passiveAbility=ability;p.heldItem=item;p.abilities=[move];p.movePp=[require('../server/game/battle/battleResources').getMaxMovePp(move)];return p;}
async function fixture(pokemon,move=0){const u=await users.createUserWithStarter('talent_review_'+randomUUID(),randomUUID(),{starterId:7}),player={id:'ability-review-'+u.id,userId:u.id,username:u.username,currentmap:'ville1_shop',equipe:{pokemons:[pokemon]}},socket=new Socket([{action:'attack',number:move},{action:'disconnect'}]);await teams.editEquipe(u.id,player.equipe);return{u,player,socket,cleanup:()=>db.execute('DELETE FROM users WHERE id=?',[u.id])};}
for(const mode of ['wild','trainer','pvp'])for(const scenario of ['synchronize','sticky_hold'])test('SQL '+mode+': '+scenario+' uses the shared corrected ability hooks and restores durable ownership',{skip:!enabled,timeout:15000},async()=>{
 let f,rival;const previousRandom=Math.random;Math.random=()=>.5;
 try{
  const a=scenario==='synchronize'?mon(65,'Toxic',null):mon(409,'Thief','Mold Breaker');
  const d=scenario==='synchronize'?mon(196,'Splash','Synchronize'):mon(316,'Splash','Sticky Hold','leftovers');
  a.currentSpeed=999;f=await fixture(a);
  const events=[],io={sockets:{sockets:new Map([[f.player.id,f.socket]])},to:id=>({emit:(name,data)=>events.push({id,name,data:structuredClone(data)})})};
  if(mode==='pvp'){rival=await fixture(d);io.sockets.sockets.set(rival.player.id,rival.socket);await require('../server/game/battle/pvpBattle').startPvpBattle(f.player,rival.player,io);}
  else if(mode==='wild')await require('../server/game/battle/wildBattle')(f.player,d,io,f.u.id);
  else await require('../server/game/battle/trainerBattle')(f.player,{pokemons:[d]},io,f.u.id,{recordPokedex:false,grantBaseMoney:false});
  const texts=events.filter(e=>e.id===f.player.id&&e.name==='battleText').map(e=>e.data.message),saved=(await teams.loadEquipe(f.u.id)).pokemons[0];
  if(scenario==='synchronize'){assert.equal(saved.status,'badly_poison');assert.equal(d.status,'badly_poison');}
  else{assert(texts.some(t=>t.includes('récupère l’objet tenu')));assert(!saved.heldItem);if(rival){assert.equal(d.heldItem,'leftovers');assert.equal((await teams.loadEquipe(rival.u.id)).pokemons[0].heldItem,'leftovers');}}
  assert(events.some(e=>e.id===f.player.id&&e.name==='endbattle'));
 }finally{Math.random=previousRandom;await rival?.cleanup();await f?.cleanup();}
});
for(const mode of ['wild','trainer','pvp'])test('SQL '+mode+': Drifblim contact KO really triggers Aftermath before the battle ends',{skip:!enabled,timeout:15000},async()=>{
 let f,rival;const previousRandom=Math.random;Math.random=()=>.5;
 try{
  const a=mon(68,'Bite','Keen Eye'),d=mon(426,'Splash','Aftermath');d.currentHp=1;a.currentSpeed=999;
  f=await fixture(a);const events=[],io={sockets:{sockets:new Map([[f.player.id,f.socket]])},to:id=>({emit:(name,data)=>events.push({id,name,data:structuredClone(data)})})};
  if(mode==='pvp'){rival=await fixture(d);io.sockets.sockets.set(rival.player.id,rival.socket);await require('../server/game/battle/pvpBattle').startPvpBattle(f.player,rival.player,io);}
  else if(mode==='wild')await require('../server/game/battle/wildBattle')(f.player,d,io,f.u.id);
  else await require('../server/game/battle/trainerBattle')(f.player,{pokemons:[d]},io,f.u.id,{recordPokedex:false,grantBaseMoney:false});
  const texts=events.filter(e=>e.id===f.player.id&&e.name==='battleText').map(e=>e.data.message);assert(texts.some(t=>t.includes('Aftermath')),JSON.stringify(texts));assert(events.some(e=>e.id===f.player.id&&e.name==='endbattle'));
  if(mode!=='pvp'){const saved=(await teams.loadEquipe(f.u.id)).pokemons[0];assert(saved.currentHp<saved.maxHp,'Aftermath HP cost must persist after a final KO');}
 }finally{Math.random=previousRandom;await rival?.cleanup();await f?.cleanup();}
});
