const test=require('node:test'),assert=require('node:assert/strict');
const shop=require('../server/game/world/shopCatalog');
const {medicineResult,medicineBatch}=require('../server/game/items/medicineEffects');
const factory=require('../server/game/drift/pokemonFactory');
const economy=require('../server/game/drift/economy');
const codec=require('../server/game/drift/checkpointCodec');
const {getMaxMovePp}=require('../server/game/battle/battleResources');
const {items}=require('../data/game/items.json');
function pokemon(){
    const mon=factory.create(7,30,true);
    mon.abilities=['Tackle','Flamethrower','Recover','Growl'];
    mon.movePp=[0,3,getMaxMovePp('Recover'),getMaxMovePp('Growl')];
    return mon;
}

test('Huile is an unlocked 1200 ₽ medicine in every ordinary shop and the store supplies department',async()=>{
    assert.equal(items.filter(i=>i.key==='ether').length,1);
    const {bagPocket}=await import('../vue-explorakit/src/services/bagPockets.js');
    for(const mapName of shop.SHOP_MAPS)for(const expedition of [false,true]){
        if(shop.getDepartment(mapName))continue;
        const offer=shop.getShopCatalog({mapName,expedition}).find(i=>i.key==='ether');
        assert(offer,mapName);assert.equal(offer.price,1200);assert.equal(bagPocket(offer),'medicine');
    }
    for(const mapName of Object.keys(require('../data/game/department_store.json').floors)){
        const offers=shop.getDepartmentCatalog({mapName}).filter(i=>i.key==='ether');
        assert.equal(offers.length,1);assert.equal(offers[0].department,1);
        assert.equal(offers[0].locked,false);assert.equal(offers[0].price,1200);
    }
    assert(!shop.getShopCatalog({mapName:'route1'}).some(i=>i.key==='ether'));
});

test('Huile restores the selected move even when an earlier move is empty, and caps at that move’s maximum',()=>{
    const mon=pokemon(),before=JSON.stringify(mon);
    const result=medicineBatch(mon,'ether',1,2,undefined,1);
    assert.deepEqual(result.movePp,[0,13,mon.movePp[2],mon.movePp[3]]);
    assert.equal(result.consumed,1);assert.equal(JSON.stringify(mon),before);
    Object.assign(mon,result);
    assert.equal(medicineResult(mon,'ether',undefined,1).movePp[1],15);
    assert.equal(medicineResult(mon,'ether',undefined,0).movePp[0],10);
});

test('Huile rejects missing/forged/full selections, KO, eggs, absent stock and batches before any mutation',()=>{
    const mon=pokemon(),before=JSON.stringify(mon);
    for(const moveSlot of [undefined,null,-1,4,1.5,'1',true,NaN,{},[]])
        assert.throws(()=>medicineBatch(mon,'ether',1,1,undefined,moveSlot),/capacité valide/);
    assert.throws(()=>medicineBatch(mon,'ether',1,1,undefined,2),/PP sont pleins/);
    assert.throws(()=>medicineBatch(mon,'ether',1,0,undefined,0),/sac/);
    assert.throws(()=>medicineBatch(mon,'ether',2,2,undefined,0),/unité/);
    for(const patch of [{currentHp:0},{isEgg:true}])
        assert.throws(()=>medicineBatch({...mon,...patch},'ether',1,1,undefined,0),/conscient/);
    assert.equal(JSON.stringify(mon),before);
});

test('Mepo keeps its automatic exhausted-then-incomplete targeting',()=>{
    const mon=pokemon();
    assert.deepEqual(medicineResult(mon,'leppa_berry',undefined,1).movePp,[10,3,mon.movePp[2],mon.movePp[3]]);
    mon.movePp=[35,14,mon.movePp[2],mon.movePp[3]];
    assert.equal(medicineResult(mon,'leppa_berry').movePp[1],15);
});

for(const mode of ['rift','colosseum'])test(`${mode}: purchased Huile restores selected PP and persists once; invalid uses never spend stock`,()=>{
    const mon=pokemon(),p={alive:true,currentmap:'ville1_shop',money:3600,run:{mode,phase:'exploration'},equipe:{pokemons:[mon]},items:{},drifts:[],equipped:[]};
    economy.buy(p,'ether',3);assert.equal(p.money,0);assert.equal(p.items.ether,3);
    assert.throws(()=>economy.buy(p,'ether',1),/Monnaie/);assert.equal(p.items.ether,3);
    const use=(slot)=>economy.usePotion(p,'ether',mon.uuid,undefined,1,null,slot);
    assert.equal(use(1).consumed,1);assert.equal(mon.movePp[1],13);assert.equal(mon.movePp[0],0);
    use(1);assert.equal(mon.movePp[1],15);assert.equal(p.items.ether,1);
    const snapshot=codec.encode(p);
    assert.throws(()=>use(1),/PP sont pleins/);assert.throws(()=>use('0'),/capacité valide/);
    assert.deepEqual(codec.encode(p),snapshot);
    p.inbattle=true;assert.throws(()=>use(0),/indisponible/);assert.throws(()=>economy.buy(p,'ether',1),/indisponible/);
    p.inbattle=false;p.run.phase='colosseum_ready';assert.throws(()=>use(0),/Soins automatiques/);
    p.run.phase='exploration';use(0);assert.equal(mon.movePp[0],10);assert.equal(p.items.ether,0);
    assert.throws(()=>use(0),/inutilisable/);
    const saved=codec.decode(codec.encode(p));assert.deepEqual(saved.equipe.pokemons[0].movePp,mon.movePp);assert.equal(saved.items.ether,0);
});
