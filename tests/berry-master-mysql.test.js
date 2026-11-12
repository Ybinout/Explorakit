const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
test('daily recipe: atomic parallel visits, native notebook, zero trials, Paris midnight, exhaustion and independent accounts',{skip:process.env.RUN_MYSQL_TESTS!=='1'},async()=>{
 assert.equal(process.env.DB_NAME,'explorakit_test');
 const {dbPool:db}=require('../server/config/database'),users=require('../server/persistence/userRepository');
 const repo=require('../server/persistence/berryMasterRepository'),master=require('../server/game/berries/master');
 const housing=require('../server/persistence/housingRepository'),garden=require('../server/persistence/berryGardenRepository');
 const ids=[],user=async()=>{const u=await users.createUserWithStarter('BerryMaster_'+randomUUID().slice(0,8),randomUUID());ids.push(u.id);return u.id;};
 try{
  const id=await user(),other=await user(),now=Date.UTC(2026,10,12,22,59);
  const [beforeItems]=await db.execute('SELECT * FROM user_items WHERE user_id=?',[id]);
  const [beforeParty]=await db.execute('SELECT p.* FROM pokemons p JOIN teams t ON p.team_id=t.id WHERE t.user_id=?',[id]);
  const [[beforeUser]]=await db.execute('SELECT money FROM users WHERE id=?',[id]);
  const results=await Promise.all(Array.from({length:8},()=>repo.visit(id,now,()=>0)));
  assert.equal(results.filter(r=>r.status==='learned').length,1);assert.equal(results.filter(r=>r.status==='already').length,7);
  assert.equal(new Set(results.map(r=>r.recipe.key)).size,1);
  let [rows]=await db.execute('SELECT * FROM berry_recipe_discoveries WHERE user_id=?',[id]);assert.equal(rows.length,1);assert.equal(rows[0].attempts,0);
  assert.deepEqual((await db.execute('SELECT * FROM user_items WHERE user_id=?',[id]))[0],beforeItems);
  assert.deepEqual((await db.execute('SELECT p.* FROM pokemons p JOIN teams t ON p.team_id=t.id WHERE t.user_id=?',[id]))[0],beforeParty);
  assert.deepEqual((await db.execute('SELECT money FROM users WHERE id=?',[id]))[0][0],beforeUser);
  await assert.rejects(repo.visit(other,now,()=>{throw Error('Interrupted selection');}),/Interrupted selection/);
  assert.equal((await db.execute('SELECT COUNT(*) n FROM berry_recipe_discoveries WHERE user_id=?',[other]))[0][0].n,0);
  assert.equal((await db.execute('SELECT COUNT(*) n FROM player_story_flags WHERE user_id=? AND flag_key=?',[other,master.DAY_FLAG]))[0][0].n,0);
  assert.equal((await repo.visit(other,now,()=>0)).status,'learned');
  const next=await repo.visit(id,now+120000,()=>0);assert.equal(next.status,'learned');assert.equal(next.date,'2026-11-13');assert.notEqual(next.recipe.key,results[0].recipe.key);
  assert.equal((await repo.visit(id,now+120000,()=>{throw Error('Repeat must not draw');})).status,'already');
  // Learned recipes immediately appear in the existing Mutator notebook and can
  // be favorited and used; actual mutation increments attempts from zero to one.
  await db.execute('UPDATE users SET money=20000000 WHERE id=?',[id]);
  let h=(await housing.purchase(id,{requestId:randomUUID(),revision:0,entryKey:require('../server/game/housing/entries').entries[0].key,model:'nid'})).home;
  h=(await housing.furniture(id,{requestId:randomUUID(),revision:h.revision,key:'berry_mutator',quantity:1})).home;
  const furnitureId=randomUUID();
  h=(await housing.saveFloor(id,{requestId:randomUUID(),revision:h.revision,floor:0,layout:{...h.floors[0],placements:[{id:furnitureId,key:'berry_mutator',x:11,y:11,rotation:0}]}})).home;
  const p={kind:'mutator',floor:0,furnitureId},panel=await garden.panel(id,h,p);assert.equal(panel.recipes.length,2);assert(panel.recipes.every(r=>r.attempts===0));
  h=(await garden.favorite(id,{...p,requestId:randomUUID(),revision:h.revision,recipeKey:next.recipe.key,favorite:true})).home;
  const counts=new Map();for(const key of next.recipe.ingredients)counts.set(key,(counts.get(key)||0)+1);
  for(const[key,n]of counts)await db.execute('INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,?,?) ON DUPLICATE KEY UPDATE quantity=VALUES(quantity)',[id,key,n]);
  h=(await garden.mutate(id,{...p,requestId:randomUUID(),revision:h.revision,ingredients:next.recipe.ingredients})).home;
  const learned=(await garden.panel(id,h,p)).recipes.find(r=>r.key===next.recipe.key);assert.equal(learned.attempts,1);assert(learned.favorite);
  // Every remaining day teaches a different exact combination, without changing
  // known attempts or favorites, and stops cleanly after all catalog recipes.
  for(let i=2;i<master.recipes.length;i++)assert.equal((await repo.visit(id,now+i*86400000,()=>0)).status,'learned');
  assert.equal((await repo.visit(id,now+master.recipes.length*86400000,()=>0)).status,'exhausted');
  [rows]=await db.execute('SELECT recipe_key,attempts FROM berry_recipe_discoveries WHERE user_id=?',[id]);assert.equal(rows.length,master.recipes.length);assert.equal(rows.find(r=>r.recipe_key===next.recipe.key).attempts,1);
  const [flags]=await db.execute('SELECT * FROM player_story_flags WHERE user_id=? AND flag_key=?',[id,master.DAY_FLAG]);assert.equal(flags.length,1);
  await assert.rejects(repo.visit(2147483647,now),/introuvable/);
 }finally{for(const id of ids)await db.execute('DELETE FROM users WHERE id=?',[id]);await db.end();}
});
