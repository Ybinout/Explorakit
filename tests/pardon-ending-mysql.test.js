const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{EventEmitter}=require('node:events');
const enabled=process.env.RUN_MYSQL_TESTS==='1';let db,users,repo,progress,teams,factory;
test.before(()=>{if(!enabled)return;if(!/test/i.test(process.env.DB_NAME||''))throw Error('Dedicated test database required');db=require('../server/config/database').dbPool;users=require('../server/persistence/userRepository');repo=require('../server/persistence/voidEndingRepository');progress=require('../server/persistence/progressionRepository');teams=require('../server/persistence/teamRepository');factory=require('../server/game/drift/pokemonFactory');});test.after(async()=>{await db?.end();});
async function flags(id,values){for(const[k,v]of Object.entries(values))await db.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value)VALUES(?,?,?)ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)',[id,k,String(v)]);}
async function fixture(){const u=await users.createUserWithStarter('pardon_'+randomUUID(),'Pardon-test-password-2026',{starterId:1,sprite:'sprite.png'});try{await flags(u.id,{lucie_rescued:'true'});assert(await repo.pickup(u.id));for(let i=0;i<5;i++)await repo.charge(u.id,'charge-'+i);return u;}catch(e){await db.execute('DELETE FROM users WHERE id=?',[u.id]);throw e;}}
async function earned(id){const [rows]=await db.execute("SELECT badge_key FROM player_badges WHERE user_id=? AND badge_key IN('pardon_badge','violence_badge')",[id]);return rows.map(r=>r.badge_key).sort();}
test('SQL Pardon: immediate single badge, Violence cracked, duplicate packets and opposite outcome refused',{skip:!enabled},async()=>{
 let u;try{u=await fixture();const before=await progress.loadProgressState(u.id);assert(before.badges.some(b=>b.key==='pardon_badge'&&!b.earned&&!b.cracked));
  assert(await repo.resolveOutcome(u.id,'pardon'));assert(await repo.resolveOutcome(u.id,'pardon'));assert.equal(await repo.defeat(u.id),false);assert.equal(await repo.badge(u.id),false);assert.equal(await repo.resolveOutcome(u.id,'forged'),false);
  const after=await progress.loadProgressState(u.id);assert.deepEqual(await earned(u.id),['pardon_badge']);assert(after.badges.find(b=>b.key==='pardon_badge').earned);assert(after.badges.find(b=>b.key==='violence_badge').cracked);assert(!after.badges.find(b=>b.key==='pardon_badge').cracked);assert.equal(after.flags.true_ending,'true');assert.deepEqual(after.capture,before.capture);
  assert.equal((await repo.read(u.id)).state.resolution,'pardon');const results=await Promise.all([repo.acknowledgePardon(u.id),repo.acknowledgePardon(u.id)]);assert.equal(results.filter(Boolean).length,1);assert.equal((await repo.read(u.id)).state.pardonSeen,true);
 }finally{if(u)await db.execute('DELETE FROM users WHERE id=?',[u.id]);}
});
test('SQL Violence: choice locks at KO, corpse interaction awards it once and Pardon becomes cracked',{skip:!enabled},async()=>{
 let u;try{u=await fixture();assert(await repo.defeat(u.id));assert.deepEqual(await earned(u.id),[]);assert.equal(await repo.resolveOutcome(u.id,'pardon'),false);
  let p=await progress.loadProgressState(u.id);assert(p.badges.find(b=>b.key==='pardon_badge').cracked);assert(!p.badges.find(b=>b.key==='violence_badge').earned);
  const results=await Promise.all([repo.badge(u.id),repo.badge(u.id)]);assert.equal(results.filter(Boolean).length,1);assert.deepEqual(await earned(u.id),['violence_badge']);p=await progress.loadProgressState(u.id);assert.equal(p.flags.void_resolution,'violence');assert.equal(await repo.acknowledgePardon(u.id),false);
 }finally{if(u)await db.execute('DELETE FROM users WHERE id=?',[u.id]);}
});
test('SQL concurrent different endings commit exactly one choice and exactly one badge',{skip:!enabled},async()=>{
 let u;try{u=await fixture();const results=await Promise.all([repo.resolveOutcome(u.id,'pardon'),repo.defeat(u.id)]);assert.equal(results.filter(Boolean).length,1);
  const s=(await repo.read(u.id)).state;if(s.resolution==='violence')assert(await repo.badge(u.id));assert.equal((await earned(u.id)).length,1);
  assert.equal(await repo.resolveOutcome(u.id,s.resolution==='pardon'?'violence':'pardon'),false);assert.equal((await earned(u.id)).length,1);
 }finally{if(u)await db.execute('DELETE FROM users WHERE id=?',[u.id]);}
});
test('SQL legacy Violence saves remain valid and retain the original badge timestamp',{skip:!enabled},async()=>{
 let u;try{u=await fixture();await flags(u.id,{void_defeated:'true',void_claimed:'true',true_ending:'true'});await db.execute("INSERT INTO player_badges(user_id,badge_key,awarded_at)VALUES(?,'violence_badge','2026-10-26 10:00:00')",[u.id]);
  const before=await progress.loadProgressState(u.id);assert.equal((await repo.read(u.id)).state.resolution,'violence');assert.equal(await repo.resolveOutcome(u.id,'pardon'),false);const after=await progress.loadProgressState(u.id);
  assert.deepEqual(after.badges,before.badges);assert(after.badges.find(b=>b.key==='pardon_badge').cracked);assert.equal(after.flags.void_resolution,undefined);
 }finally{if(u)await db.execute('DELETE FROM users WHERE id=?',[u.id]);}
});
for(const originalChoice of ['violence','pardon'])test(`SQL admin reset displays the replay ending over saved ${originalChoice}, with matching secret gates and untouched original reward`,{skip:!enabled},async()=>{
 let u;const policy=require('../server/game/world/arenaTests'),original=policy.isOwner;
 try{u=await fixture();assert(await repo.resolveOutcome(u.id,originalChoice));if(originalChoice==='violence')assert(await repo.badge(u.id));
  const mirror=require('../server/persistence/mirrorRiftRepository');
  for(const key of require('../server/game/world/mirrorRift').requiredBadges)await db.execute('INSERT IGNORE INTO player_badges(user_id,badge_key)VALUES(?,?)',[u.id,key]);
  const before=await progress.loadProgressState(u.id);const [storedBefore]=await db.execute('SELECT badge_key,awarded_at FROM player_badges WHERE user_id=? ORDER BY badge_key',[u.id]);policy.isOwner=user=>user?.id===u.id;
  await require('../server/config/database').withTransaction(c=>repo.resetReplay(c,u.id));
  const resetProgress=await progress.loadProgressState(u.id);assert(resetProgress.badges.filter(b=>b.exclusiveGroup==='professor_finale').every(b=>!b.earned&&!b.cracked));assert.equal((await mirror.read(u.id)).state.unlocked,false);
  await flags(u.id,{admin_professor_departure:'seen',admin_lab_rescued:'true'});assert(await repo.pickup(u.id));for(let i=0;i<5;i++)await repo.charge(u.id,'replay-'+i);
  const choice=originalChoice==='violence'?'pardon':'violence';assert(await repo.resolveOutcome(u.id,choice));assert.equal((await repo.read(u.id)).state.resolution,choice);
  if(choice==='pardon')assert(await repo.acknowledgePardon(u.id));else {assert.equal((await mirror.read(u.id)).state.unlocked,false);assert(await repo.badge(u.id));}
  for(let reconnect=0;reconnect<2;reconnect++){
   const after=await progress.loadProgressState(u.id);assert.equal(after.flags.void_resolution,originalChoice);assert.equal(after.flags.admin_void_resolution,choice);
   assert(after.badges.find(b=>b.key===choice+'_badge').earned);assert(!after.badges.find(b=>b.key===choice+'_badge').cracked);
   assert(!after.badges.find(b=>b.key===originalChoice+'_badge').earned);assert(after.badges.find(b=>b.key===originalChoice+'_badge').cracked);
   assert.deepEqual(after.badges.filter(b=>b.exclusiveGroup!=='professor_finale'),before.badges.filter(b=>b.exclusiveGroup!=='professor_finale'));assert.equal((await mirror.read(u.id)).state.unlocked,true);
  }
  await require('../server/config/database').withTransaction(c=>repo.resetReplay(c,u.id));const reset=(await repo.read(u.id)).state;assert.equal(reset.resolution,null);assert.equal(reset.pardonSeen,false);assert.equal(reset.found,false);assert.equal((await mirror.read(u.id)).state.unlocked,false);
  assert.deepEqual(await earned(u.id),[originalChoice+'_badge']);const [storedAfter]=await db.execute('SELECT badge_key,awarded_at FROM player_badges WHERE user_id=? ORDER BY badge_key',[u.id]);assert.deepEqual(storedAfter,storedBefore);
 }finally{policy.isOwner=original;if(u)await db.execute('DELETE FROM users WHERE id=?',[u.id]);}
});
class Socket extends EventEmitter{constructor(actions){super();this.actions=actions;this.connected=true;}emit(event,data){if(event==='requestAction'){const action=this.actions.shift()||{action:'flee'};setImmediate(()=>super.emit('actionResponse',{...action,turnId:data.turnId}));return true;}return super.emit(event,data);}}
for(const scenario of ['forged-move','choice-switch'])test(`SQL human confrontation ${scenario}: actual known move and item constraints decide the outcome`,{skip:!enabled},async()=>{
 let u;try{u=await fixture();const lead=factory.create(94,40,true),reserve=factory.create(1,30,true);lead.passiveAbility=reserve.passiveAbility=null;lead.abilities=['Growl','Purify'];lead.movePp=[40,20];reserve.abilities=['Purify'];reserve.movePp=[20];
  if(scenario==='choice-switch')lead.heldItem='choice_band';const player={id:'owner',userId:u.id,currentmap:'void_arena',equipe:{pokemons:[lead,reserve]}};await teams.editEquipe(u.id,player.equipe);
  const actions=scenario==='forged-move'?[{action:'attack',number:0,moveName:'Purify'},{action:'flee'}]:[{action:'attack',number:0},{action:'attack',number:1},{action:'change',number:1},{action:'attack',number:0}];
  const socket=new Socket(actions),events=[],io={sockets:{sockets:new Map([['owner',socket]])},to:()=>({emit:(event,data)=>events.push({event,data:JSON.parse(JSON.stringify(data))})})};
  const won=await require('../server/game/battle/professorFinale').start(player,io,u.id,{onResolve:choice=>repo.resolveOutcome(u.id,choice)});
  assert.equal(won,scenario==='choice-switch');assert.equal(lead.movePp[0],39);assert.equal(lead.movePp[1],20);assert.equal(player.equipe.pokemons[0].uuid,lead.uuid);
  if(scenario==='forged-move'){assert.deepEqual(await earned(u.id),[]);assert.equal((await repo.read(u.id)).state.resolution,null);}else{assert.equal(reserve.movePp[0],19);assert.equal(lead.heldItem,'choice_band');assert(!lead.__battle);assert.deepEqual(await earned(u.id),['pardon_badge']);}
 }finally{if(u)await db.execute('DELETE FROM users WHERE id=?',[u.id]);}
});
test('SQL buy/teach/use Purification: heals the corrupted human, leaves him alive and awards Pardon without ordinary rewards',{skip:!enabled},async()=>{
 let u;try{u=await fixture();const p=factory.create(94,40,true);p.passiveAbility=null;p.abilities=['Tackle'];p.movePp=[35];p.currentHp=Math.max(1,p.maxHp-40);await teams.editEquipe(u.id,{pokemons:[p]});
  // Use the real shop transaction, then the real one-use CS transaction.
  await flags(u.id,{hoze_defeated:'true'});await users.awardUserMoney(u.id,4000);const purchase=await require('../server/persistence/itemRepository').purchaseUserItem(u.id,'cs_purify',1,{mapName:'tour_etage1'});assert(purchase.success,JSON.stringify(purchase));
  Object.assign(p,await require('../server/persistence/machineRepository').useMachine(u.id,p.uuid,'cs_purify',{slot:1,expectedMoves:['Tackle']}));assert.equal(p.abilities[1],'Purify');
  const [[stock]]=await db.execute("SELECT quantity FROM user_items WHERE user_id=? AND item_key='cs_purify'",[u.id]);assert(!stock||stock.quantity===0);
  const before={hp:p.currentHp,xp:p.experience,ev:JSON.stringify(p.ev),money:(await progress.loadProgressState(u.id)).money};
  const player={id:'owner',userId:u.id,currentmap:'void_arena',equipe:{pokemons:[p]}},socket=new Socket([{action:'attack',number:1}]),events=[];
  const io={sockets:{sockets:new Map([['owner',socket]])},to:()=>({emit:(event,data)=>events.push({event,data:JSON.parse(JSON.stringify(data))})})};
  const won=await require('../server/game/battle/professorFinale').start(player,io,u.id,{onResolve:choice=>repo.resolveOutcome(u.id,choice)});assert(won);
  const states=events.filter(e=>e.event==='introAnimation');assert.equal(states[0].data.wildPokemon.status,'corrupted');assert.equal(states.at(-1).data.wildPokemon.status,'normal');assert.equal(states.at(-1).data.wildPokemon.currentHp,100);
  assert.equal(p.movePp[1],19);assert(p.currentHp>before.hp);assert.equal(p.experience,before.xp);assert.equal(JSON.stringify(p.ev),before.ev);assert.equal((await progress.loadProgressState(u.id)).money,before.money);
  const result=events.find(e=>e.event==='endbattle').data;assert.equal(result.reason,'pardoned');assert.deepEqual(result.summary.loot,[]);assert.deepEqual(result.summary.experience,[]);assert(!events.some(e=>e.event==='battleMoveResult'&&e.data.damage>0));assert.deepEqual(await earned(u.id),['pardon_badge']);
  assert.equal((await teams.loadEquipe(u.id)).pokemons[0].movePp[1],19);assert.equal((await repo.read(u.id)).state.pardonSeen,false);
 }finally{if(u)await db.execute('DELETE FROM users WHERE id=?',[u.id]);}
});
