const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
assert.equal(process.env.RUN_MYSQL_TESTS,'1');assert.equal(process.env.DB_NAME,'explorakit_test');
const {dbPool:db}=require('../server/config/database'),repo=require('../server/persistence/talentTreeRepository'),rules=require('../server/game/talents/rules'),users=require('../server/persistence/userRepository');
const ids=[],ticket=data=>({requestId:randomUUID(),...data});
async function user(nodes={}){const u=await users.createUserWithStarter('Reactivate_'+randomUUID().slice(0,9),randomUUID());ids.push(u.id);await db.execute('INSERT INTO player_talent_trees(user_id,revision,nodes_json) VALUES(?,1,?)',[u.id,JSON.stringify(nodes)]);await db.execute('UPDATE users SET money=1000000 WHERE id=?',[u.id]);for(const key of ['crystal_shard','clear_crystal','aurora_prism','dark_plate_water','dark_plate_fire','dark_plate_normal'])await db.execute('INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,?,10000)',[u.id,key]);return u.id;}
async function wallet(id){const[[u]]=await db.execute('SELECT money FROM users WHERE id=?',[id]),[items]=await db.execute('SELECT item_key,quantity FROM user_items WHERE user_id=? ORDER BY item_key',[id]);return{money:u.money,items};}
async function empty(id){await db.execute('UPDATE users SET money=0 WHERE id=?',[id]);await db.execute('UPDATE user_items SET quantity=0 WHERE user_id=?',[id]);}
async function historic(id,nodeId,refunded=false){await db.execute('INSERT INTO magic_island_receipts(request_id,user_id,request_hash,result_json) VALUES(?,?,?,?)',[randomUUID(),id,'0'.repeat(64),JSON.stringify({nodeId,refunded})]);}
test.after(async()=>{for(const id of ids){repo.invalidate(id);await db.execute('DELETE FROM users WHERE id=?',[id]);}await db.end();});
test('first activation pays once; withdrawals and concurrent replay of free reactivation never charge again',async()=>{
 const id=await user(),before=await wallet(id),nodeId='combat_water_1';
 assert.equal((await repo.buy(id,ticket({revision:1,nodeId,choice:'offense'}))).reactivated,false);
 const paid=await wallet(id);assert.equal(before.items.find(i=>i.item_key==='crystal_shard').quantity-paid.items.find(i=>i.item_key==='crystal_shard').quantity,200);
 await repo.refund(id,ticket({revision:2,nodeId}));assert.deepEqual(await wallet(id),paid);
 await empty(id);const zero=await wallet(id),request=ticket({revision:3,nodeId,choice:'defense'});
 const results=await Promise.all([repo.buy(id,request),repo.buy(id,request)]);assert(results.every(r=>r.reactivated));assert.equal(results.filter(r=>r.duplicate).length,1);
 assert.deepEqual(await wallet(id),zero);const state=await repo.state(id);assert.equal(state.revision,4);assert.equal(state.used,2);assert.equal(state.bonuses.defense.Water,2);assert.equal(state.bonuses.offense.Water,undefined);assert(state.purchasedNodes.includes(nodeId));
});
test('pre-patch purchase and withdrawal receipts restore paid history after reconnect, even with no active nodes',async()=>{
 const id=await user();await historic(id,'combat_water_1',false);await historic(id,'combat_fire_1',true);await historic(id,'unknown_node',false);await empty(id);
 repo.invalidate(id);const state=await repo.state(id);assert.deepEqual(new Set(state.purchasedNodes),new Set(['combat_water_1','combat_fire_1']));assert.equal(state.used,0);
 const before=await wallet(id);await repo.buy(id,ticket({revision:1,nodeId:'combat_fire_1',choice:'offense'}));assert.deepEqual(await wallet(id),before);
});
test('active legacy nodes gain permanent reactivation through their first withdrawal',async()=>{
 const id=await user(rules.buy({},'combat_water_1','offense'));await empty(id);assert((await repo.state(id)).purchasedNodes.includes('combat_water_1'));
 await repo.refund(id,ticket({revision:1,nodeId:'combat_water_1'}));repo.invalidate(id);
 assert((await repo.state(id)).purchasedNodes.includes('combat_water_1'));await repo.buy(id,ticket({revision:2,nodeId:'combat_water_1',choice:'defense'}));assert.equal((await repo.state(id)).used,2);
});
test('paid ultimate reactivates without crystals, money or a second mixed-plate distribution',async()=>{
 let nodes={};for(const source of ['wild','raid','tower'])for(let i=1;i<=10;i++)nodes=rules.buy(nodes,'money_'+source+'_'+i);
 const id=await user(nodes),nodeId='money_ultimate';await db.execute('UPDATE users SET money=10000000 WHERE id=?',[id]);await repo.buy(id,ticket({revision:1,nodeId}));await repo.refund(id,ticket({revision:2,nodeId}));await empty(id);const before=await wallet(id);await repo.buy(id,ticket({revision:3,nodeId}));assert.deepEqual(await wallet(id),before);assert.equal((await repo.state(id)).bonuses.globalMoney,15);
 let combat={};for(const[type,count]of[['water',7],['fire',7],['normal',1]])for(let i=1;i<=count;i++)combat=rules.buy(combat,'combat_'+type+'_'+i,'offense');
 const other=await user(combat);await repo.buy(other,ticket({revision:1,nodeId:'combat_ultimate',plates:{Water:100,Fire:100}}));await repo.refund(other,ticket({revision:2,nodeId:'combat_ultimate'}));await empty(other);
 assert((await repo.buy(other,ticket({revision:3,nodeId:'combat_ultimate'}))).reactivated);assert.equal((await repo.state(other)).bonuses.globalDamage,6);
});
test('unpaid nodes, forged purchase flags and another account history cannot bypass payment',async()=>{
 const a=await user(),b=await user();await historic(a,'combat_water_1');await empty(b);
 const before=await wallet(b);await assert.rejects(repo.buy(b,ticket({revision:1,nodeId:'combat_water_1',choice:'offense',reactivated:true,purchasedNodes:['combat_water_1']})),/insuffisante/);
 assert.deepEqual(await wallet(b),before);const s=await repo.state(b);assert.equal(s.used,0);assert.deepEqual(s.purchasedNodes,[]);
});
test('a paid node still requires its path, points, valid choice and fresh revision',async()=>{
 const id=await user();await historic(id,'combat_water_2');await empty(id);
 await assert.rejects(repo.buy(id,ticket({revision:1,nodeId:'combat_water_2',choice:'offense'})),/précédents/);
 await historic(id,'combat_water_1');await assert.rejects(repo.buy(id,ticket({revision:1,nodeId:'combat_water_1',choice:'both'})),/orientations/);
 await repo.buy(id,ticket({revision:1,nodeId:'combat_water_1',choice:'offense'}));await assert.rejects(repo.buy(id,ticket({revision:1,nodeId:'combat_water_2',choice:'offense'})),/changé/);
 let full={};for(const[type,count]of[['fire',7],['water',7],['normal',1]])for(let i=1;i<=count;i++)full=rules.buy(full,'combat_'+type+'_'+i,'offense');
 const capped=await user(full);await historic(capped,'combat_ice_1');await assert.rejects(repo.buy(capped,ticket({revision:1,nodeId:'combat_ice_1',choice:'offense'})),/31 points/);
});
