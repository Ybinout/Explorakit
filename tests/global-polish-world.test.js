const test = require('node:test'),
    assert = require('node:assert/strict'),
    terrain = require('../server/game/world/mapRepository'),
    safari = require('../server/game/world/safari'),
    signs = require('../data/game/safari_signs.json'),
    room = require('../server/game/draft/room');
test('fifteen Bourg signs are on clear tiles with a navigable path on both sides and correct regional direction', () => {
    const fake = {
            getPnjsForMap: () => [],
            getPnjAtTile: () => null,
            isPnjBlockingTile: () => false,
        },
        store = safari.scopedStore(fake),
        maps = require('../data/game/nextMap.json').maps;
    const distance = (map) => {
        const i = Number(map.slice(6)) - 1;
        return Math.abs((i % 5) - 2) + Math.abs(Math.floor(i / 5) - 1);
    };
    for (const s of signs) {
        const g = terrain.loadCollisionData(s.map),
            ch = terrain.changeMapData(s.map);
        assert.equal(g[s.y][s.x], 0, s.map);
        assert.equal(g[s.y - 1][s.x], 0, s.map + ' above');
        assert.equal(ch[s.y][s.x], 0);
        assert(store.isPnjBlockingTile(s.map, s.x, s.y));
        assert(store.getPnjsForMap(s.map).some((a) => a.safariSign));
        const delta = { right: 1, left: -1, up: -5, down: 5 }[s.direction],
            next = 'safari' + (Number(s.map.slice(6)) + delta);
        if (s.map !== 'safari8') {
            assert(
                distance(next) < distance(s.map),
                s.map + ' points towards town'
            );
            assert(
                maps
                    .find((m) => m.mapName === s.map)
                    .mapchange.some((c) => c.goto === next),
                s.map + ' connected'
            );
        }
        // Removing its two pole cells cannot cut the clear component into isolated paths.
        const cells = [];
        for (let y = 0; y < 20; y++)
            for (let x = 0; x < 28; x++)
                if (
                    g[y][x] === 0 &&
                    !(x === s.x && (y === s.y || y === s.y - 1))
                )
                    cells.push([x, y]);
        const seen = new Set(),
            queue = [cells[0]];
        while (queue.length) {
            const [x, y] = queue.pop(),
                key = x + ',' + y;
            if (
                seen.has(key) ||
                g[y]?.[x] !== 0 ||
                (x === s.x && (y === s.y || y === s.y - 1))
            )
                continue;
            seen.add(key);
            for (const [dx, dy] of [
                [1, 0],
                [-1, 0],
                [0, 1],
                [0, -1],
            ])
                queue.push([x + dx, y + dy]);
        }
        assert(
            seen.has(s.x - 1 + ',' + s.y) && seen.has(s.x + 1 + ',' + s.y),
            s.map + ' sign remains approachable'
        );
    }
    assert.equal(new Set(signs.map((s) => s.map)).size, 15);
});
test('smaller Draft table collision and interaction follow the compact artwork, entry aisle remains clear', () => {
    const g = terrain.loadCollisionData(room.MAP);
    for (const [x, y] of room.tableCells) assert(g[y][x]);
    assert.equal(g[13][13], 0);
    assert(room.target({ currentmap: room.MAP, x: 432, y: 432 }));
    assert.equal(g[14][10], 0);
    assert.equal(room.target({ currentmap: room.MAP, x: 80, y: 432 }), null);
});
