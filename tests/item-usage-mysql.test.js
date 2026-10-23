const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const enabled=process.env.RUN_MYSQL_TESTS==='1';let db;
test.before(()=>{if(!enabled)return;if(!/test/i.test(process.env.DB_NAME||''))throw Error('Dedicated test database required');db=require('../server/config/database').dbPool;});
test.after(async()=>{await db?.end();});
test('Adventure inventory audit: all medicines, stones, CS, Repels and held items are usable and persisted', {skip:!enabled}, async()=>{
    const {items,targetFor,usage}=require('../scripts/lib/itemUsageFixtures');
    const teams=require('../server/persistence/teamRepository'),inventory=require('../server/persistence/itemRepository');
    const user=await require('../server/persistence/userRepository').createUserWithStarter('items_'+randomUUID(),'Inventory-test-password-2026',{starterId:7,sprite:'sprite.png'});
    const counts={};let equipped=0;
    try{
        const [[teamRow]]=await db.execute('SELECT id FROM teams WHERE user_id=?',[user.id]);
        for(const item of items){
            const kind=usage(item);if(!['medicine','stone','machine','repel','equip'].includes(kind))continue;
            const p=targetFor(item);await teams.editEquipe(user.id,{pokemons:[p]});
            await db.execute('INSERT INTO user_items(user_id,item_key,quantity) VALUES (?,?,1) ON DUPLICATE KEY UPDATE quantity=1',[user.id,item.key]);
            const publicItem=(await inventory.loadUserItems(user.id)).find(i=>i.key===item.key);assert.equal(publicItem.category,item.category,item.key);
            if(item.fieldUse)assert.deepEqual(publicItem.fieldUse,item.fieldUse,item.key);
            if(kind==='medicine'){
                const result=await require('../server/persistence/medicineRepository').useMedicine(user.id,p,item.key);
                const saved=(await teams.loadEquipe(user.id)).pokemons[0];
                for(const key of ['currentHp','status','iv','ev','movePp','maxHp','attack','defense','speed','specialAttack','specialDefense'])if(Object.hasOwn(result,key))assert.deepEqual(saved[key],result[key],`${item.key}: ${key}`);
            } else if(kind==='stone') {
                assert(publicItem.evolutions[p.uuid],item.key);
                const r=await require('../server/persistence/evolutionRepository').evolvePokemonWithStone(user.id,p.uuid,item.key);
                assert.equal((await teams.loadEquipe(user.id)).pokemons[0].data.id,r.evolution.id);
            } else if(kind==='machine') {
                const r=await require('../server/persistence/machineRepository').useMachine(user.id,p.uuid,item.key,{slot:0,expectedMoves:[]});
                assert.deepEqual((await teams.loadEquipe(user.id)).pokemons[0].abilities,r.abilities);
            } else if(kind==='repel') {
                await db.execute('UPDATE users SET repel_steps=0 WHERE id=?',[user.id]);
                assert.equal(await require('../server/persistence/repelRepository').useRepel(user.id,item.key),item.repelSteps);
                const [[row]]=await db.execute('SELECT repel_steps FROM users WHERE id=?',[user.id]);assert.equal(row.repel_steps,item.repelSteps);
            } else {
                await inventory.equipHeldItem(user.id,teamRow.id,p.uuid,item.key);
                assert.equal((await teams.loadEquipe(user.id)).pokemons[0].heldItem,item.key);
            }
            assert(!(await inventory.loadUserItems(user.id)).some(i=>i.key===item.key),`${item.key}: consumed exactly once`);
            if(item.category==='held'){
                if(kind!=='equip'){
                    await db.execute('UPDATE user_items SET quantity=1 WHERE user_id=? AND item_key=?',[user.id,item.key]);
                    await inventory.equipHeldItem(user.id,teamRow.id,p.uuid,item.key);
                    assert.equal((await teams.loadEquipe(user.id)).pokemons[0].heldItem,item.key);
                }
                equipped++;
                await inventory.equipHeldItem(user.id,teamRow.id,p.uuid,null);
                assert.equal((await teams.loadEquipe(user.id)).pokemons[0].heldItem,null);
                assert.equal((await inventory.loadUserItems(user.id)).find(i=>i.key===item.key).quantity,1);
            }
            counts[kind]=(counts[kind]||0)+1;
        }
        assert.equal(equipped,52);
        assert.deepEqual(counts,{medicine:45,equip:37,repel:3,stone:10,machine:101});
    }finally{await db.execute('DELETE FROM users WHERE id=?',[user.id]);}
});
