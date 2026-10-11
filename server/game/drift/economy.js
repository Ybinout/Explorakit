const { randomUUID } = require('node:crypto');
const catalogue = require('../../../data/game/drifts.json');
const { value, heal, attach, detach } = require('./driftEffects');
const { isShopMap, getShopCatalog } = require('../world/shopCatalog');
const { items: baseItems } = require('../../../data/game/items.json');
const { LobbyError } = require('./lobbyStore');
const report = require('./runReport');
const SLOT_LIMIT = 5;
const prices = { common: 50, rare: 120, epic: 300, legendary: 800, mythic: 2000 };
const types = ['Normal','Fire','Water','Electric','Grass','Ice','Fighting','Poison','Ground','Flying','Psychic','Bug','Rock','Ghost','Dragon','Dark','Steel','Fairy'];
const potions = [{ key: 'drift_potion', name: 'Potion', category: 'heal', price: 100, amount: 20, description: 'Soigne 20 PV hors combat, uniquement un survivant.' },
    { key: 'drift_super_potion', name: 'Super Potion', category: 'heal', price: 300, amount: 60, description: 'Soigne 60 PV hors combat.' }];
const fail = message => { throw new LobbyError('drift_invalid', message); };
function bag(p) { return [...baseItems, ...potions].filter(i => p.items[i.key] > 0).map(i => ({ ...i, quantity: p.items[i.key] })); }
function shop(p) { return { success: true, catalog: [...getShopCatalog(), ...potions], items: bag(p), money: p.money }; }
function requireMutable(p) { if (!p.alive || p.inbattle || p.run.phase === 'results') fail('Action indisponible maintenant.'); }
function equip(p, uuid, enabled) {
    requireMutable(p);
    if (typeof enabled !== 'boolean') fail('Choix d’équipement invalide.');
    const d = p.drifts.find(d => d.uuid === uuid); if (!d) fail('Drift introuvable.');
    if (!enabled) { p.equipped = p.equipped.filter(id => id !== uuid); p.ready = false; report.syncDrifts(p); return; }
    if (p.equipped.includes(uuid)) return;
    if (p.equipped.length >= SLOT_LIMIT) fail('Les cinq emplacements sont occupés.');
    if (p.drifts.some(other => other.definitionId === d.definitionId && p.equipped.includes(other.uuid))) fail('Ce Drift est déjà équipé dans une autre rareté.');
    p.equipped.push(uuid); p.ready = false;
    report.syncDrifts(p);
}
function remove(p, uuid, sell = false) {
    requireMutable(p);
    if (p.equipped.includes(uuid)) fail('Retire ce Drift avant de le supprimer ou le vendre.');
    if (sell && (p.run.phase !== 'exploration' || !isShopMap(p.currentmap))) fail('La revente se fait dans une boutique, pendant l’exploration.');
    const index = p.drifts.findIndex(d => d.uuid === uuid); if (index < 0) fail('Drift introuvable.');
    const earned = sell ? Math.floor(prices[p.drifts[index].rarity] * (1 + value(p, 53) / 100)) : 0;
    if (sell) p.money += earned;
    report.driftRemoved(p,p.drifts[index],sell,earned);
    p.drifts.splice(index, 1); p.ready = false;
}
function buy(p, key, quantity) {
    requireMutable(p);
    if (p.run.phase !== 'exploration' || !isShopMap(p.currentmap)) fail('Rejoins une boutique.');
    const item = shop(p).catalog.find(i => i.key === key);
    if (!item || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) fail('Achat invalide.');
    const cost = item.price * quantity; if (p.money < cost) fail('Monnaie insuffisante.');
    p.money -= cost; p.items[key] = (p.items[key] || 0) + quantity;
    report.increment(p,'moneySpent',cost);report.event(p,'purchase',`${quantity} × ${item.name} acheté${quantity>1?'s':''} · −${cost} ₽.`);
    return { ...shop(p), progression: { money: p.money } };
}
function usePotion(p, key, uuid, random = Math.random) {
    requireMutable(p); if (p.run.phase !== 'exploration') fail('Soins automatiques entre les rounds.');
    const item = potions.find(i => i.key === key), pokemon = p.equipe.pokemons.find(a => a.uuid === uuid);
    if (!item || !pokemon || pokemon.currentHp <= 0 || !(p.items[key] > 0) || pokemon.currentHp >= pokemon.maxHp) fail('Ce soin est inutilisable.');
    attach(p.equipe.pokemons, p, false, random);
    try { heal(pokemon, item.amount); } finally { detach(p.equipe.pokemons); }
    if (random() >= value(p, 52) / 100) p.items[key]--;
    report.increment(p,'potionsUsed');report.event(p,'heal',`${item.name} utilisée sur ${pokemon.truename || pokemon.name}.`);
}
function drop(p, source, random = Math.random) {
    const chance = { wild: .15, capture: .15, trainer: .5, arena: 1 }[source] || 0;
    const loot = [];
    if (random() < Math.min(1, chance * (1 + value(p, 44) / 100))) {
        const weights = source === 'arena' ? [1500, 3000, 3000, 2000, 500] : source === 'trainer' ? [3500, 3300, 2000, 1000, 200] : catalogue.rarities.map(r => r.weight);
        let roll = random() * 10000, index = 0;
        for (; index < 4; index++) { roll -= weights[index]; if (roll < 0) break; }
        const rarity = catalogue.rarities[index].key;
        const candidates = catalogue.definitions.filter(d => d.values[rarity] !== null);
        const definition = candidates[Math.floor(random() * candidates.length)];
        const drift = { uuid: randomUUID(), definitionId: definition.id, rarity, element: ['DRF-001', 'DRF-014'].includes(definition.id) ? types[Math.floor(random() * types.length)] : null };
        p.drifts.push(drift); loot.push(definition.name);
        report.driftFound(p,drift,source);
    }
    if (source !== 'capture' && random() < Math.min(1, .2 * (1 + value(p, 45) / 100))) {
        const key = random() < .5 ? 'pokeball' : 'drift_potion'; p.items[key] = (p.items[key] || 0) + 1; loot.push(key === 'pokeball' ? 'Poké Ball' : 'Potion');
        report.event(p,'item',`Objet trouvé : ${key==='pokeball'?'Poké Ball':'Potion'}.`);
    }
    return loot;
}
module.exports = { SLOT_LIMIT, prices, bag, shop, equip, remove, buy, usePotion, drop, requireMutable, fail };
