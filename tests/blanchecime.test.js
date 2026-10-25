const test = require('node:test');
const assert = require('node:assert/strict');
const maps = require('../server/game/world/mapRepository');
const pnjs = require('../server/game/world/pnjStore');
const world = require('../data/game/nextMap.json').maps;

function reachable(map, start) {
    const c = maps.loadCollisionData(map), t = maps.changeMapData(map), q = [start], seen = new Set();
    for (let i = 0; i < q.length; i++) {
        const [x, y] = q[i], key = `${x}:${y}`;
        if (seen.has(key) || c[y]?.[x] !== 0 || pnjs.isPnjBlockingTile(map, x, y)) continue;
        seen.add(key);
        if (!t[y][x]) q.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    return seen;
}

test('Blanchecime connects all five Route 14 lanes and every authored door without blocked arrivals', () => {
    const config = world.find(m => m.mapName === 'ville5');
    assert(config); assert.deepEqual(config.wildpokemon, []); assert.equal(config.mapchange.length, 10);
    for (let x = 12; x <= 16; x++) {
        for (const [source, y, target, dy] of [['route14', 0, 'ville5', 18], ['ville5', 19, 'route14', 1]]) {
            const link = maps.getNextMap(source, x, y);
            assert.equal(link.nextMap, target);
            assert.deepEqual([Math.floor(link.nextX / 32), Math.floor(link.nextY / 32)], [x, dy]);
            assert.equal(link.blockedMessage, undefined);
        }
        const seen = reachable('ville5', [x, 18]);
        maps.changeMapData('ville5').forEach((row, y) => row.forEach((v, dx) => {
            if (v) { assert(seen.has(`${dx}:${y}`)); assert(maps.getNextMap('ville5', dx, y)); }
        }));
    }
    for (const [x, y, target, arrivalY] of [[4, 6, 'centre', 14], [22, 6, 'ville5_shop', 15], [13, 7, 'ville5_arene', 16], [3, 16, 'ville5_maison1', 16], [23, 16, 'ville5_maison2', 16]]) {
        const link = maps.getNextMap('ville5', x, y);
        assert.equal(link.nextMap, target);
        assert.deepEqual([Math.floor(link.nextX / 32), Math.floor(link.nextY / 32)], [13, arrivalY]);
        assert.equal(maps.loadCollisionData(target)[arrivalY][13], 0);
        assert.equal(maps.changeMapData(target)[arrivalY][13], 0);
        assert(!pnjs.isPnjBlockingTile(target, 13, arrivalY));
        if (target !== 'centre') {
            const exitY = target.endsWith('_shop') ? 16 : 17;
            assert(reachable(target, [13, arrivalY]).has(`13:${exitY}`));
            const back = maps.getNextMap(target, 13, exitY);
            assert.equal(back.nextMap, 'ville5');
            assert.deepEqual([Math.floor(back.nextX / 32), Math.floor(back.nextY / 32)], [x, y + 1]);
        }
    }
});

test('Blanchecime has Center provenance, PC, a real shop and accessible NPCs; arena introduces no new battle or reward', () => {
    const center = require('../server/game/world/pokemonCenterTravel');
    const origin = { map: 'ville5', x: 144, y: 240 };
    assert.deepEqual(center.getPokemonCenterEntryReturn('ville5', 4, 6, origin), origin);
    assert.deepEqual(center.getPokemonCenterExit(origin), origin);
    assert(require('../server/game/world/shopCatalog').isShopMap('ville5_shop'));
    assert.equal(require('../server/game/world/pokemonComputer').devicesForMap('centre').devices[0].kind, 'pc');
    for (const map of ['ville5', 'ville5_shop', 'ville5_arene', 'ville5_maison1', 'ville5_maison2']) {
        const seen = reachable(map, [13, map === 'ville5' ? 18 : map.endsWith('_shop') ? 15 : 16]);
        assert.equal(pnjs.getPnjsForMap(map).length, 1);
        for (const p of pnjs.getPnjsForMap(map)) {
            assert.equal(maps.loadCollisionData(map)[p.y][p.x], 0);
            assert.equal(maps.loadCollisionData(map)[p.y - 1][p.x], 0);
            assert([[1, 0], [-1, 0], [0, 1], [0, -2]].some(([dx, dy]) => seen.has(`${p.x + dx}:${p.y + dy}`)), p.name);
        }
    }
    const interactions = require('../server/game/world/interactionRepository');
    assert.equal(interactions.getEndSentenceInformation('champion_7p'), 'battle');
    assert.equal(require('../server/game/world/mapWeather').getMapWeather('ville5').kind, 'snow');
    for (const map of ['route13', 'route14']) assert.equal(require('../server/game/world/mapWeather').getMapWeather(map).ambience.snow, 3);
});
