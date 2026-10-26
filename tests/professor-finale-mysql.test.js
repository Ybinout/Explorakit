const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const enabled=process.env.RUN_MYSQL_TESTS==='1';if(enabled&&!/test/i.test(process.env.DB_NAME||''))throw Error('Dedicated test DB required');
const {dbPool:db}=require('../server/config/database'),{createUserWithStarter}=require('../server/persistence/userRepository');
const progress=require('../server/persistence/progressionRepository'),lab=require('../server/persistence/labStoryRepository');
const scene=require('../server/game/world/lucieDeparture'),departure=require('../server/persistence/lucieDepartureRepository');
const policy=require('../server/game/world/arenaTests'),admin=require('../server/persistence/arenaTestRepository');
async function flags(id,entries){for(const[k,v]of Object.entries(entries))await db.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)',[id,k,v]);}
test('SQL finale: actual exit, clue order, unique key, victory gate, rescue and private admin replay',{skip:!enabled},async()=>{
 const ids=[],oldOwner=policy.isOwner;
 try{
  const a=await createUserWithStarter('finale_'+randomUUID(),'password-test',{starterId:7}),b=await createUserWithStarter('finale_'+randomUUID(),'password-test',{starterId:7});ids.push(a.id,b.id);
  assert.equal(await lab.noteExit(a.id),false);assert.equal(await departure.begin(a.id,scene.professor),false);
  await flags(a.id,Object.fromEntries(require('../data/game/progression.json').storySteps.slice(0,9).map(s=>[s.flag,'true'])));await flags(a.id,{lucie_departure:'seen'});
  assert(await lab.noteExit(a.id));assert(!await lab.noteExit(a.id));assert(!await lab.noteExit(b.id));
  assert.equal((await progress.completeStoryEvent(a.id,'professor_lab_rock')).reason,'requirements_not_met');
  assert((await progress.completeStoryEvent(a.id,'wanda_professor')).granted);assert((await progress.completeStoryEvent(a.id,'professor_lab_door')).granted);
  const results=await Promise.all([progress.completeStoryEvent(a.id,'professor_lab_rock'),progress.completeStoryEvent(a.id,'professor_lab_rock')]);assert.equal(results.filter(r=>r.granted).length,1);
  const [[key]]=await db.execute("SELECT quantity FROM user_items WHERE user_id=? AND item_key='professor_lab_key'",[a.id]);assert.equal(key.quantity,1);
  assert.equal((await progress.loadProgressState(b.id)).flags.professor_lab_key,undefined);
  assert.equal((await progress.completeStoryEvent(a.id,'lucie_lab_rescue')).reason,'requirements_not_met');
  const win=await progress.completeNpcBattle(a.id,'professor_story');assert(win.granted);const money=(await progress.loadProgressState(a.id)).money;
  assert(!(await progress.completeNpcBattle(a.id,'professor_story')).granted);assert.equal((await progress.loadProgressState(a.id)).money,money);
  assert(await departure.begin(a.id,scene.professor));assert(!await departure.begin(a.id,scene.professor));
  assert.equal((await progress.completeStoryEvent(a.id,'lucie_lab_rescue')).reason,'requirements_not_met');await flags(a.id,{lab_crystals_cleared:'true'});
  assert((await progress.completeStoryEvent(a.id,'lucie_lab_rescue')).granted);assert(!(await progress.completeStoryEvent(a.id,'lucie_lab_rescue')).granted);
  const final=await progress.loadProgressState(a.id),quest=final.quests.find(q=>q.key==='main_sister_search');assert.equal(final.flags.story_complete,'true');assert.equal(quest.status,'completed');assert.equal(quest.progress,13);assert(quest.completedAt);
  policy.isOwner=u=>u?.id===a.id&&u?.username===a.username;
  await admin.rearm(a);let replay=await progress.loadProgressState(a.id);assert(replay.testReplays.includes('professor_story'));assert.equal(replay.flags.admin_professor_departure,'armed');assert.equal(replay.flags.admin_lab_rescued,'false');assert(!await departure.begin(a.id,scene.professor));
  await admin.complete(a,'professor_story');assert(await departure.begin(a.id,scene.professor));await flags(a.id,{'admin_room_obstacle:lab_crystals':'true'});assert(await lab.rescueReplay(a.id));assert(!await lab.rescueReplay(b.id));
  replay=await progress.loadProgressState(a.id);assert.equal(replay.flags.admin_lab_rescued,'true');assert.equal(replay.flags.lucie_rescued,'true');assert.equal(replay.money,money);assert.equal(replay.quests.find(q=>q.key==='main_sister_search').status,'completed');
 }finally{policy.isOwner=oldOwner;for(const id of ids)await db.execute('DELETE FROM users WHERE id=?',[id]);}
});
test.after(async()=>{if(enabled)await db.end();});
