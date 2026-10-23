const test = require('node:test');
const assert = require('node:assert/strict');
const {getShopCatalog, getShopMeta, shopTier} = require('../server/game/world/shopCatalog');
const {medicineResult, medicineBatch} = require('../server/game/items/medicineEffects');
const factory = require('../server/game/drift/pokemonFactory');
const economy = require('../server/game/drift/economy');
const codec = require('../server/game/drift/checkpointCodec');
const {STAT_KEYS} = require('../server/game/models/training');
const {tiers} = require('../data/game/shop_offers.json');
const items = require('../data/game/items.json').items;
const catalog = (flags={}, mapName='ville1_shop', expedition=false) => getShopCatalog({flags,mapName,expedition});
const pokemon = () => {const p=factory.create(7,40,true);p.iv.attack=10;p.recalculateStats();p.currentHp-=7;return p;};

test('shop progression: authoritative arena flags progressively add supplies without removing earlier offers', () => {
    let previous=[];const flags={};
    for(let i=0;i<tiers.length;i++){
        if(tiers[i].flag)flags[tiers[i].flag]='true';
        const current=catalog(flags).map(i=>i.key);
        assert(previous.every(key=>current.includes(key)));
        if(i<5)assert(current.length>previous.length);
        assert.equal(shopTier(flags),i);previous=current;
    }
    assert(!catalog().some(i=>i.key==='hyperball'));
    assert(catalog({hoze_defeated:'true'}).some(i=>i.key==='hyperball'));
    assert.equal(shopTier({wanda_defeated:'false'}),0);
    assert.equal(shopTier({wanda_defeated:'true'}),5,'legacy later wins need no replay');
    assert.deepEqual(catalog({},'route1'),[]);
});

test('Whitepeak training: exact location and Wanda victory; expedition supplies independent of Adventure; unique loot remains exclusive', () => {
    const flags={wanda_defeated:'true'};
    for(const key of ['zinc','calcium','iv_randomizer_attack','ev_reset_all']){
        assert(!catalog(flags).some(i=>i.key===key));
        assert(!catalog({},'ville5_shop').some(i=>i.key===key));
        assert(catalog(flags,'ville5_shop').some(i=>i.key===key));
        assert(catalog({},'ville5_shop',true).some(i=>i.key===key));
    }
    for(const mapName of ['ville5_shop','tour_etage1'])for(const expedition of [false,true])for(const key of ['hp_up','protein','iron','calcium','zinc','carbos'])assert.equal(catalog(flags,mapName,expedition).find(i=>i.key===key).price,800);
    assert.equal(catalog(flags,'ville5_shop').find(i=>i.key==='iv_randomizer_attack').price,250);
    assert.equal(getShopMeta({mapName:'ville5_shop'}).trainingAvailable,false);
    for(const expedition of [false,true])for(const item of items.filter(i=>i.unique&&i.dropOnly))assert(!catalog(flags,'ville5_shop',expedition).some(i=>i.key===item.key));
    assert(catalog({},'ville1_shop',true).some(i=>i.key==='thunder_stone'));
});

for(const stat of STAT_KEYS)test(`IV ${stat}: bounded targeted roll can lower even IV31, preserves K/EV/level/wounds and source`,()=>{
    const p=pokemon();p.iv[stat]=10;p.recalculateStats(true);
    const before=JSON.stringify(p),key=`iv_randomizer_${stat}`;
    const low=medicineBatch(p,key,1,1,()=>0);assert.equal(low.iv[stat],0);assert.equal(low.trainingChange.rolled,0);assert.equal(low.consumed,1);
    const high=medicineResult(p,key,()=>.99999);assert.equal(high.iv[stat],31);
    assert.equal(high.maxHp-high.currentHp,p.maxHp-p.currentHp);
    for(const other of STAT_KEYS.filter(s=>s!==stat))assert.equal(high.iv[other],p.iv[other]);
    assert.equal(JSON.stringify(p),before);assert.equal(high.k,undefined);assert.equal(high.ev,undefined);assert.equal(high.level,undefined);
    assert.throws(()=>medicineResult(p,key,()=>1),/Tirage/);
    p.iv[stat]=31;assert.equal(medicineResult(p,key,()=>0).iv[stat],0);
});

test('EV resets are targeted or full, preserve wounds/IV and never consume at zero, for eggs or KO',()=>{
    const p=pokemon();p.ev={hp:100,attack:200,defense:0,specialAttack:10,specialDefense:20,speed:30};p.recalculateStats(true);
    const before=JSON.stringify(p),target=medicineResult(p,'ev_reset_attack');assert.equal(target.ev.attack,0);assert.equal(target.ev.hp,100);
    const all=medicineResult(p,'ev_reset_all');assert(Object.values(all.ev).every(n=>n===0));assert.equal(all.maxHp-all.currentHp,p.maxHp-p.currentHp);assert.equal(JSON.stringify(p),before);
    assert.throws(()=>medicineResult(p,'ev_reset_defense'),/aucun effet/);
    for(const key of ['iv_randomizer_attack','ev_reset_all','protein']){
        p.currentHp=0;assert.throws(()=>medicineBatch(p,key,1,1),/apte/);p.currentHp=1;p.isEgg=true;assert.throws(()=>medicineBatch(p,key,1,1),/apte/);p.isEgg=false;
    }
});

