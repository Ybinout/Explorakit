const test = require('node:test'), assert = require('node:assert/strict');
const maps = require('../server/game/world/mapRepository'), store = require('../server/game/world/pnjStore');
const shops = require('../server/game/world/shopCatalog'), crafting = require('../server/game/corruption/heldCrafting');
const engine = require('../server/game/battle/battleEngine'), factory = require('../server/game/drift/pokemonFactory');
test('The Safari market has its normal collision source, seller and shop catalogue; the scientist occupies a separate house', () => {
    assert.equal(maps.resolveMapSourceName('safari_shop'), 'gen_shop1');
    assert.deepEqual(maps.loadCollisionData('safari_shop'), maps.loadCollisionData('gen_shop1'));
    assert(shops.isShopMap('safari_shop')); assert(shops.getShopCatalog({mapName: 'safari_shop'}).some(i => i.key === 'pokeball'));
    assert(!shops.isShopMap('safari_lab')); assert.deepEqual(shops.getShopCatalog({mapName: 'safari_lab'}), []);
    assert.deepEqual(store.getPnjsForMap('safari_shop').map(p => p.name), ['safari_seller']);
    assert.deepEqual(store.getPnjsForMap('safari_lab').map(p => p.name), ['safari_corruption_scientist']);
});
test('Both painted doors lead to their own room and every room exit returns below its own exterior door', () => {
    for (const [outer, x, y, room, exitY] of [['safari8', 20, 12, 'safari_shop', 16], ['safari9', 13, 5, 'safari_lab', 19]]) {
        assert.equal(maps.loadCollisionData(outer)[y][x], 0); assert(maps.changeMapData(outer)[y][x]);
        const enter = maps.getNextMap(outer, x, y), ax = Math.floor(enter.nextX / 32), ay = Math.floor(enter.nextY / 32);
        assert.equal(enter.nextMap, room); assert.equal(maps.loadCollisionData(room)[ay][ax], 0); assert.equal(maps.changeMapData(room)[ay][ax], 0);
        for (const ex of [13, 14]) {
            assert(maps.changeMapData(room)[exitY][ex]); const leave = maps.getNextMap(room, ex, exitY);
            assert.equal(leave.nextMap, outer); assert.equal(Math.floor(leave.nextX / 32), x); assert.equal(Math.floor(leave.nextY / 32), y + 1);
            assert.equal(maps.loadCollisionData(outer)[y + 1][x], 0); assert.equal(maps.changeMapData(outer)[y + 1][x], 0);
        }
    }
});
test('Crafting proximity recognizes the new laboratory only, so old market coordinates cannot grant a remote craft', () => {
    const p = {x: 18 * 32 + 16, y: 10 * 32 + 16, currentmap: 'safari_lab'};
    assert(crafting.nearby(p)); assert(!crafting.nearby({...p, currentmap: 'safari_shop'})); assert(!crafting.nearby({...p, currentmap: 'safari9'}));
    assert(!crafting.nearby({...p, x: 4 * 32 + 16}));
});
test('Old laboratory positions saved in the market recover onto its normal accessible floor', () => {
    const grid = maps.loadCollisionData('safari_shop'), {nearestSafePosition} = require('../server/game/world/safePosition');
    for (const [x, y] of [[13, 18], [18, 9], [4, 12], [13, 17]]) {
        const p = nearestSafePosition(x * 32 + 16, y * 32 + 16, grid, 'safari_shop', {allowTransition: false});
        const tx = Math.floor(p.x / 32), ty = Math.floor(p.y / 32); assert.equal(grid[ty][tx], 0);
        assert(!maps.changeMapData('safari_shop')[ty][tx]); assert(!store.isPnjBlockingTile('safari_shop', tx, ty));
    }
});
function holder(ability = null) {
    const p = factory.create(9, 50, true); p.passiveAbility = ability; p.heldItem = 'corrupted_leftovers';
    p.corruption = {version: 1, revision: 1, permanent: true, modules: {}}; p.maxHp = 201; p.currentHp = 1; return p;
}
function round(p, state) {const q = factory.create(9, 50, true); q.passiveAbility = null; engine.processEndOfRound(p, q, state.sides.player, state.sides.enemy, state);}
test('Corrupted Restes heal floor(8% max HP), respect full HP and still knock out a Magic Guard holder on the third turn', () => {
    const p = holder('Magic Guard'), state = engine.createBattleState(); round(p, state); assert.equal(p.currentHp, 17);
    p.currentHp = p.maxHp; round(p, state); assert.equal(p.currentHp, 201); round(p, state); assert.equal(p.currentHp, 0);
    assert.equal(p.heldItem, 'corrupted_leftovers');
});
test('Suppression does not pause consecutive turns, but the item cannot heal or knock out while disabled', () => {
    const p = holder('Klutz'), state = engine.createBattleState();
    for (let n = 0; n < 3; n++) {round(p, state); assert.equal(p.currentHp, 1);}
    p.passiveAbility = null; round(p, state); assert.equal(p.currentHp, 0);
});
test('An actual withdrawal resets the corrupted Restes timer; ordinary Restes retain their classic healing', () => {
    const p = holder(), state = engine.createBattleState(); round(p, state); round(p, state);
    require('../server/game/battle/battleTeam').clearSwitchOutState(p); round(p, state); assert.equal(p.currentHp, 49);
    const q = holder(); delete q.corruption; q.heldItem = 'leftovers';
    for (let n = 0; n < 4; n++) round(q, state); assert.equal(q.currentHp, 1 + 4 * Math.floor(q.maxHp / 16));
});
