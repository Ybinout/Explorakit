const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
test('bulk harvesting is scoped, mature-only, atomic, idempotent; recipe favorites persist per owner', {skip:process.env.RUN_MYSQL_TESTS!=='1'},async()=>{
 assert.equal(process.env.DB_NAME,'explorakit_test');
 const{dbPool:db}=require('../server/config/database'),users=require('../server/persistence/userRepository'),repo=require('../server/persistence/housingRepository'),garden=require('../server/persistence/berryGardenRepository'),items=require('../server/persistence/itemRepository');
 const accounts=[];
 try{
  const owner=await users.createUserWithStarter('BerryComfort_'+randomUUID().slice(0,8),randomUUID());accounts.push(owner.id);
  const other=await users.createUserWithStarter('BerryOther_'+randomUUID().slice(0,8),randomUUID());accounts.push(other.id);
  await db.execute('UPDATE users SET money=20000000 WHERE id=?',[owner.id]);
  let home=(await repo.purchase(owner.id,{requestId:randomUUID(),revision:0,entryKey:require('../server/game/housing/entries').entries[0].key,model:'nid'})).home;
  for(const key of ['berry_pot','berry_planter','berry_mutator'])home=(await repo.furniture(owner.id,{requestId:randomUUID(),revision:home.revision,key,quantity:1})).home;
  const pot=randomUUID(),planter=randomUUID(),mutator=randomUUID();home=(await repo.saveFloor(owner.id,{requestId:randomUUID(),revision:home.revision,floor:0,layout:{...home.floors[0],placements:[{id:pot,key:'berry_pot',x:11,y:11,rotation:0},{id:planter,key:'berry_planter',x:10,y:13,rotation:0},{id:mutator,key:'berry_mutator',x:15,y:11,rotation:0}]}})).home;
  for(const[furniture,slot,age,key]of [[planter,0,1205000,'oran_berry'],[planter,1,3000,'sitrus_berry'],[planter,2,1205000,'oran_berry'],[pot,0,1205000,'cheri_berry']])await db.execute('INSERT INTO housing_berry_crops(user_id,furniture_id,slot_index,berry_key,planted_at) VALUES(?,?,?,?,?)',[owner.id,furniture,slot,key,Date.now()-age]);
  home=await repo.read(owner.id);const req=(furnitureId,more={})=>({requestId:randomUUID(),revision:home.revision,floor:0,furnitureId,...more});
  const command=req(planter),race=await Promise.all([garden.harvestAll(owner.id,command),garden.harvestAll(owner.id,command)]);assert.equal(race.filter(x=>x.duplicate).length,1);assert.equal(race[0].receipt.harvested.length,2);
  home=await repo.read(owner.id);assert.equal(home.crops.length,2);assert.equal(home.crops.filter(c=>c.furnitureId===planter)[0].slot,1);
  assert.equal((await items.loadUserItems(owner.id)).find(i=>i.key==='corrupted_oran_berry').quantity,2);
  await assert.rejects(garden.harvestAll(owner.id,req(planter)),/Aucune baie/);
  const single=await garden.harvestAll(owner.id,req(pot));home=single.home;assert.equal(single.receipt.harvested.length,1);
  assert.equal((await items.loadUserItems(owner.id)).find(i=>i.key==='corrupted_cheri_berry').quantity,1);
  await assert.rejects(garden.harvestAll(owner.id,req(mutator)),/équipement/);
  const ingredients=['corrupted_oran_berry','corrupted_sitrus_berry','corrupted_cheri_berry'];for(const key of ingredients)await db.execute('INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,?,3) ON DUPLICATE KEY UPDATE quantity=3',[owner.id,key]);
  home=(await garden.mutate(owner.id,req(mutator,{ingredients}))).home;
  let panel=await garden.panel(owner.id,home,{kind:'mutator',floor:0,furnitureId:mutator});const key=panel.recipes[0].key;assert.equal(panel.recipes[0].favorite,false);
  const inventory=await items.loadUserItems(owner.id),favorite=req(mutator,{recipeKey:key,favorite:true});home=(await garden.favorite(owner.id,favorite)).home;assert.equal((await garden.favorite(owner.id,favorite)).duplicate,true);
  // A new read simulates closing/reopening or a fresh connection; no local-only preference.
  home=await repo.read(owner.id);panel=await garden.panel(owner.id,home,{kind:'mutator',floor:0,furnitureId:mutator});assert.equal(panel.recipes[0].favorite,true);assert.deepEqual(await items.loadUserItems(owner.id),inventory);
  const[[foreign]]=await db.execute("SELECT COUNT(*) n FROM player_story_flags WHERE user_id=? AND flag_key LIKE 'berry!_fav:%' ESCAPE '!'",[other.id]);assert.equal(Number(foreign.n),0);
  await assert.rejects(garden.favorite(owner.id,req(mutator,{recipeKey:'a'.repeat(64),favorite:true})),/découverte/);
  await assert.rejects(garden.favorite(owner.id,req(mutator,{recipeKey:key,favorite:'true'})),/invalide/);
  home=(await garden.favorite(owner.id,req(mutator,{recipeKey:key,favorite:false}))).home;assert.equal((await garden.panel(owner.id,home,{kind:'mutator',floor:0,furnitureId:mutator})).recipes[0].favorite,false);
 }finally{for(const id of accounts)await db.execute('DELETE FROM users WHERE id=?',[id]);await db.end();}
});
