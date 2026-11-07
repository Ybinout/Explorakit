const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{randomUUID}=require('node:crypto');
const enabled=process.env.RUN_MYSQL_TESTS==='1';let db,users,teams,factory,resources;
test.before(()=>{if(!enabled)return;if(process.env.DB_NAME!=='explorakit_test')throw Error('Dedicated test database required');db=require('../server/config/database').dbPool;users=require('../server/persistence/userRepository');teams=require('../server/persistence/teamRepository');factory=require('../server/game/drift/pokemonFactory');resources=require('../server/game/battle/battleResources');});
test.after(async()=>{await db?.end();});
function mon(id,moves){const p=factory.create(id,50,true);p.passiveAbility=null;p.heldItem=null;p.abilities=[];p.movePp=[];for(const name of moves)p.addAbility(name);return p;}
class Socket extends EventEmitter{constructor(steps){super();this.steps=steps;this.prompts=[];this.connected=true;}emit(event,data){if(event!=='requestAction')return super.emit(event,data);this.prompts.push(structuredClone(data));const step=this.steps.shift()||{action:'disconnect'};setImmediate(()=>step.action==='disconnect'?(this.connected=false,super.emit('disconnect')):super.emit('actionResponse',{...step,turnId:data.turnId,replacementId:data.replacementId}));return true;}}
async function fixture(moves,steps){const u=await users.createUserWithStarter('future_'+randomUUID(),randomUUID(),{starterId:7}),lead=mon(65,moves),player={id:'future-'+u.id,userId:u.id,username:u.username,currentmap:'ville1_shop',equipe:{pokemons:[lead]}},socket=new Socket(steps),events=[],io={sockets:{sockets:new Map([[player.id,socket]])},to:id=>({emit:(event,data)=>events.push({id,event,data:structuredClone(data)})})};await teams.editEquipe(u.id,player.equipe);return{u,player,socket,events,io,cleanup:()=>db.execute('DELETE FROM users WHERE id=?',[u.id])};}
async function fixed(work){const old=Math.random;Math.random=()=>.5;try{return await work();}finally{Math.random=old;}}
test('SQL wild: False Swipe leaves exactly 1 HP, no XP/loot for an interrupted encounter and no false KO', {skip:!enabled,timeout:12000},()=>fixed(async()=>{
 const f=await fixture(['False Swipe'],[{action:'attack',number:0},{action:'disconnect'}]);try{
  f.player.equipe.pokemons[0].currentAttack=9999;const enemy=mon(143,['Splash']);enemy.currentHp=18;
  await require('../server/game/battle/wildBattle')(f.player,enemy,f.io,f.u.id);assert.equal(enemy.currentHp,1);const result=f.events.find(e=>e.event==='battleMoveResult'&&e.data.moveName==='False Swipe');assert.equal(result.data.damage,17);const ending=f.events.find(e=>e.event==='endbattle').data;assert(ending.interrupted);assert.equal(ending.summary.money,0);assert.equal((await teams.loadEquipe(f.u.id)).pokemons[0].movePp[0],39);
 }finally{await f.cleanup();}
}));
for(const mode of ['wild','trainer','arena','pvp'])test('SQL '+mode+': Future Sight causes exactly one impact after three complete turns, then persists the battle result',{skip:!enabled,timeout:12000},()=>fixed(async()=>{
 const steps=[{action:'attack',number:0},{action:'attack',number:1},{action:'attack',number:1}],f=await fixture(['Future Sight','Splash'],steps);let opponent;
 try{
  const enemy=mon(143,['Splash']);enemy.currentHp=10;
  if(mode==='pvp'){
   opponent=await fixture(['Splash'],Array.from({length:3},()=>({action:'attack',number:0})));opponent.player.equipe={pokemons:[enemy]};await teams.editEquipe(opponent.u.id,opponent.player.equipe);f.io.sockets.sockets.set(opponent.player.id,opponent.socket);await require('../server/game/battle/pvpBattle').startPvpBattle(f.player,opponent.player,f.io);
  }else if(mode==='wild')await require('../server/game/battle/wildBattle')(f.player,enemy,f.io,f.u.id);
  else await require('../server/game/battle/trainerBattle')(f.player,{pokemons:[enemy]},f.io,f.u.id,{experienceKind:mode,arenaBattleKey:'future_fixture',recordPokedex:false,grantBaseMoney:false});
  assert.equal(f.socket.prompts.length,3);assert.equal(enemy.currentHp,0);const impacts=f.events.filter(e=>e.id===f.player.id&&e.event==='battleMoveResult'&&e.data.moveName==='Future Sight');assert.equal(impacts.length,2);assert.equal(impacts[0].data.damage,0);assert.equal(impacts[0].data.phase,'prepare');assert.equal(impacts[1].data.phase,'strike');assert.equal(impacts[1].data.damage,10);
  assert.equal(f.events.filter(e=>e.id===f.player.id&&e.event==='endbattle').length,1);assert.equal((await teams.loadEquipe(f.u.id)).pokemons[0].movePp[0],9);
  const launched=f.events.findIndex(e=>e.event==='battleMoveAnimation'&&e.data.moveName==='Future Sight'&&e.data.phase==='strike'),attacksBefore=f.events.slice(0,launched).filter(e=>e.id===f.player.id&&e.event==='battleMoveAnimation'&&!e.data.delayed);assert.equal(attacksBefore.length,6);
 }finally{await opponent?.cleanup();await f.cleanup();}
}));
test('SQL tournament: delayed attack persists through reconnect and resolves once without modifying the Adventure team',{skip:!enabled,timeout:15000},()=>fixed(async()=>{
 const f=await fixture(['Future Sight','Splash'],[]);try{
  // Above the Tower XP ceiling: this test isolates checkpoint/impact persistence.
  // XP earned below that ceiling has its own SQL regression suite.
  const lead=f.player.equipe.pokemons[0];lead.experience=require('../server/game/models/progression').getTotalExperienceForLevel(130,lead.experienceRate);lead.level=130;lead.recalculateStats();lead.currentHp=lead.maxHp;await teams.editEquipe(f.u.id,f.player.equipe);
  const {TournamentController}=require('../server/game/superTournament/controller'),codec=require('../server/game/drift/checkpointCodec'),before=codec.encode(await teams.loadEquipe(f.u.id));
  const make=()=>new TournamentController({userId:f.u.id,getPlayer:()=>f.player,emit:(event,data)=>f.events.push({event,data:structuredClone(data)}),travel:async()=>{},random:()=>.5});
  const c=make();await c.load();await c.register(f.player.equipe);await c.next();await c.atomic(()=>{c.startBattle();c.run.battle.paceMs=0;for(const enemy of c.run.battle.b.equipe.pokemons){enemy.currentHp=1;enemy.abilities=['Splash'];enemy.movePp=[40];enemy.passiveAbility=null;enemy.heldItem=null;}c.run.battle.pending.set(c.run.battle.b,{action:'attack',number:0});});
  await c.action({action:'attack',number:0,turnId:c.run.battle.token});assert(c.run.battle.state.sides.enemy.futureMove);assert.equal(c.run.battle.state.turn,2);
  const resumed=make();await resumed.load();assert.equal(resumed.run.battle.state.sides.enemy.futureMove.source,resumed.run.battle.active(0));assert.equal(resumed.run.battle.state.sides.enemy.futureMove.dueTurn,3);await resumed.tick();await resumed.action({action:'attack',number:1,turnId:resumed.run.battle.token});assert(resumed.run.battle.active(1).currentHp>0);await resumed.tick();await resumed.action({action:'attack',number:1,turnId:resumed.run.battle.token});
  assert.equal(f.events.filter(e=>e.event==='battleMoveResult'&&e.data.moveName==='Future Sight'&&e.data.phase==='strike').length,1);assert(resumed.run.score>0);assert.equal(resumed.run.cleared,0);await resumed.abandon();assert(before.equals(codec.encode(await teams.loadEquipe(f.u.id))));
 }finally{await f.cleanup();}
}));
