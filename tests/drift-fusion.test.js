const test = require('node:test'), assert = require('node:assert/strict');
const fusion = require('../server/game/drift/fusion');
const effects = require('../server/game/drift/driftEffects');
const factory = require('../server/game/drift/pokemonFactory');
const report = require('../server/game/drift/runReport');
const merchant = require('../server/game/drift/merchant');
const colosseum = require('../server/game/drift/colosseum');
const { encode,decode } = require('../server/game/drift/checkpointCodec');
const { DriftBattle } = require('../server/game/drift/driftBattle');
const drift = (uuid,rarity='common',definitionId='DRF-002',element=null) => ({uuid,rarity,definitionId,element});
function player() {
    const p = {userId:1,alive:true,inbattle:false,ready:true,money:20000,currentmap:'ville1_shop',items:{},defeated:new Set(),
        run:{mode:'colosseum',phase:'exploration'},equipe:{pokemons:[factory.create(7,5)]},drifts:[],equipped:[]};
    report.init(p,()=>1000);return p;
}
test('cascade upgrades equipped Drift in place, keeps five families and exact report, is idempotent after checkpoint',()=>{
    const p=player();p.drifts=[drift('a'),drift('b'),drift('c','rare'),...Array.from({length:4},(_,i)=>drift('other'+i,'rare','DRF-00'+(i+3)))];
    p.equipped=['other0','b','other1','other2','other3'];report.syncDrifts(p);
    assert.equal(fusion.consolidate(p).length,2);assert.equal(p.drifts.length,5);
    assert.equal(p.drifts.find(d=>d.uuid==='b').rarity,'epic');assert.deepEqual(p.equipped,['other0','b','other1','other2','other3']);assert.equal(p.ready,false);
    assert.equal(p.runReport.drifts.get('b').rarity,'epic');assert.equal(p.runReport.drifts.get('a').status,'fused');assert.equal(p.runReport.drifts.get('c').status,'fused');
    assert.equal(p.runReport.stats.driftsFused,2);assert.equal(p.runReport.stats.driftsFound,0);assert.equal(p.runReport.stats.driftsDiscarded,0);
    const restored=decode(encode(p));assert.deepEqual(fusion.consolidate(restored),[]);assert.equal(restored.runReport.stats.driftsFused,2);assert.deepEqual(restored.equipped,p.equipped);
});
test('distinct elements/families/rarities never mix; mythics and unsupported definitions remain intact',()=>{
    const p=player();p.drifts=[drift('fire','rare','DRF-001','Fire'),drift('water','rare','DRF-001','Water'),drift('rarity','epic','DRF-001','Fire'),drift('m1','mythic'),drift('m2','mythic'),drift('invalid1','common','DRF-059'),drift('invalid2','common','DRF-059')];
    const before=JSON.stringify(p.drifts);assert.deepEqual(fusion.consolidate(p),[]);assert.equal(JSON.stringify(p.drifts),before);
    fusion.acquire(p,drift('fire2','rare','DRF-001','Fire'),'wild');assert.equal(p.drifts.find(d=>d.uuid==='fire').rarity,'legendary');assert(p.drifts.some(d=>d.uuid==='water'));
});
test('loot during settlement waits for detach, then applies upgraded bonuses only in next battle',()=>{
    const p=player();p.drifts=[drift('equipped')];p.equipped=['equipped'];
    const enemy={npc:true,equipe:{pokemons:[factory.create(19,5)]},drifts:[],equipped:[]};
    const b=new DriftBattle(p,enemy,{emit(){},now:()=>1000,random:()=>.99});
    const before=effects.value(p,2);fusion.acquire(p,drift('loot'),'wild');assert.equal(p.drifts.length,2);assert.equal(effects.value(p,2),before);
    // finish sets inbattle=false before awarding loot; attached effects still prevent mutation.
    p.inbattle=false;assert.deepEqual(fusion.consolidate(p),[]);p.inbattle=true;
    b.finish(null,'fled');assert.equal(p.drifts.length,1);assert.equal(p.drifts[0].rarity,'rare');assert(!effects.states.has(p.equipe.pokemons[0]));
});
test('merchant purchase/exchange and guardian reward trigger fusion without replaying costs or rewards',()=>{
    const p=player();p.drifts=[drift('own')];p.run.merchant={id:'stock',offers:[{id:'offer',price:200,drift:drift('stock')}]};
    merchant.buy(p,'offer');assert.equal(p.drifts.length,1);assert.equal(p.drifts[0].rarity,'rare');assert.equal(p.money,19800);assert.throws(()=>merchant.buy(p,'offer'));
    const rolled=merchant.rollDrift('common',()=>.5);p.drifts=[{...rolled,uuid:'keep'},drift('s1'),drift('s2'),drift('s3')];
    report.syncDrifts(p);merchant.exchange(p,['s1','s2','s3'],()=>.5);
    for(const id of ['s1','s2','s3'])assert.equal(p.runReport.drifts.get(id).status,'discarded');assert.equal(p.drifts.length,1);assert.equal(p.drifts[0].rarity,'rare');assert.throws(()=>merchant.exchange(p,['s1','s2','s3']));
    p.run.phase='colosseum_ready';p.run.colosseum={reward:colosseum.rewardOffer(5)};const offer=p.run.colosseum.reward;p.drifts=[drift('guardian','epic',offer.options[0].definitionId)];p.equipped=['guardian'];
    colosseum.chooseReward(p,{offerId:offer.id,definitionId:offer.options[0].definitionId});assert.equal(p.drifts[0].rarity,'legendary');assert.deepEqual(p.equipped,['guardian']);assert.throws(()=>colosseum.chooseReward(p,{offerId:offer.id,definitionId:offer.options[0].definitionId}));
});
