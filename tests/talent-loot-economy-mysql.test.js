const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
assert.equal(process.env.RUN_MYSQL_TESTS,'1');assert.equal(process.env.DB_NAME,'explorakit_test');
const db=require('../server/config/database').dbPool,users=require('../server/persistence/userRepository'),repo=require('../server/persistence/talentTreeRepository'),teams=require('../server/persistence/teamRepository'),rules=require('../server/game/talents/rules'),factory=require('../server/game/drift/pokemonFactory');
let user;const ticket=p=>({requestId:randomUUID(),...p});
test.before(async()=>{user=await users.createUserWithStarter('Plates_'+randomUUID().slice(0,8),randomUUID());await db.execute('UPDATE users SET money=100000000 WHERE id=?',[user.id]);await db.execute('INSERT INTO player_talent_trees(user_id,revision,nodes_json) VALUES(?,1,?)',[user.id,'{}']);await db.execute("INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,'talent_tree_module',1)",[user.id]);});
test.after(async()=>{if(user){repo.invalidate(user.id);await db.execute('DELETE FROM users WHERE id=?',[user.id]);}await db.end();});
const wallet=async()=>Number((await db.execute('SELECT money FROM users WHERE id=?',[user.id]))[0][0].money);
const lootDraw=()=>{let i=0;return()=>++i<=3?.999:i===4?.3:(i===5||i===6)?0:.999;};
test('thirty native purchases plus ultimate charge once, reject early/stale buys and reactivate without charging again',async()=>{
 const list=rules.catalog.nodes.filter(n=>n.source==='plates'&&!n.ultimate),before=await wallet();
 await assert.rejects(repo.buy(user.id,ticket({nodeId:'experience_plates_ultimate',revision:1})),/30 points/);assert.equal(await wallet(),before);
 const first=ticket({nodeId:list[0].id,revision:1});await Promise.all([repo.buy(user.id,first),repo.buy(user.id,first)]);assert.equal(before-await wallet(),200000);
 for(const n of list.slice(1)){const s=await repo.state(user.id);await repo.buy(user.id,ticket({nodeId:n.id,revision:s.revision}));}
 let s=await repo.state(user.id);assert.equal(s.branches.experience,30);assert.equal(s.bonuses.darkPlateChance,25);
 await repo.buy(user.id,ticket({nodeId:'experience_plates_ultimate',revision:s.revision}));s=await repo.state(user.id);assert.equal(s.bonuses.darkPlateChance,35);assert.equal(s.branches.experience,31);assert.equal(before-await wallet(),16500000);
 const money=await wallet();await assert.rejects(repo.buy(user.id,ticket({nodeId:'experience_1_1',revision:s.revision})),/31 points/);assert.equal(await wallet(),money);
 await repo.refund(user.id,ticket({nodeId:'experience_plates_ultimate',revision:s.revision}));s=await repo.state(user.id);assert(s.purchasedNodes.includes('experience_plates_ultimate'));
 await repo.buy(user.id,ticket({nodeId:'experience_plates_ultimate',revision:s.revision}));assert.equal(await wallet(),money);assert.equal((await teams.loadEquipe(user.id)).talentBonuses.darkPlateChance,35);
});
test('a real persisted Dark combat uses its owner plate bonus, pays native loot once and cannot duplicate it after reconnect',async()=>{
 const dark=require('../server/persistence/darkBattleRepository'),{DarkBattleController}=require('../server/game/battle/darkBattleController');
 const hero=factory.create(94,150,true);hero.passiveAbility=null;hero.heldItem=null;hero.abilities=[];hero.movePp=[];hero.addAbility('Shadow Ball');await teams.editEquipe(user.id,{pokemons:[hero]});
 const enemy=factory.create(7,5,true);enemy.currentHp=1;enemy.passiveAbility=null;enemy.heldItem=null;enemy.abilities=[];enemy.movePp=[];enemy.addAbility('Splash');
 const player={id:'loot-fixture',userId:user.id,username:user.username,currentmap:'jungle1',x:496,y:304,equipe:await teams.loadEquipe(user.id)};
 const events=[],c=new DarkBattleController({userId:user.id,getPlayer:()=>player,emit:(name,payload)=>events.push([name,payload]),persist:{...dark,save:(id,run,version,options)=>dark.save(id,run,version,{...options,random:lootDraw()})},random:()=>.5,now:()=>10000});
 const quantity=async()=>Number((await db.execute("SELECT quantity FROM user_items WHERE user_id=? AND item_key='dark_plate_water'",[user.id]))[0][0]?.quantity||0),before=await quantity();
 await c.start(enemy);const saved=await dark.load(user.id);assert.equal(c.run.player.equipe.pokemons[0].__trainerTalents.darkPlateChance,35);
 assert(await c.action({turnId:c.run.battle.token,action:'attack',number:0}));assert(!c.active);assert.equal(await quantity(),before+1);
 const balance=await wallet();await assert.rejects(dark.save(user.id,saved.run,saved.version),/changé/);assert.equal(await quantity(),before+1);assert.equal(await wallet(),balance);
 const resumed=new DarkBattleController({userId:user.id,getPlayer:()=>player,emit(){},persist:dark});await resumed.load();assert(!resumed.active);assert.equal((await repo.read(user.id)).bonuses.darkPlateChance,35);
});
test('native raid and Tower settlements apply the new tariffs once and leave paid receipts unchanged',async()=>{
 const raid=require('../server/persistence/raidRepository'),content=require('../server/game/raids/content'),{TournamentController}=require('../server/game/superTournament/controller');
 const team=await teams.loadEquipe(user.id),run={id:randomUUID(),phase:'active',version:0,rift:{map:'safari7',difficulty:'easy'},members:[{id:user.id,name:user.username,team}],combat:{boss:factory.create(149,100,true),models:team.pokemons.map(p=>({ownerId:user.id,pokemon:p}))}};
 try{
  run.version=await raid.save(run,{partyChanged:false});let before=await wallet();run.phase='won';run.won=true;run.version=await raid.save(run,{settle:true,random:()=>.999});
  assert.equal(run.members[0].reward.money,content.DIFFICULTIES.find(d=>d.id==='easy').reward*.8);assert.equal(await wallet()-before,80000);
  assert(!run.members[0].reward.items.some(i=>i.key.startsWith('dark_plate_')),'wild plate talents do not create raid plates');
  before=await wallet();run.version=await raid.save(run,{settle:true,random:()=>0});assert.equal(await wallet(),before,'raid receipt is not paid twice');
 }finally{await db.execute('DELETE FROM corruption_raids WHERE id=?',[run.id]);}
 const hero=factory.create(9,130,true);await teams.editEquipe(user.id,{pokemons:[hero]});
 const create=()=>new TournamentController({userId:user.id,getPlayer:()=>({id:'tower-loot',username:user.username}),emit(){},travel:async()=>{},random:()=>.99});
 const c=create();await c.load();await c.register(await teams.loadEquipe(user.id));await c.next();await c.atomic(()=>c.startBattle());const before=await wallet();
 await c.atomic(()=>{for(const p of c.run.battle.b.equipe.pokemons)p.currentHp=0;c.run.battle.prune();c.run.battle.checkEnd();c.reconcile();});
 assert.equal(await wallet()-before,10106);assert.equal(c.run.cash.last.amount,10106);
 const resumed=create();await resumed.load();assert.equal(resumed.run.cash.last.amount,10106);assert.equal(await wallet()-before,10106);await resumed.abandon();assert.equal(await wallet()-before,10106);
});
