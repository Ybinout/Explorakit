const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
assert.equal(process.env.RUN_MYSQL_TESTS,'1');assert.equal(process.env.DB_NAME,'explorakit_test');
const{dbPool:db}=require('../server/config/database'),users=require('../server/persistence/userRepository'),repo=require('../server/persistence/talentTreeRepository'),rules=require('../server/game/talents/rules');
const ids=[],ticket=data=>({requestId:randomUUID(),...data});
function path(n,prefix,count,choice){for(let i=1;i<=count;i++)n=rules.buy(n,prefix+i,choice);return n;}
function capture(){let n=path({},'capture_water_',15);n=path(n,'capture_fire_',14);n=path(n,'capture_ice_',1);return rules.buy(n,'capture_ultimate','shiny');}
async function fixture(nodes){const u=await users.createUserWithStarter('Orb_'+randomUUID().slice(0,8),randomUUID());ids.push(u.id);await db.execute('INSERT INTO player_talent_trees(user_id,revision,nodes_json) VALUES(?,1,?)',[u.id,JSON.stringify(nodes)]);await db.execute('UPDATE users SET money=1000000 WHERE id=?',[u.id]);for(const k of ['crystal_shard','clear_crystal','aurora_prism','dark_plate_water'])await db.execute('INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,?,10000)',[u.id,k]);return u.id;}
async function saved(id){const[[u]]=await db.execute('SELECT money FROM users WHERE id=?',[id]),[items]=await db.execute('SELECT item_key,quantity FROM user_items WHERE user_id=? ORDER BY item_key',[id]);return{money:Number(u.money),items};}
test.after(async()=>{for(const id of ids){repo.invalidate(id);await db.execute('DELETE FROM users WHERE id=?',[id]);}await db.end();});
test('an existing 41-point tree keeps its choices and can purchase a 42nd point immediately',async()=>{
 const nodes=path(capture(),'combat_fire_',5,'offense'),id=await fixture(nodes),s=await repo.state(id);assert.equal(s.used,41);assert.equal(s.available,83);assert.equal(s.bonuses.offense.Fire,12);assert.deepEqual(s.nodes,nodes);
 await repo.buy(id,ticket({revision:1,nodeId:'experience_1_1'}));const after=await repo.state(id);assert.equal(after.used,42);assert.equal(after.available,82);assert.equal(after.branches.capture,31);assert.equal(after.branches.experience,1);
});
test('last combat type node charges exactly 20 plates, rolls back at 19 and remains free to reactivate',async()=>{
 const id=await fixture(path({},'combat_water_',6,'offense'));await db.execute('UPDATE user_items SET quantity=19 WHERE user_id=? AND item_key=?',[id,'dark_plate_water']);const before=await saved(id);
 await assert.rejects(repo.buy(id,ticket({revision:1,nodeId:'combat_water_7',choice:'offense'})),/insuffisante/);assert.deepEqual(await saved(id),before);
 await db.execute('UPDATE user_items SET quantity=20 WHERE user_id=? AND item_key=?',[id,'dark_plate_water']);await repo.buy(id,ticket({revision:1,nodeId:'combat_water_7',choice:'offense'}));const paid=await saved(id);assert.equal(paid.items.find(i=>i.item_key==='dark_plate_water').quantity,0);assert.equal(before.items.find(i=>i.item_key==='crystal_shard').quantity-paid.items.find(i=>i.item_key==='crystal_shard').quantity,800);assert.equal((await repo.state(id)).bonuses.offense.Water,22);
 await repo.refund(id,ticket({revision:2,nodeId:'combat_water_7'}));await repo.buy(id,ticket({revision:3,nodeId:'combat_water_7',choice:'defense'}));assert.deepEqual(await saved(id),paid);assert.equal((await repo.state(id)).bonuses.defense.Water,6);
});
for(const branch of ['money','experience'])test(branch+' ultimate charges 5M, without changing the rest of its branch',async()=>{
 let nodes={};if(branch==='money')for(const source of ['wild','raid','tower'])nodes=path(nodes,'money_'+source+'_',10);else{for(let lane=1;lane<=4;lane++)nodes=path(nodes,`experience_${lane}_`,7);for(let i=1;i<=2;i++)nodes=rules.buy(nodes,'experience_large_'+i);}
 const id=await fixture(nodes);await db.execute('UPDATE users SET money=4999999 WHERE id=?',[id]);await assert.rejects(repo.buy(id,ticket({revision:1,nodeId:branch+'_ultimate'})),/assez/);assert.equal((await saved(id)).money,4999999);
 await db.execute('UPDATE users SET money=5000000 WHERE id=?',[id]);await repo.buy(id,ticket({revision:1,nodeId:branch+'_ultimate'}));assert.equal((await saved(id)).money,0);assert.equal((await repo.state(id)).branches[branch],31);
});
