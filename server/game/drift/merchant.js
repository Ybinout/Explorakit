const { randomUUID } = require('node:crypto');
const catalogue = require('../../../data/game/drifts.json');
const report = require('./runReport');
const { LobbyError } = require('./lobbyStore');
const { isShopMap } = require('../world/shopCatalog');
const rarities = ['common','rare','epic','legendary','mythic'];
const prices = { common:200, rare:480, epic:1200, legendary:3200, mythic:8000 };
const types = ['Normal','Fire','Water','Electric','Grass','Ice','Fighting','Poison','Ground','Flying','Psychic','Bug','Rock','Ghost','Dragon','Dark','Steel','Fairy'];
function fail(message) { throw new LobbyError('merchant_invalid',message); }
function rollDrift(rarity, random = Math.random, excluded = []) {
    const definitions = catalogue.definitions.filter(d => d.values[rarity] != null && !excluded.includes(d.id));
    const definition = definitions[Math.min(definitions.length-1,Math.floor(random()*definitions.length))];
    return { uuid:randomUUID(), definitionId:definition.id, rarity, element:['DRF-001','DRF-014'].includes(definition.id)?types[Math.floor(random()*types.length)]:null };
}
function createStock(random = Math.random) {
    const offers=[];
    for (const rarity of ['common','rare','rare','epic','epic','legendary']) {
        const drift=rollDrift(rarity,random,offers.map(o=>o.drift.definitionId));
        offers.push({ id:randomUUID(), drift, price:prices[rarity] });
    }
    return { id:randomUUID(), offers };
}
function view(p) {
    p.run.merchant ||= createStock();
    return { id:p.run.merchant.id, offers:p.run.merchant.offers.map(o=>({ ...o, stock:p.merchantBought?.includes(o.id)?0:1 })) };
}
function validate(p) {
    if (!p.alive || p.inbattle || p.run.phase!=='exploration' || !isShopMap(p.currentmap)) fail('Retrouve le marchand dans une boutique pendant l’exploration.');
}
function buy(p, offerId) {
    validate(p); const offer=p.run.merchant?.offers.find(o=>o.id===offerId);
    if (!offer || p.merchantBought?.includes(offerId)) fail('Cette offre n’est plus disponible.');
    if (p.money<offer.price) fail('Monnaie insuffisante.');
    const drift={...offer.drift,uuid:randomUUID()};
    p.money-=offer.price; (p.merchantBought ||= []).push(offerId);p.drifts.push(drift);p.ready=false;
    report.increment(p,'moneySpent',offer.price);report.driftFound(p,drift,'merchant');
    report.event(p,'purchase',`Drift acheté chez le marchand · −${offer.price} ₽.`);
    return { success:true, drift };
}
function exchange(p, uuids, random = Math.random) {
    validate(p);
    if (!Array.isArray(uuids) || uuids.length!==3 || new Set(uuids).size!==3) fail('Choisis trois Drifts différents.');
    const selected=uuids.map(id=>p.drifts.find(d=>d.uuid===id));
    if (selected.some(d=>!d || p.equipped.includes(d.uuid))) fail('Seuls tes Drifts non équipés peuvent être échangés.');
    const floor=Math.min(...selected.map(d=>rarities.indexOf(d.rarity)));
    if (floor<0) fail('Rareté invalide.');
    const rarity=rarities[Math.min(4,floor+(random()<.2?1:0))],drift=rollDrift(rarity,random);
    p.drifts=p.drifts.filter(d=>!uuids.includes(d.uuid));p.drifts.push(drift);p.ready=false;
    for(const d of selected)report.driftRemoved(p,d,false,0);
    report.driftFound(p,drift,'exchange');report.event(p,'exchange','Trois Drifts échangés contre un nouveau Drift.');
    return { success:true, drift };
}
module.exports={createStock,view,buy,exchange,rollDrift};
