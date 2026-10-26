const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{EventEmitter}=require('node:events');
const enabled=process.env.RUN_MYSQL_TESTS==='1';if(enabled&&!/test/i.test(process.env.DB_NAME||''))throw Error('Dedicated test DB required');
process.env.NODE_ENV='test';process.env.BATTLE_DELAY_SCALE='0';
const{dbPool:db,withTransaction}=require('../server/config/database'),repo=require('../server/persistence/voidEndingRepository'),ending=require('../server/game/world/voidEnding');
const{createUserWithStarter}=require('../server/persistence/userRepository'),{loadUserItems}=require('../server/persistence/itemRepository'),progress=require('../server/persistence/progressionRepository');
const teams=require('../server/persistence/teamRepository'),factory=require('../server/game/drift/pokemonFactory');
async function flags(id,values){for(const[k,v]of Object.entries(values))await db.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value)VALUES(?,?,?)ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)',[id,k,String(v)]);}
async function fixture(){return createUserWithStarter('void_'+randomUUID(),'password-test',{starterId:7});}
test('SQL secret finale: ownership, unique discovery, concurrent five-charge cap, badge only after KO and private admin replay',{skip:!enabled},async()=>{
 const users=[],policy=require('../server/game/world/arenaTests'),owner=policy.isOwner;
 try{
  const a=await fixture(),b=await fixture();users.push(a,b);
  assert.equal(await repo.pickup(a.id),false);assert.equal(await repo.defeat(a.id),false);assert.equal(await repo.badge(a.id),false);
  await flags(a.id,Object.fromEntries(require('../data/game/progression.json').storySteps.map(s=>[s.flag,'true'])));await flags(a.id,{professor_departure:'seen',lucie_departure:'seen'});
  const claims=await Promise.all([repo.pickup(a.id),repo.pickup(a.id)]);assert.equal(claims.filter(Boolean).length,1);
  let item=(await loadUserItems(a.id)).find(i=>i.key===ending.config.item);assert.equal(item.quantity,1);assert.equal(item.usable,false);assert.match(item.description,/0\/5/);
  const beforeProgress=await progress.loadProgressState(a.id);assert(!beforeProgress.badges.some(b=>b.key===ending.config.badge));
  const repeated=await Promise.all([repo.charge(a.id,'same'),repo.charge(a.id,'same')]);assert.equal(repeated.filter(r=>r.changed).length,1);
  assert.equal((await repo.read(a.id)).state.charge,1);assert.equal((await repo.charge(b.id,'fake')).changed,false);
  assert.equal(await repo.badge(a.id),false);assert.equal(await repo.defeat(a.id),false);
  await Promise.all(Array.from({length:15},(_,i)=>repo.charge(a.id,'action-'+i)));assert.equal((await repo.read(a.id)).state.charge,5);
  const[[count]]=await db.execute("SELECT COUNT(*) n FROM player_story_flags WHERE user_id=? AND flag_key LIKE 'void_use_%'",[a.id]);assert.equal(count.n,5);
  item=(await loadUserItems(a.id)).find(i=>i.key===ending.config.item);assert.equal(item.name,'Téléporteur chargé');assert.equal(item.usable,true);assert.match(item.description,/5\/5/);
  assert.equal(await repo.badge(a.id),false);assert(await repo.defeat(a.id));
  const rewards=await Promise.all([repo.badge(a.id),repo.badge(a.id)]);assert.equal(rewards.filter(Boolean).length,1);
  const normal=await progress.loadProgressState(a.id);assert(normal.badges.find(b=>b.key===ending.config.badge).earned);assert.equal(normal.flags.true_ending,'true');assert.equal(normal.capture.badgeCount,beforeProgress.capture.badgeCount);
  assert(!(await progress.loadProgressState(b.id)).badges.some(b=>b.key===ending.config.badge));
  const money=normal.money,quantity=item.quantity;policy.isOwner=u=>u?.id===a.id&&u?.username===a.username;
  await require('../server/persistence/arenaTestRepository').rearm(a);let replay=await repo.read(a.id);assert(replay.state.replay);assert(!replay.state.found);assert.equal(replay.state.charge,0);assert.equal(replay.state.available,false);assert(!(await loadUserItems(a.id)).some(i=>i.key===ending.config.item));
  await flags(a.id,{admin_professor_departure:'seen',admin_lab_rescued:'true'});assert(await repo.pickup(a.id));
  for(let i=0;i<5;i++)await repo.charge(a.id,'replay-'+i);assert(await repo.defeat(a.id));assert(await repo.badge(a.id));
  const after=await progress.loadProgressState(a.id);assert.equal(after.money,money);assert.equal((await loadUserItems(a.id)).find(i=>i.key===ending.config.item).quantity,quantity);
  const[[badges]]=await db.execute('SELECT COUNT(*) n FROM player_badges WHERE user_id=? AND badge_key=?',[a.id,ending.config.badge]);assert.equal(badges.n,1);
  for(const k of ['void_found','void_charge','void_defeated','void_claimed','true_ending'])assert.equal(after.flags[k],normal.flags[k]);
 }finally{policy.isOwner=owner;for(const u of users)await db.execute('DELETE FROM users WHERE id=?',[u.id]);}
});
class Socket extends EventEmitter{constructor(actions){super();this.actions=actions;this.connected=true;}emit(event,data){if(event==='requestAction'){const a=this.actions.shift()||{action:'flee'};setImmediate(()=>super.emit('actionResponse',{...a,...(data.turnId?{turnId:data.turnId}:{})}));return true;}return super.emit(event,data);}}
test('SQL real battles: own electric PP uses charge five times, then a single damaging move defeats the human without XP/EV/money',{skip:!enabled},async()=>{
 let user;const oldRandom=Math.random;
 try{
  user=await fixture();await flags(user.id,{lucie_rescued:'true'});await repo.pickup(user.id);
  const mon=factory.create(25,50,true);mon.abilities=['Thunder Shock','Thunder Wave','Growl'];mon.movePp=[30,20,40];mon.currentSpeed=999;
  // The canonical spelling in the catalogue is Thunder Shock.
  assert(require('../server/game/battle/battleEngine').getMoveByName(mon.abilities[0]));
  await teams.editEquipe(user.id,{pokemons:[mon]});const player={id:'owner',userId:user.id,currentmap:'route1',equipe:{pokemons:[mon]}};
  const foe=factory.create(19,5,true);foe.abilities=['Splash'];foe.movePp=[40];foe.currentHp=foe.maxHp=9999;
  let socket=new Socket([{action:'attack',number:2},...Array.from({length:5},()=>({action:'attack',number:1})),{action:'flee'}]);const events=[],io={sockets:{sockets:new Map([['owner',socket]])},to:id=>({emit:(event,data)=>events.push({id,event,data})})};
  Math.random=()=>.5;await require('../server/game/battle/wildBattle')(player,foe,io,user.id);
  assert.equal((await repo.read(user.id)).state.charge,5);assert.deepEqual([...new Set(events.filter(e=>e.event==='bagUpdated').map(e=>e.data.items.find(i=>i.key===ending.config.item)?.charge).filter(n=>n>0))],[1,2,3,4,5]);
  const before={xp:mon.experience,ev:JSON.stringify(mon.ev),pp:mon.movePp[0],money:(await progress.loadProgressState(user.id)).money};
  socket=new Socket([{action:'attack',number:0}]);io.sockets.sockets.set('owner',socket);events.length=0;
  const won=await require('../server/game/battle/professorFinale').start(player,io,user.id,{onVictory:()=>repo.defeat(user.id)});
  assert(won);assert.equal(mon.movePp[0],before.pp-1);assert.equal(mon.experience,before.xp);assert.equal(JSON.stringify(mon.ev),before.ev);assert.equal((await progress.loadProgressState(user.id)).money,before.money);
  assert.equal(events.filter(e=>e.event==='battleMoveResult'&&e.data.damage===100).length,1);assert(events.filter(e=>e.event==='introAnimation').at(-1).data.wildPokemon.currentHp===0);
  assert.equal((await repo.read(user.id)).state.defeated,true);assert(!(await progress.loadProgressState(user.id)).badges.some(b=>b.key===ending.config.badge));
 }finally{Math.random=oldRandom;if(user)await db.execute('DELETE FROM users WHERE id=?',[user.id]);}
});
for(const kind of ['trainer','pvp'])test(`SQL ${kind}: only the owner of an actual Electric move receives its charge`,{skip:!enabled},async()=>{
 const users=[],oldRandom=Math.random;
 try{
  for(let i=0;i<2;i++){const u=await fixture();users.push(u);await flags(u.id,{lucie_rescued:'true'});assert(await repo.pickup(u.id));}
  const a=factory.create(25,50,true),b=factory.create(7,50,true);
  for(const p of [a,b]){p.currentHp=p.maxHp=1000;p.passiveAbility=null;p.heldItem=null;}
  a.currentSpeed=999;b.currentSpeed=1;
  a.abilities=[kind==='trainer'?'Thunder Wave':'Growl'];a.movePp=[20];b.abilities=[kind==='pvp'?'Thunder Wave':'Splash'];b.movePp=[20];
  const players=users.map((u,i)=>({id:'charge-'+i,userId:u.id,currentmap:'route1',equipe:{pokemons:[i?b:a]}}));
  for(let i=0;i<2;i++)await teams.editEquipe(users[i].id,players[i].equipe);
  const sockets=new Map(players.map(p=>[p.id,new Socket([{action:'attack',number:0},{action:'flee'}])])),events=[];
  const io={sockets:{sockets},to:id=>({emit:(event,data)=>events.push({id,event,data})})};
  Math.random=()=>.5;
  if(kind==='trainer')await require('../server/game/battle/trainerBattle')(players[0],players[1].equipe,io,users[0].id);
  else await require('../server/game/battle/pvpBattle').startPvpBattle(players[0],players[1],io);
  assert.deepEqual(await Promise.all(users.map(async u=>(await repo.read(u.id)).state.charge)),kind==='trainer'?[1,0]:[0,1]);
  const owner=players[kind==='trainer'?0:1];assert(events.some(e=>e.id===owner.id&&e.event==='bagUpdated'&&e.data.items.some(i=>i.key===ending.config.item&&i.charge===1)));
 }finally{Math.random=oldRandom;for(const u of users)await db.execute('DELETE FROM users WHERE id=?',[u.id]);}
});
test.after(async()=>{if(enabled)await db.end();});
