const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const enabled=process.env.RUN_MYSQL_TESTS==='1';let db,users,items,owner;
test.before(()=>{if(!enabled)return;if(process.env.DB_NAME!=='explorakit_test')throw Error('Dedicated test database required');db=require('../server/config/database').dbPool;users=require('../server/persistence/userRepository');items=require('../server/persistence/itemRepository');});
test.beforeEach(async()=>{if(!enabled)return;owner=await users.createUserWithStarter('store_browse_'+randomUUID(),randomUUID(),{starterId:7});await db.execute('UPDATE users SET money=100000 WHERE id=?',[owner.id]);});
test.afterEach(async()=>{if(owner){await db.execute('DELETE FROM users WHERE id=?',[owner.id]);owner=null;}});test.after(async()=>{await db?.end();});
async function unlock(){await db.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,'hoze_defeated','true') ON DUPLICATE KEY UPDATE flag_value='true'",[owner.id]);}
test('SQL every physical store counter can buy from all four departments at unchanged prices',{skip:!enabled},async()=>{
 await unlock();const before=(await db.execute('SELECT p.* FROM pokemons p JOIN teams t ON p.team_id=t.id WHERE t.user_id=? ORDER BY p.position',[owner.id]))[0];let money=100000;
 for(const mapName of ['tour_rdc','tour_etage1','tour_etage2','tour_etage3'])for(const[department,key,price]of [[1,'pokeball',150],[2,'zinc',800],[3,'choice_scarf',10000],[4,'sitrus_berry',300]]){
  const r=await items.purchaseUserItem(owner.id,key,1,{mapName,department});assert.equal(r.success,true);assert.equal(r.totalPrice,price);money-=price;assert.equal(r.money,money);
 }
 const [[user]]=await db.execute('SELECT money FROM users WHERE id=?',[owner.id]);assert.equal(Number(user.money),money);assert.deepEqual((await db.execute('SELECT p.* FROM pokemons p JOIN teams t ON p.team_id=t.id WHERE t.user_id=? ORDER BY p.position',[owner.id]))[0],before);
});
test('SQL badge locks, wrong departments, ordinary shops, outside maps and forged floor types cannot be bypassed',{skip:!enabled},async()=>{
 let r=await items.purchaseUserItem(owner.id,'choice_scarf',1,{mapName:'tour_rdc',department:3,flags:{hoze_defeated:'true'},price:1});assert.equal(r.reason,'badge_required');
 for(const mapName of ['ville1_shop','route1','centre'])assert.equal((await items.purchaseUserItem(owner.id,'zinc',1,{mapName,department:2})).success,false);
 for(const department of [null,'2',0,5,{},true])assert.equal((await items.purchaseUserItem(owner.id,'zinc',1,{mapName:'tour_rdc',department})).success,false);
 await unlock();assert.equal((await items.purchaseUserItem(owner.id,'zinc',1,{mapName:'tour_rdc',department:3})).success,false);
 const [[user]]=await db.execute('SELECT money FROM users WHERE id=?',[owner.id]);assert.equal(Number(user.money),100000);
 const ordinary=await items.purchaseUserItem(owner.id,'pokeball',1,{mapName:'ville1_shop'});assert.equal(ordinary.success,true);assert.equal(ordinary.totalPrice,150);
});
test('SQL cross-department unique purchase still has one copy with simultaneous requests',{skip:!enabled},async()=>{
 await unlock();const results=await Promise.all([items.purchaseUserItem(owner.id,'fishing_rod',1,{mapName:'tour_etage2',department:1}),items.purchaseUserItem(owner.id,'fishing_rod',1,{mapName:'tour_etage3',department:1})]);
 assert.equal(results.filter(r=>r.success).length,1);assert.equal(results.find(r=>!r.success).reason,'purchase_limit');const [[row]]=await db.execute('SELECT quantity FROM user_items WHERE user_id=? AND item_key=?',[owner.id,'fishing_rod']);assert.equal(row.quantity,1);
});
test('SQL selling from another store counter retains prices and quantities',{skip:!enabled},async()=>{
 await unlock();const bought=await items.purchaseUserItem(owner.id,'zinc',5,{mapName:'tour_rdc',department:2});assert.equal(bought.totalPrice,4000);
 const sold=await items.sellUserItem(owner.id,'zinc',2,{mapName:'tour_etage3'});assert.equal(sold.success,true);assert.equal(sold.unitPrice,400);assert.equal(sold.money,96800);assert.equal(sold.items.find(i=>i.key==='zinc').quantity,3);
});
