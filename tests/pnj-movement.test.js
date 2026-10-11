const test = require('node:test');
const assert = require('node:assert/strict');
const { tickRoaming, canRoamTo } = require('../server/game/world/pnjMovement');
const { getPnjsForMap, getPnjAtTile, isPnjBlockingTile, movePnj } = require('../server/game/world/pnjStore');

test('les déplacements PNJ restent locaux, synchronisés avec collisions et interactions', () => {
    const map = 'gen_ville5';
    const originals = getPnjsForMap(map);
    const deadlines = new Map();
    const players = { observer: { id: 'observer', currentmap: map, x: 25 * 32 + 16, y: 17 * 32 + 16 } };
    const moved = new Set();
    try {
        for (let i = 1; i <= 100; i++) {
            for (const changed of tickRoaming(players, i * 6000, deadlines, () => (i % 4) / 4)) assert.equal(changed, map);
            for (const pnj of getPnjsForMap(map)) {
                if (pnj.x !== pnj.anchorX || pnj.y !== pnj.anchorY) moved.add(pnj.name);
                assert.ok(Math.abs(pnj.x - pnj.anchorX) + Math.abs(pnj.y - pnj.anchorY) <= pnj.roamRadius);
                for (const y of [pnj.y, pnj.y - 1]) {
                    assert.equal(getPnjAtTile(map, pnj.x, y).name, pnj.name);
                    assert.equal(isPnjBlockingTile(map, pnj.x, y), true);
                }
            }
        }
        assert.ok(moved.size >= 2, 'la ville doit effectivement vivre');
        const target = getPnjsForMap(map)[0];
        const before = { x: target.x, y: target.y };
        players.observer.x = (target.x + 1) * 32 + 16;
        players.observer.y = target.y * 32 + 16;
        tickRoaming(players, 999999, deadlines, () => 0);
        const after = getPnjsForMap(map).find(p => p.name === target.name);
        assert.deepEqual({ x: after.x, y: after.y }, before, 'un PNJ approché reste disponible');
        assert.equal(tickRoaming({}, 9999999, deadlines).size, 0, 'pas de simulation sans joueur');
    } finally {
        for (const p of originals) movePnj(p.name, map, p.x, p.y);
    }
});

test('les patrouilles évitent murs, portes, personnages et sortie de leur rayon', () => {
    const p = { name: 'test', map: 'empty', anchorX: 4, anchorY: 4, roamRadius: 2 };
    const blank = () => Array.from({ length: 10 }, () => Array(10).fill(0));
    const terrain = { collision: blank(), interaction: blank(), change: blank() };
    assert.equal(canRoamTo(p, 5, 4, [], terrain), true);
    assert.equal(canRoamTo(p, 8, 4, [], terrain), false);
    terrain.collision[3][5] = 1;
    assert.equal(canRoamTo(p, 5, 4, [], terrain), false);
    terrain.collision[3][5] = 0;
    terrain.change[4][6] = 1;
    assert.equal(canRoamTo(p, 5, 4, [], terrain), false);
    terrain.change[4][6] = 0;
    assert.equal(canRoamTo(p, 5, 4, [{ x: 5 * 32, y: 4 * 32 }], terrain), false);
});
