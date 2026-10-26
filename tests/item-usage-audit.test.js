const test=require('node:test'),assert=require('node:assert/strict');
const {items,targetFor,usage}=require('../scripts/lib/itemUsageFixtures');
const {medicineBatch}=require('../server/game/items/medicineEffects');
const economy=require('../server/game/drift/economy');
const {teachMachine}=require('../server/game/items/machines');
const clientMachines=require('../vue-explorakit/src/data/machines.json');
const clientHeld=require('../vue-explorakit/src/data/heldItems.json');
const shop=require('../server/game/world/shopCatalog');

test('every catalogue item and every shop offer has a supported use or passive role',()=>{
    assert.equal(new Set(items.map(i=>i.key)).size,items.length);
    for(const item of items){assert(usage(item),item.key);if(item.category==='held')assert(clientHeld[item.key],item.key);}
    const flags=Object.fromEntries(require('../data/game/shop_offers.json').tiers.filter(t=>t.flag).map(t=>[t.flag,'true']));
    for(const mapName of shop.SHOP_MAPS)for(const expedition of [false,true])for(const offer of shop.getShopCatalog({mapName,flags,expedition}))assert(usage(items.find(i=>i.key===offer.key)),`${mapName}: ${offer.key}`);
    assert.deepEqual(clientMachines,require('../data/game/machines.json').machines,'all CS compatibility rules match the server');
});

test('all 45 medicines/usable berries have a working field effect; all 263 CS teach their actual move',()=>{
    for(const item of items){
        const p=targetFor(item),before=JSON.stringify(p);
        if(usage(item)==='medicine'){
            const result=medicineBatch(p,item.key,1,1,()=>.5);
            assert.equal(result.consumed,1,item.key);assert.notEqual(JSON.stringify({...p,...result}),before,item.key);
            assert.equal(JSON.stringify(p),before,'validation cannot mutate the live Pokémon');
        }else if(usage(item)==='machine'){
            const result=teachMachine(p,item.key,{slot:0,expectedMoves:[]});assert.deepEqual(result.abilities,[clientMachines[item.key].move]);assert(result.movePp[0]>0);
        }
    }
});

for(const mode of ['rift','colosseum'])test(`${mode}: every consumable class works from inventory, without consuming twice`,()=>{
    for(const item of items.filter(i=>['medicine','stone','machine','repel'].includes(usage(i))&&!i.revive)){
        const pokemon=targetFor(item),p={alive:true,run:{mode,phase:'exploration'},equipe:{pokemons:[pokemon]},items:{[item.key]:1},drifts:[],equipped:[]};
        let use;
        if(usage(item)==='medicine')use=()=>economy.usePotion(p,item.key,pokemon.uuid,()=>.5);
        else if(usage(item)==='stone')use=()=>economy.evolve(p,item.key,pokemon.uuid);
        else if(usage(item)==='machine')use=()=>economy.useMachine(p,{itemKey:item.key,pokemonUuid:pokemon.uuid,slot:0,expectedMoves:[]});
        else use=()=>economy.useRepel(p,item.key);
        assert(use().success,item.key);assert.equal(p.items[item.key],0,item.key);assert.throws(use,undefined,item.key);assert.equal(p.items[item.key],0);
    }
});
