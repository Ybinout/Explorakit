const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{randomUUID}=require('node:crypto');
const enabled=process.env.RUN_MYSQL_TESTS==='1';process.env.NODE_ENV='test';process.env.BATTLE_DELAY_SCALE='0';
let db,users,teams,factory,engine,tactics;
test.before(()=>{if(!enabled)return;if(process.env.DB_NAME!=='explorakit_test')throw Error('Dedicated test database required');db=require('../server/config/database').dbPool;users=require('../server/persistence/userRepository');teams=require('../server/persistence/teamRepository');factory=require('../server/game/drift/pokemonFactory');engine=require('../server/game/battle/battleEngine');tactics=require('../server/game/battle/trainerTactics');});
test.after(async()=>{await db?.end();});
function mon(id,name){const p=factory.create(id,50,true);Object.assign(p,{abilities:[name],movePp:[require('../server/game/battle/battleResources').getMaxMovePp(name)],passiveAbility:null,heldItem:null,maxHp:10000,currentHp:10000,type1:'Normal',type2:null,attack:100,currentAttack:100,defense:100,currentDefense:100,specialAttack:100,currentSpecialAttack:100,specialDefense:100,currentSpecialDefense:100,speed:100,currentSpeed:100});return p;}
class Socket extends EventEmitter{
 constructor(steps,onPrompt){super();this.steps=steps;this.prompts=[];this.onPrompt=onPrompt;this.failure=null;}
 emit(event,data){if(event!=='requestAction')return super.emit(event,data);this.prompts.push(structuredClone(data));setImmediate(()=>{try{this.onPrompt?.(data,this.prompts.length);const step=this.steps.shift()||{action:'disconnect'};if(step.action==='disconnect')super.emit('disconnect');else super.emit('actionResponse',{...step,turnId:data.turnId,replacementId:data.replacementId});}catch(e){this.failure=e;super.emit('disconnect');}});return true;}
}
async function setup(team,steps){const u=await users.createUserWithStarter('sequence_'+randomUUID(),'Move-sequence-test-2026',{starterId:7,sprite:'sprite.png'});const player={id:'sequence-'+u.id,userId:u.id,username:u.username,currentmap:'ville1_shop',equipe:{pokemons:team}};await teams.editEquipe(u.id,player.equipe);return {u,player,socket:new Socket(steps),cleanup:()=>db.execute('DELETE FROM users WHERE id=?',[u.id])};}
function ioFor(fixtures,events){return {sockets:{sockets:new Map(fixtures.map(f=>[f.player.id,f.socket]))},to:id=>({emit:(event,data)=>events.push({id,event,data:structuredClone(data)})})};}
for(const kind of ['wild','trainer'])for(const method of ['manual','pivot','ko'])test(`SQL ${kind} Pursuit ${method}: outgoing damage and one action, reserve untouched, stable party/PP saved`,{skip:!enabled,timeout:15000},async()=>{
 const original=Math.random;let f;try{
  const lead=mon(7,method==='pivot'?'Baton Pass':'Splash'),reserve=mon(4,'Splash'),enemy=mon(19,'Pursuit');lead.currentSpeed=999;enemy.currentSpeed=1;if(method==='ko')lead.currentHp=1;
  const hp=lead.currentHp;f=await setup([lead,reserve],method==='manual'?[{action:'change',number:1},{action:'disconnect'}]:method==='ko'?[{action:'change',number:1},{action:'change',number:1},{action:'disconnect'}]:[{action:'attack',number:0},{action:'disconnect'}]);
  const events=[],io=ioFor([f],events);Math.random=()=>.5;
  if(kind==='wild')await require('../server/game/battle/wildBattle')(f.player,enemy,io,f.u.id);else await require('../server/game/battle/trainerBattle')(f.player,{pokemons:[enemy]},io,f.u.id,{recordPokedex:false,grantBaseMoney:false});
  if(f.socket.failure)throw f.socket.failure;
  assert.equal(reserve.currentHp,10000);assert(lead.currentHp<hp);assert.equal(enemy.movePp[0],19);assert.equal(events.filter(e=>e.event==='battleMoveResult'&&e.data.moveName==='Pursuit').length,1);
  const firstReserve=events.findIndex(e=>e.event==='introAnimation'&&e.data.player.equipe.pokemons[0].uuid===reserve.uuid),hit=events.findIndex(e=>e.event==='battleMoveResult'&&e.data.moveName==='Pursuit');assert(firstReserve>hit);
  const saved=(await teams.loadEquipe(f.u.id)).pokemons;assert.deepEqual(saved.map(p=>p.uuid),[lead.uuid,reserve.uuid]);assert.equal(saved[0].currentHp,lead.currentHp);assert.equal(saved[1].currentHp,10000);assert.equal(events.filter(e=>e.event==='endbattle').length,1);
 }finally{Math.random=original;await f?.cleanup();}
});
test('SQL player Pursuit intercepts an AI switch committed before the player prompt', {skip:!enabled,timeout:15000},async()=>{
 const original=Math.random,choose=tactics.chooseAction;let f;try{
  const lead=mon(7,'Pursuit'),out=mon(19,'Splash'),next=mon(4,'Splash');f=await setup([lead],[{action:'attack',number:0},{action:'disconnect'}]);const events=[],io=ioFor([f],events);
  // Fixed pre-choice decision isolates the switch executor, without reading a player command.
  tactics.chooseAction=()=>({action:'change',number:1});Math.random=()=>.5;
  await require('../server/game/battle/trainerBattle')(f.player,{pokemons:[out,next]},io,f.u.id,{recordPokedex:false,grantBaseMoney:false});if(f.socket.failure)throw f.socket.failure;
  assert(out.currentHp<10000);assert.equal(next.currentHp,10000);assert.equal(lead.movePp[0],19);assert.equal(events.filter(e=>e.event==='battleMoveResult'&&e.data.moveName==='Pursuit').length,1);
 }finally{tactics.chooseAction=choose;Math.random=original;await f?.cleanup();}
});
for(const side of ['A','B'])for(const method of ['manual','pivot','ko'])test(`SQL PvP ${side} Pursuit ${method}: intercept once before switching and save both parties`,{skip:!enabled,timeout:15000},async()=>{
 const original=Math.random;let fa,fb;try{
  const pursuer=mon(7,'Pursuit'),out=mon(19,method==='pivot'?'Baton Pass':'Splash'),next=mon(4,'Splash');out.currentSpeed=999;pursuer.currentSpeed=1;if(method==='ko')out.currentHp=1;
  const p=await setup([pursuer],[{action:'attack',number:0},{action:'flee'}]),q=await setup([out,next],method==='manual'?[{action:'change',number:1},{action:'flee'}]:method==='ko'?[{action:'change',number:1},{action:'change',number:1},{action:'flee'}]:[{action:'attack',number:0},{action:'flee'}]);
  [fa,fb]=side==='A'?[p,q]:[q,p];const events=[],io=ioFor([fa,fb],events);Math.random=()=>.5;
  await require('../server/game/battle/pvpBattle').startPvpBattle(fa.player,fb.player,io);for(const f of [fa,fb])if(f.socket.failure)throw f.socket.failure;
  assert(out.currentHp<10000);assert.equal(next.currentHp,10000);if(method==='ko')assert.equal(out.currentHp,0);assert.equal(pursuer.movePp[0],19);
  assert.equal(events.filter(e=>e.id===p.player.id&&e.event==='battleMoveResult'&&e.data.moveName==='Pursuit').length,1);
  assert.equal((await teams.loadEquipe(q.u.id)).pokemons.find(p=>p.uuid===out.uuid).currentHp,out.currentHp);
 }finally{Math.random=original;await fa?.cleanup();await fb?.cleanup();}
});
for(const kind of ['wild','trainer'])test(`SQL ${kind} Rollout: last PP covers all five forced turns and releases the action prompt`,{skip:!enabled,timeout:15000},async()=>{
 const original=Math.random;let f;try{
  const lead=mon(7,'Rollout'),enemy=mon(19,'Splash');lead.movePp=[1];f=await setup([lead],[{action:'attack',number:0},{action:'flee'}]);const events=[],io=ioFor([f],events);Math.random=()=>.5;
  if(kind==='wild')await require('../server/game/battle/wildBattle')(f.player,enemy,io,f.u.id);else await require('../server/game/battle/trainerBattle')(f.player,{pokemons:[enemy]},io,f.u.id,{recordPokedex:false,grantBaseMoney:false});
  if(f.socket.failure)throw f.socket.failure;assert.equal(f.socket.prompts.length,2);
  const hits=events.filter(e=>e.event==='battleMoveResult'&&e.data.moveName==='Rollout').map(e=>e.data.damage);assert.equal(hits.length,5);for(let i=1;i<hits.length;i++)assert(hits[i]>hits[i-1]);
  assert.equal(lead.movePp[0],0);assert.equal(enemy.movePp[0],35);assert.equal((await teams.loadEquipe(f.u.id)).pokemons[0].movePp[0],0);
 }finally{Math.random=original;await f?.cleanup();}
});
test('SQL Aqua-Jet CS: stock, price, legitimate compatibility, one consumption, persisted move and PP',{skip:!enabled,timeout:15000},async()=>{
 let f;try{
  const p=mon(7,'Tackle');f=await setup([p],[]);const items=require('../server/persistence/itemRepository'),machines=require('../server/persistence/machineRepository');
  await db.execute('UPDATE users SET money=10000 WHERE id=?',[f.u.id]);await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,'raphael_defeated','true')",[f.u.id]);
  const bought=await items.purchaseUserItem(f.u.id,'cs_aqua_jet',1,{mapName:'tour_etage1'});assert(bought.success);assert.equal(bought.totalPrice,3000);
  await machines.useMachine(f.u.id,p.uuid,'cs_aqua_jet',{slot:1,expectedMoves:p.abilities});const saved=(await teams.loadEquipe(f.u.id)).pokemons[0];assert.deepEqual(saved.abilities,['Tackle','Aqua Jet']);assert.deepEqual(saved.movePp,[35,20]);assert.equal((await items.loadUserItems(f.u.id)).find(i=>i.key==='cs_aqua_jet')?.quantity||0,0);
 }finally{await f?.cleanup();}
});
