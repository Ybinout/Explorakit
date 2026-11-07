const test = require('node:test'), assert = require('node:assert/strict');
const kit = require('../server/game/items/darkSurvivalKit'), factory = require('../server/game/drift/pokemonFactory');
const policy = require('../server/game/items/heldItemPolicy'), engine = require('../server/game/battle/battleEngine');
function mon(id = 7) {const p = factory.create(id, 10, true); p.passiveAbility = null; p.heldItem = kit.KEY; return p;}
test('The kit is held emergency equipment, exclusive to the guide, available to both ordinary and corrupted Pokémon', () => {
    const item = require('../data/game/items.json').items.find(i => i.key === kit.KEY), p = mon();
    assert.equal(item.category, 'held'); assert(item.darkSurvival); assert.equal(kit.PRICE, 50000);
    assert(!item.wildLoot); assert.equal(item.buy_price, 0); assert(policy.canHold(p, kit.KEY));
    p.corruption = {version: 1, permanent: true, modules: {}}; assert(policy.canHold(p, kit.KEY)); assert(!policy.canHold(p, 'leftovers'));
    const shop = require('../server/game/world/shopCatalog');
    for (const mapName of shop.SHOP_MAPS) assert(!shop.getShopCatalog({mapName, expedition: true}).some(i => i.key === kit.KEY));
});
test('A kit consumes exactly once at KO, never revives, and cannot be recovered as held loot', () => {
    const p = mon(); assert(!kit.protect(p)); assert.equal(p.heldItem, kit.KEY);
    p.currentHp = 0; p.__darkLostItem = kit.KEY; p.__heldItemBeforeExchange = kit.KEY;
    assert(kit.protect(p)); assert.equal(p.currentHp, 0); assert.equal(p.heldItem, null); assert(p.__darkSurvivalProtected);
    assert(!p.__darkLostItem); assert(!p.__heldItemBeforeExchange); assert(!kit.protect(p));
    const codec = require('../server/game/drift/checkpointCodec'), restored = codec.decode(codec.encode(p));
    assert.equal(restored.heldItem, null); assert.equal(restored.currentHp, 0); assert(restored.__darkSurvivalProtected);
});
test('The normal battle engine does not consume a kit on ordinary KO or allow stealing this protection', () => {
    const p = mon(), q = mon(94); q.heldItem = null;
    engine.useattack('Knock Off', q, p, {battleState: engine.createBattleState()}); assert.equal(p.heldItem, kit.KEY);
    p.currentHp = 0; engine.processEndOfRound(p, q, null, null, engine.createBattleState()); assert.equal(p.heldItem, kit.KEY);
});
test('Healing a protected companion clears the temporary protection flags and never recreates a kit', () => {
    const p = mon(); p.currentHp = 0; kit.protect(p); p.__darkSurvivalSettled = true;
    require('../server/game/world/playerRecovery').healTeam({pokemons: [p]});
    assert.equal(p.currentHp, p.maxHp); assert.equal(p.heldItem, null); assert(!p.__darkSurvivalProtected); assert(!p.__darkSurvivalSettled);
});
test('Guide purchases reject remote locations, wrong displayed prices and combat before reaching the repository', async () => {
    const commands = {}, p = {currentmap: 'start', x: 208, y: 368};
    require('../server/realtime/handlers/darkContinentHandlers').createHandlers({socket: {emit() {}}, account: {on: (n, f) => commands[n] = f},
        getPlayer: () => p, getState: () => ({}), setState() {}, refreshActors() {}, canUse: () => true, travel() {}, closeFishing() {}});
    const send = async data => {let r; await commands['dark:buyKit'](data, v => r = v); return r;};
    assert(!(await send({price: 50000})).success); p.currentmap = 'jungle1'; p.x = 16;
    assert(!(await send({price: 50000})).success); p.x = 208;
    assert(!(await send({price: 1})).success); p.inbattle = true; assert(!(await send({price: 50000})).success);
});
