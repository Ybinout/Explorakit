const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const enabled=process.env.RUN_MYSQL_TESTS==='1';let db;
test.before(()=>{if(!enabled)return;if(!/test/i.test(process.env.DB_NAME||''))throw Error('Dedicated test database required');db=require('../server/config/database').dbPool;});
test.after(async()=>{await db?.end();});
test('Adventure: buy Huile without badges from every shop/counter, target PP and persist exactly one consumption',{skip:!enabled},async()=>{
    const inventory=require('../server/persistence/itemRepository'),teams=require('../server/persistence/teamRepository');
    const medicine=require('../server/persistence/medicineRepository'),shop=require('../server/game/world/shopCatalog');
    const user=await require('../server/persistence/userRepository').createUserWithStarter('pp_'+randomUUID(),randomUUID(),{starterId:7});
    try{
        await db.execute('UPDATE users SET money=100000 WHERE id=?',[user.id]);
        let bought=0;
        for(const mapName of shop.SHOP_MAPS){
            const context={mapName,...(shop.getDepartment(mapName)?{department:1}:{})};
            const result=await inventory.purchaseUserItem(user.id,'ether',1,context);
            assert.equal(result.success,true,mapName);assert.equal(result.totalPrice,1200);bought++;
            assert.equal(result.money,100000-bought*1200);
        }
        const mon=(await teams.loadEquipe(user.id)).pokemons[0];
        mon.abilities=['Tackle','Flamethrower','Recover','Growl'];mon.movePp=[0,3,10,40];
        await teams.editEquipe(user.id,{pokemons:[mon]});
        const stock=async()=>Number((await inventory.loadUserItems(user.id)).find(i=>i.key==='ether')?.quantity||0);
        const use=slot=>medicine.useMedicine(user.id,mon,'ether',1,null,slot);
        assert.equal((await use(1)).movePp[1],13);assert.equal(await stock(),bought-1);
        const saved=(await teams.loadEquipe(user.id)).pokemons[0];assert.deepEqual(saved.movePp,[0,13,10,40]);
        assert.equal((await use(1)).movePp[1],15);assert.equal(await stock(),bought-2);
        for(const slot of [1,2,undefined,'0',-1,4])await assert.rejects(()=>use(slot),/PP sont pleins|capacité valide/);
        assert.equal(await stock(),bought-2);assert.deepEqual((await teams.loadEquipe(user.id)).pokemons[0].movePp,[0,15,10,40]);
        await db.execute('UPDATE user_items SET quantity=0 WHERE user_id=? AND item_key=?',[user.id,'ether']);
        await assert.rejects(()=>use(0),/sac/);assert.equal(await stock(),0);
        assert.equal((await teams.loadEquipe(user.id)).pokemons[0].movePp[0],0);
    }finally{await db.execute('DELETE FROM users WHERE id=?',[user.id]);}
});
