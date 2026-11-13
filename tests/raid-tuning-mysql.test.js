const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
assert.equal(process.env.DB_NAME,'explorakit_test');assert.equal(process.env.RUN_MYSQL_TESTS,'1');
const db=require('../server/config/database').dbPool,users=require('../server/persistence/userRepository'),teams=require('../server/persistence/teamRepository');
const repo=require('../server/persistence/raidRepository'),items=require('../server/persistence/itemRepository'),dark=require('../server/persistence/darkContinentRepository');
const {RaidBattle}=require('../server/game/raids/RaidBattle'),{make}=require('../scripts/calibrateCorruptionRaids'),codec=require('../server/game/drift/checkpointCodec');
let user;const runs=[];
test.before(async()=>{user=await users.createUserWithStarter('RaidTune_'+randomUUID().slice(0,8),randomUUID());await db.execute('UPDATE users SET money=10000000 WHERE id=?',[user.id]);});
test.after(async()=>{for(const id of runs)await db.execute('DELETE FROM corruption_raids WHERE id=?',[id]);if(user)await db.execute('DELETE FROM users WHERE id=?',[user.id]);await db.end();});
const wallet=async()=>Number((await db.execute('SELECT money FROM users WHERE id=?',[user.id]))[0][0].money);
async function run(level=300){
  const mons=[9,135,143,195].map((id,i)=>{const p=make(id,100,4,['Splash'],'Keen Eye');p.heldItem=null;p.status=['burn','poison','sleep','paralyze'][i];if(i===2)p.__battle={sleepTurns:3};return p;});
  await teams.editEquipe(user.id,{pokemons:mons});const team=await teams.loadEquipe(user.id);
  const b=new RaidBattle(team.pokemons.map(pokemon=>({ownerId:user.id,ownerName:user.username,pokemon})),make(143,level,4,['Splash'],'Keen Eye'),{seed:[1,2,3,4],now:()=>1000});b.applyModels();
  const r={id:randomUUID(),phase:'active',version:0,rift:{map:'safari7',difficulty:level>=300?'extreme':'veryhard'},hostId:user.id,members:[{id:user.id,name:user.username,team,selected:mons.map(p=>p.uuid)}],combat:b.snapshot()};runs.push(r.id);r.version=await repo.save(r);return{r,b};
}
test('real SQL snapshots preserve entry statuses and sleep timers before the first action, across server reload',async()=>{
  const {r}=await run();const row=(await repo.loadActive()).find(x=>x.id===r.id);assert(row);const b=RaidBattle.restore(row.combat,()=>1000);
  assert.deepEqual(b.view(user.id).allies.map(p=>p.status),['burn','poison','sleep','paralyze']);assert.equal(b.sim.p1.active[2].statusState.time,3);
  assert.deepEqual((await teams.loadEquipe(user.id)).pokemons.map(p=>p.status),['burn','poison','sleep','paralyze']);
  r.phase='lost';r.version=await repo.save(r,{settle:true});
});
for(const level of [200,299,300,301,1000])test('raid level '+level+' pays correct final cash once, with receipt replay protection',async()=>{
  const {r,b}=await run(level),before=await wallet();b.sim.win('p1');r.combat=b.snapshot();r.phase='won';r.won=true;r.version=await repo.save(r,{settle:true,random:()=>.999});
  const expected=level>=300?640000:320000;assert.equal(r.members[0].reward.money,expected);assert.equal(await wallet()-before,expected);
  const receipt=r.members[0].reward;r.version=await repo.save(r,{settle:true,random:()=>0});assert.equal(await wallet()-before,expected);assert.deepEqual(r.members[0].reward,receipt);
});
test('an injected settlement failure rolls back cash, inventory, Pokémon XP and the reward receipt together',async()=>{
  const {r,b}=await run(),before=await wallet(),party=await teams.loadEquipe(user.id);b.sim.win('p1');r.phase='won';r.won=true;r.combat=b.snapshot();const saved=codec.decode(codec.encode(r));
  const acquire=db.getConnection.bind(db);db.getConnection=async()=>{const c=await acquire(),execute=c.execute.bind(c),release=c.release.bind(c);c.execute=async(sql,...args)=>{if(sql.startsWith('INSERT INTO corruption_raid_rewards'))throw Error('settlement_test_failure');return execute(sql,...args);};c.release=()=>{c.execute=execute;c.release=release;release();};return c;};
  try{await assert.rejects(repo.save(r,{settle:true,random:()=>.999}),/settlement_test_failure/);}finally{db.getConnection=acquire;}
  assert.equal(await wallet(),before);assert.deepEqual(await teams.loadEquipe(user.id),party);assert.equal((await db.execute('SELECT * FROM corruption_raid_rewards WHERE raid_id=?',[r.id]))[0].length,0);
  saved.version=await repo.save(saved,{settle:true,random:()=>.999});assert.equal(await wallet()-before,640000);
});
test('kit bought for25,000 exposes its corruption eligibility and equips a corrupted owner atomically',async()=>{
  const p=make(9,100,4,['Splash'],'Keen Eye');p.corruption={version:1,revision:1,permanent:true,modules:{}};p.heldItem=null;await teams.editEquipe(user.id,{pokemons:[p]});
  await db.execute("DELETE FROM user_items WHERE user_id=? AND item_key='survival_kit'",[user.id]);const before=await wallet(),requestId=randomUUID();
  const purchase=await dark.buySurvivalKit(user.id,{requestId,quantity:1});assert.equal(before-await wallet(),25000);assert.equal(purchase.charged,25000);
  const bag=await items.loadUserItems(user.id);assert.equal(bag.find(i=>i.key==='survival_kit').darkSurvival,true);
  const team=await teams.getTeamRecord(user.id);await items.equipHeldItem(user.id,Number(team.id),p.uuid,'survival_kit');assert.equal((await teams.loadEquipe(user.id)).pokemons[0].heldItem,'survival_kit');
  assert(!(await items.loadUserItems(user.id)).some(i=>i.key==='survival_kit'));await dark.buySurvivalKit(user.id,{requestId,quantity:1});assert.equal(before-await wallet(),25000);assert(!(await items.loadUserItems(user.id)).some(i=>i.key==='survival_kit'));
});