test('vitamin batches consume only useful stock, respect 252/510 including last partial dose; other objects are single use',()=>{
    const p=pokemon();let r=medicineBatch(p,'protein',25,25);assert.equal(r.consumed,25);assert.equal(r.ev.attack,250);assert.equal(p.ev.attack,0);
    p.ev.attack=247;r=medicineBatch(p,'protein',25,25);assert.equal(r.consumed,1);assert.equal(r.ev.attack,252);
    p.ev.hp=252;p.ev.attack=250;p.ev.defense=6;r=medicineBatch(p,'protein',25,25);assert.equal(r.consumed,1);assert.equal(r.ev.attack,252);
    p.ev.attack=252;assert.throws(()=>medicineBatch(p,'protein',25,25),/aucun effet/);
    p.ev={hp:0,attack:0,defense:0,specialAttack:0,specialDefense:0,speed:0};assert.equal(medicineBatch(p,'zinc',25,3).consumed,3);
    for(const n of [0,-1,1.5,100,'5'])assert.throws(()=>medicineBatch(p,'protein',n,99),/Quantité/);
    assert.throws(()=>medicineBatch(p,'ev_reset_all',2,2),/unité/);assert.throws(()=>medicineBatch(p,'protein',1,0),/sac/);
});

for(const mode of ['rift','colosseum'])test(`${mode}: training uses own stock, persists checkpoint, works between rounds and cannot heal KO or refund IV`,()=>{
    const p={alive:true,currentmap:'ville5_shop',money:10000,run:{mode,phase:'exploration'},equipe:{pokemons:[pokemon()]},items:{},drifts:[],equipped:[]};
    economy.buy(p,'iv_randomizer_attack',2);assert.equal(p.money,9500);p.run.phase='colosseum_ready';
    const result=economy.usePotion(p,'iv_randomizer_attack',p.equipe.pokemons[0].uuid,()=>.9999);assert.equal(result.trainingChange.after,31);assert.equal(p.items.iv_randomizer_attack,1);
    economy.usePotion(p,'iv_randomizer_attack',p.equipe.pokemons[0].uuid,()=>0);assert.equal(p.equipe.pokemons[0].iv.attack,0);assert.equal(p.items.iv_randomizer_attack,0);
    p.items.protein=25;assert.equal(economy.usePotion(p,'protein',p.equipe.pokemons[0].uuid,()=>0,25).consumed,25);
    p.items.ev_reset_all=1;economy.usePotion(p,'ev_reset_all',p.equipe.pokemons[0].uuid);assert(Object.values(p.equipe.pokemons[0].ev).every(n=>n===0));
    const saved=codec.decode(codec.encode(p));assert.equal(saved.equipe.pokemons[0].iv.attack,0);assert.equal(saved.items.protein,0);
    p.run.phase='exploration';p.currentmap='ville1_shop';assert.throws(()=>economy.buy(p,'zinc',1),/Achat/);
});

// Level 100, neutral nature and K4 give exact independent expectations:
// each IV contributes 4 points and each complete group of 4 EV contributes 1.
for (const stat of STAT_KEYS) test(`${stat}: actual stats follow IV/EV items immediately and after expedition recovery`, () => {
    const baseKeys={hp:'HP',attack:'Attack',defense:'Defense',specialAttack:'Sp. Attack',specialDefense:'Sp. Defense',speed:'Speed'};
    const field=stat==='hp'?'maxHp':stat;
    for (const mode of ['rift','colosseum']) {
        const mon=factory.create(7,100,true);
        mon.k=4;mon.nature='Bashful';
        mon.iv=Object.fromEntries(STAT_KEYS.map(key=>[key,0]));
        mon.ev=Object.fromEntries(STAT_KEYS.map(key=>[key,0]));
        mon.recalculateStats();mon.currentHp-=7;
        const player={alive:true,run:{mode,phase:'colosseum_ready'},equipe:{pokemons:[mon]},items:{},drifts:[],equipped:[]};
        const baseline=Object.fromEntries(STAT_KEYS.map(key=>[key,mon[key==='hp'?'maxHp':key]]));
        const vitamin=items.find(item=>item.fieldUse?.effort?.stat===stat && item.fieldUse.effort.amount===10).key;
        const base=2*mon.data.base[baseKeys[stat]]+(stat==='hp'?110:5);
        const use=(key,expected,random=()=>0,quantity=1)=>{
            player.items[key]=quantity;
            const response=economy.usePotion(player,key,mon.uuid,random,quantity);
            for(const actual of [response.equipe.pokemons[0],codec.decode(codec.encode(player)).equipe.pokemons[0]]){
                assert.equal(actual[field],expected,`${mode} ${key} permanent`);
                if(stat!=='hp')assert.equal(actual['current'+stat[0].toUpperCase()+stat.slice(1)],expected,`${mode} ${key} combat`);
                assert.equal(actual.maxHp-actual.currentHp,7);
                for(const other of STAT_KEYS.filter(key=>key!==stat))assert.equal(actual[other==='hp'?'maxHp':other],baseline[other]);
            }
        };
        use(`iv_randomizer_${stat}`,base+124,()=>.9999);
        use(`iv_randomizer_${stat}`,base);
        use(vitamin,base+62,()=>0,25);
        use(`ev_reset_${stat}`,base);
        use(vitamin,base+62,()=>0,25);
        use('ev_reset_all',base);
    }
});
