const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const enabled=process.env.RUN_MYSQL_TESTS==='1';let db,items,users;
test.before(()=>{if(!enabled)return;if(!/test/i.test(process.env.DB_NAME||''))throw Error('Dedicated test database required');db=require('../server/config/database').dbPool;items=require('../server/persistence/itemRepository');users=require('../server/persistence/userRepository');});
test.after(async()=>{await db?.end();});
test('fishing SQL: concurrent one-time rod purchase is atomic, map/quantity/expense cannot be spoofed', {skip:!enabled},async()=>{
 const u=await users.createUserWithStarter('fishing_'+randomUUID(),'Fishing-test-password-2026',{starterId:7,sprite:'sprite.png'});
 try{
  await db.execute('UPDATE users SET money=50000 WHERE id=?',[u.id]);
  assert.equal((await items.purchaseUserItem(u.id,'fishing_rod',1,{mapName:'ville1_shop'})).success,false);
  assert.equal((await items.purchaseUserItem(u.id,'fishing_rod',2,{mapName:'tour_rdc'})).reason,'purchase_limit');
  const results=await Promise.all([1,2,3].map(()=>items.purchaseUserItem(u.id,'fishing_rod',1,{mapName:'tour_rdc',price:1})));
  assert.equal(results.filter(r=>r.success).length,1);assert.equal(results.filter(r=>r.reason==='purchase_limit').length,2);
  const [rows]=await db.execute('SELECT money FROM users WHERE id=?',[u.id]);assert.equal(Number(rows[0].money),35000);
  assert.equal((await items.loadUserItems(u.id)).find(i=>i.key==='fishing_rod').quantity,1);
 }finally{await db.execute('DELETE FROM users WHERE id=?',[u.id]);}
});
