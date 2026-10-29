const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events'),{randomUUID}=require('node:crypto');
const enabled=process.env.RUN_MYSQL_TESTS==='1';
process.env.NODE_ENV='test';process.env.BATTLE_DELAY_SCALE='0';
let db,users,teams,factory;
test.before(()=>{
 if(!enabled)return;if(!/test/i.test(process.env.DB_NAME||''))throw Error('Dedicated test database required');
 db=require('../server/config/database').dbPool;users=require('../server/persistence/userRepository');teams=require('../server/persistence/teamRepository');factory=require('../server/game/drift/pokemonFactory');
});
test.after(async()=>{await db?.end();});
function mon(id,move){const p=factory.create(id,30,true);p.passiveAbility=null;p.heldItem=null;p.abilities=[move];p.movePp=[require('../server/game/battle/battleResources').getMaxMovePp(move)];return p;}
class Socket extends EventEmitter{
 constructor(steps){super();this.steps=steps;this.prompts=[];}
 emit(event,data){
  if(event!=='requestAction')return super.emit(event,data);
  this.prompts.push(structuredClone(data));const step=this.steps.shift()||{action:'disconnect'};
  setImmediate(()=>step.action==='disconnect'?super.emit('disconnect'):super.emit('actionResponse',{...step,replacementId:data.replacementId,turnId:data.turnId}));return true;
 }
}
async function fixture(steps){
 const u=await users.createUserWithStarter('pivot_'+randomUUID(),'Teleport-pivot-test-2026',{starterId:7,sprite:'sprite.png'});
 const player={id:'owner-'+u.id,userId:u.id,currentmap:'ville1_shop',equipe:{pokemons:[mon(63,'Teleport'),mon(7,'Splash'),mon(4,'Splash')]}};
 await teams.editEquipe(u.id,player.equipe);const socket=new Socket(steps),events=[];
 const io={sockets:{sockets:new Map([[player.id,socket]])},to:id=>({emit:(event,data)=>events.push({id,event,data:structuredClone(data)})})};
 return {u,player,socket,events,io,cleanup:()=>db.execute('DELETE FROM users WHERE id=?',[u.id])};
}
for(const kind of ['trainer','arena'])test(`SQL ${kind}: Teleport lets the owner select reserve 2, costs one action/PP and persists the intact party`,{skip:!enabled},async()=>{
 const f=await fixture([{action:'attack',number:0},{action:'change',number:2}]);
 try{
  const [out,unused,chosen]=f.player.equipe.pokemons,enemy=mon(19,'Splash');out.__battle={statStages:{speed:2}};
  await require('../server/game/battle/trainerBattle')(f.player,{pokemons:[enemy]},f.io,f.u.id,{experienceKind:kind,...(kind==='arena'?{arenaBattleKey:'teleport_test'}:{}),recordPokedex:false});
  const prompt=f.socket.prompts.find(p=>p.replacement);assert(prompt);assert.deepEqual(prompt.allowedPokemonIndexes,[1,2]);
  assert.equal(enemy.movePp[0],39);assert.equal(out.movePp[0],19);assert.equal(chosen.movePp[0],40);
  assert(f.events.some(e=>e.event==='introAnimation'&&e.data.player.equipe.pokemons[0].uuid===chosen.uuid));
  const saved=(await teams.loadEquipe(f.u.id)).pokemons;assert.deepEqual(saved.map(p=>p.uuid),[out,unused,chosen].map(p=>p.uuid));
  assert.equal(saved[0].movePp[0],19);assert.equal(saved.length,3);assert(!saved[0].__battle?.statStages?.speed);
 }finally{await f.cleanup();}
});
test('SQL: disconnect while choosing a Teleport reserve ends the battle and persists spent PP without an automatic switch',{skip:!enabled},async()=>{
 const f=await fixture([{action:'attack',number:0},{action:'disconnect'}]);
 try{
  const outgoing=f.player.equipe.pokemons[0];
  await require('../server/game/battle/trainerBattle')(f.player,{pokemons:[mon(19,'Splash')]},f.io,f.u.id,{recordPokedex:false});
  assert(f.socket.prompts.some(p=>p.replacement));assert.equal(f.player.equipe.pokemons[0].uuid,outgoing.uuid);
  assert.equal((await teams.loadEquipe(f.u.id)).pokemons[0].movePp[0],19);
  assert.equal(f.events.filter(e=>e.event==='endbattle').length,1);assert.equal(f.socket.listenerCount('actionResponse'),0);
 }finally{await f.cleanup();}
});
test('SQL PvP: Teleport replacement choice is honored and both parties persist after the following disconnect',{skip:!enabled},async()=>{
 const a=await fixture([{action:'attack',number:0},{action:'change',number:2}]),b=await fixture([{action:'attack',number:0}]);
 try{
  b.player.equipe.pokemons[0]=mon(19,'Splash');await teams.editEquipe(b.u.id,b.player.equipe);
  a.io.sockets.sockets.set(b.player.id,b.socket);const out=a.player.equipe.pokemons[0],chosen=a.player.equipe.pokemons[2];
  const result=await require('../server/game/battle/pvpBattle').startPvpBattle(a.player,b.player,a.io);
  assert(a.socket.prompts.some(p=>p.replacement));assert.equal(result.reason,'fled');
  assert.equal(out.movePp[0],19);assert.equal(chosen.movePp[0],40);assert.equal(b.player.equipe.pokemons[0].movePp[0],39);
  assert.equal((await teams.loadEquipe(a.u.id)).pokemons[0].movePp[0],19);assert.equal((await teams.loadEquipe(b.u.id)).pokemons[0].movePp[0],39);
 }finally{await a.cleanup();await b.cleanup();}
});
