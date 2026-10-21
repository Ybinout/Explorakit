const items = require('../../../data/game/items.json').items;
const CHANCE = 1 / 25;
const GROUP_WEIGHTS = Object.freeze({berries:55, vitamins:25, equipment:15, key:5});
const uniqueKeys = items.filter(i => i.unique).map(i => i.key);
const byKey = new Map(items.map(i => [i.key,i]));
function pick(entries, weight, random) {
    let roll = random() * entries.reduce((n,e) => n + weight(e), 0);
    return entries.find(e => (roll -= weight(e)) < 0) || entries.at(-1);
}
function select(claimed = new Set(), random = Math.random) {
    const eligible = items.filter(i => i.wildLoot && (!i.unique || !claimed.has(i.key)));
    const groups = Object.keys(GROUP_WEIGHTS).filter(g => eligible.some(i => i.wildLoot.group === g));
    const group = pick(groups, g => GROUP_WEIGHTS[g], random);
    return pick(eligible.filter(i => i.wildLoot.group === group), i => i.wildLoot.weight, random);
}
function awardExpedition(player, random = Math.random, bonus = 1) {
    if (random() >= Math.min(1,CHANCE*bonus)) return null;
    player.discoveredItems ||= new Set();
    // Old checkpoints may predate the ledger. Include held and stored items,
    // then retain the receipt even after the item leaves the bag/team.
    for (const key of uniqueKeys) if (player.items[key] > 0) player.discoveredItems.add(key);
    for (const p of [...(player.equipe?.pokemons || []),...(player.storage || []).map(e => e.pokemon)])
        if (byKey.get(p?.heldItem)?.unique) player.discoveredItems.add(p.heldItem);
    const item = select(player.discoveredItems, random);
    if (!item) return null;
    if (item.unique) player.discoveredItems.add(item.key);
    player.items[item.key] = (player.items[item.key] || 0) + 1;
    return item;
}
module.exports = {CHANCE, GROUP_WEIGHTS, uniqueKeys, select, awardExpedition};
