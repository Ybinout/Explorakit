const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const enabled=process.env.RUN_MYSQL_TESTS==='1';let db,items,users,loot;
test.before(()=>{if(!enabled)return;if(!/test/i.test(process.env.DB_NAME||''))throw Error('Dedicated test database required');db=require('../server/config/database').dbPool;items=require('../server/persistence/itemRepository');users=require('../server/persistence/userRepository');loot=require('../server/persistence/wildLootRepository');});
test.after(async()=>{await db?.end();});
const sequence=(...values)=>()=>values.shift()??.99;
async function fixture(){return users.createUserWithStarter('crystals_'+randomUUID(),'Crystal-test-password-2026',{starterId:7,sprite:'sprite.png'});}
test('SQL: ordinary and three crystal rolls commit together, repeat, hydrate and never enter purchase offers',{skip:!enabled},async()=>{
 const u=await fixture();try{
  assert.deepEqual(await loot.awardWildBattleLoot(u.id,sequence(1,.45,.35,.15)),[]);
  for(let n=0;n<2;n++)assert.deepEqual((await loot.awardWildBattleLoot(u.id,()=>0)).map(i=>i.key),['oran_berry','crystal_shard','clear_crystal','aurora_prism']);
  const [[initial]]=await db.execute('SELECT money FROM users WHERE id=?',[u.id]);let credited=0;
  const bag=await items.loadUserItems(u.id);for(const [key,price]of[['crystal_shard',300],['clear_crystal',900],['aurora_prism',6000]]){
   const item=bag.find(i=>i.key===key);assert.equal(item.quantity,2);assert.equal(item.sellPrice,price);assert.equal(item.category,'treasure');
   assert.equal((await items.purchaseUserItem(u.id,key,1,{mapName:'tour_etage1'})).success,false);
   const sale=await items.sellUserItem(u.id,key,1,{mapName:'ville1_shop',price:1});assert(sale.success);assert.equal(sale.unitPrice,price);assert.equal(sale.totalPrice,price);credited+=price;
   assert.equal(sale.money,Number(initial.money)+credited);
  }
 }finally{await db.execute('DELETE FROM users WHERE id=?',[u.id]);}
});
test('SQL: one remaining item sold concurrently is credited once, forged price ignored, other account isolated',{skip:!enabled},async()=>{
 const a=await fixture(),b=await fixture();try{
  await db.execute('UPDATE users SET money=1000 WHERE id IN (?,?)',[a.id,b.id]);await db.execute("INSERT INTO user_items(user_id,item_key,quantity)VALUES(?,'aurora_prism',1)",[a.id]);
  const result=await Promise.all(Array.from({length:5},()=>items.sellUserItem(a.id,'aurora_prism',1,{mapName:'ville1_shop',price:999999})));
  assert.equal(result.filter(r=>r.success).length,1);assert.equal(result.filter(r=>r.reason==='not_enough_items').length,4);
  assert.equal(result.find(r=>r.success).totalPrice,6000);assert.equal((await items.sellUserItem(b.id,'aurora_prism',1,{mapName:'ville1_shop'})).success,false);
  const [rows]=await db.execute('SELECT id,money FROM users WHERE id IN (?,?)',[a.id,b.id]);assert.equal(Number(rows.find(r=>r.id===a.id).money),7000);assert.equal(Number(rows.find(r=>r.id===b.id).money),1000);
 }finally{await db.execute('DELETE FROM users WHERE id IN (?,?)',[a.id,b.id]);}
});
test('SQL: wrong map, invalid quantity, protected key and insufficient stock cannot change inventory/money',{skip:!enabled},async()=>{
 const u=await fixture();try{
  await loot.awardWildBattleLoot(u.id,()=>0);const before=JSON.stringify(await items.loadUserItems(u.id));
  for(const q of[0,-1,1.1,100,'1',NaN])assert.equal((await items.sellUserItem(u.id,'clear_crystal',q,{mapName:'ville1_shop'})).reason,'invalid_quantity');
  assert.equal((await items.sellUserItem(u.id,'clear_crystal',1,{mapName:'route1'})).reason,'not_in_shop');
  assert.equal((await items.sellUserItem(u.id,'void_teleporter',1,{mapName:'ville1_shop'})).reason,'item_not_sellable');
  assert.equal((await items.sellUserItem(u.id,'clear_crystal',2,{mapName:'ville1_shop'})).reason,'not_enough_items');assert.equal(JSON.stringify(await items.loadUserItems(u.id)),before);
  for(const map of require('../server/game/world/shopCatalog').SHOP_MAPS){await db.execute("INSERT INTO user_items(user_id,item_key,quantity)VALUES(?,'crystal_shard',1)ON DUPLICATE KEY UPDATE quantity=quantity+1",[u.id]);assert((await items.sellUserItem(u.id,'crystal_shard',1,{mapName:map})).success);}
 }finally{await db.execute('DELETE FROM users WHERE id=?',[u.id]);}
});
test('SQL: sale preserves unique discovery history; equipped items are never sold from a bag',{skip:!enabled},async()=>{
 const u=await fixture();try{
  const first=await loot.awardWildLoot(u.id,sequence(0,.85,0));assert.equal(first.key,'leftovers');assert((await items.sellUserItem(u.id,'leftovers',1,{mapName:'ville1_shop'})).success);
  assert.notEqual((await loot.awardWildLoot(u.id,sequence(0,.85,0))).key,'leftovers');
  const teams=require('../server/persistence/teamRepository'),team=await teams.loadEquipe(u.id);team.pokemons[0].heldItem='leftovers';await teams.editEquipe(u.id,team);
  assert.equal((await items.sellUserItem(u.id,'leftovers',1,{mapName:'ville1_shop'})).reason,'not_enough_items');assert.equal((await teams.loadEquipe(u.id)).pokemons[0].heldItem,'leftovers');
 }finally{await db.execute('DELETE FROM users WHERE id=?',[u.id]);}
});
