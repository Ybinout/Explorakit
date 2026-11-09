const test = require('node:test'),
    assert = require('node:assert/strict'),
    { randomUUID } = require('node:crypto');
const rules = require('../server/game/housing/rules'),
    entries = require('../server/game/housing/entries'),
    maps = require('../server/game/world/mapRepository');
const base = (key) => ({
    model: key,
    placements: [],
    stairs: { up: null, down: null },
});
test('six increasing models match every collision cell, with protected exits and connected empty floors', () => {
    let previous = 0,
        price = 0;
    for (const m of rules.models.values()) {
        const f = base(m.key),
            h = { floors: [f], inventory: {} };
        assert.deepEqual(rules.validateFloor(h, 0, f), f);
        const grid = maps.loadCollisionData('housing_' + m.key);
        let area = 0;
        const d = rules.door(m);
        for (let y = 0; y < 20; y++)
            for (let x = 0; x < 28; x++) {
                const free = rules.inside(m, x, y);
                area += free;
                assert.equal(
                    grid[y][x] === 0,
                    free || (y === d.y && (x === d.x || x === d.x - 1))
                );
            }
        assert(area > previous);
        assert(m.price > price);
        previous = area;
        price = m.price;
        assert.equal(rules.blocked(h, 0, d.x, d.y), false);
        assert.equal(rules.blocked({ floors: [f, f] }, 1, d.x, d.y), true);
    }
});
test('all 216 combinations of three floors have distinct accessible stairways and valid landings', () => {
    for (const a of rules.models.keys())
        for (const b of rules.models.keys())
            for (const c of rules.models.keys()) {
                const floors = [base(a), base(b), base(c)];
                floors[0].stairs.up = rules.defaultStair(floors[0]);
                floors[1].stairs.down = rules.defaultStair(floors[1]);
                floors[1].stairs.up = rules.defaultStair(floors[1]);
                floors[2].stairs.down = rules.defaultStair(floors[2]);
                const h = { floors, inventory: {} };
                floors.forEach((f, i) =>
                    assert.doesNotThrow(
                        () => rules.validateFloor(h, i, f),
                        a + '/' + b + '/' + c
                    )
                );
            }
});
test('placement rejects missing stock, duplicates across floors, walls, stair landings, protected paths and >10 furniture', () => {
    const f = base('nid'),
        h = { floors: [f], inventory: { chair: 20 } };
    const p = { id: randomUUID(), key: 'chair', x: 10, y: 10 };
    f.placements = [p];
    assert.doesNotThrow(() => rules.validateFloor(h, 0, f));
    assert.throws(
        () => rules.validateFloor({ ...h, inventory: {} }, 0, f),
        /assez/
    );
    assert.throws(
        () =>
            rules.validateFloor(h, 0, {
                ...f,
                placements: [p, { ...p, x: 11 }],
            }),
        /dupliqué/
    );
    assert.throws(
        () => rules.validateFloor(h, 0, { ...f, placements: [{ ...p, x: 0 }] }),
        /mur/
    );
    const d = rules.door(rules.model('nid'));
    assert.throws(
        () =>
            rules.validateFloor(h, 0, {
                ...f,
                placements: [{ ...p, x: d.x, y: d.y - 1 }],
            }),
        /porte/
    );
    const barrier = Array.from({ length: 10 }, (_, i) => ({
        ...p,
        id: randomUUID(),
        x: 9 + i,
        y: 12,
    }));
    assert.throws(
        () => rules.validateFloor(h, 0, { ...f, placements: barrier }),
        /passage/
    );
    assert.throws(
        () =>
            rules.validateFloor(h, 0, {
                ...f,
                placements: Array.from({ length: 11 }, () => ({
                    ...p,
                    id: randomUUID(),
                })),
            }),
        /Dix/
    );
    const second = base('nid');
    second.stairs.down = rules.defaultStair(second);
    f.stairs.up = rules.defaultStair({ ...f, placements: [] });
    const pair = { ...h, floors: [f, second] };
    second.placements = [
        { ...p, x: second.stairs.down.x, y: second.stairs.down.y + 2 },
    ];
    assert.throws(() => rules.validateFloor(pair, 1, second), /pied|dupliqué/);
    second.placements = [{ ...p, x: 17, y: 10 }];
    assert.throws(() => rules.validateFloor(pair, 1, second), /dupliqué/);
    assert.throws(() => rules.validateFloor(h, NaN, f), /Étage/);
    assert.throws(() => rules.validateFloor(h, 0, null), /Étage/);
});
test('23 exterior doors have clear return tiles, never overlap an existing building entrance, and preserve story houses', () => {
    const next = require('../data/game/nextMap.json'),
        seen = new Set();
    assert.equal(entries.entries.length, 23);
    for (const e of entries.entries) {
        assert(!seen.has(e.key));
        seen.add(e.key);
        const d = entries.outside(e),
            grid = maps.loadCollisionData(e.map);
        assert.equal(grid[e.y + 1][e.x], 0, JSON.stringify(e));
        assert.equal(
            entries.near({ currentmap: e.map, x: d.x, y: d.y }).key,
            e.key
        );
        assert.equal(
            entries.near({ currentmap: e.map, x: d.x, y: d.y + 32 }),
            null
        );
        assert(
            !(next.maps.find((m) => m.mapName === e.map)?.mapchange || []).some(
                (p) => p.valX === e.x && p.valY === e.y
            ),
            e.key
        );
    }
    for (const map of [
        'start',
        'route2',
        'ville4',
        'ville5',
        'safari8',
        'safari9',
    ])
        assert(!entries.entries.some((e) => e.map === map));
});
test('world rooms isolate owners and floors, including reconnects without a restored visit', () => {
    const { worldRoom, sameWorld } = require('../server/realtime/worldRooms');
    const a = {
            id: 'a',
            currentmap: 'housing_nid',
            housingOwnerId: 1,
            housingFloor: 0,
        },
        b = { ...a, id: 'b', housingOwnerId: 2 };
    assert(!sameWorld(a, b));
    assert(!sameWorld(a, { ...a, housingFloor: 1 }));
    assert(sameWorld(a, { ...a, id: 'guest' }));
    assert.notEqual(
        worldRoom(a.currentmap, { id: 'a' }),
        worldRoom(a.currentmap, { id: 'b' })
    );
});
test('manager caches only occupied houses; regular walking needs no storage call and last departure releases the layout', async () => {
    let reads = 0;
    const store = {
            read: async (id) => {
                reads++;
                return {
                    ownerId: id,
                    entryKey: 'unused',
                    floors: [base('nid')],
                    inventory: {},
                    revision: 1,
                };
            },
        },
        m = require('../server/realtime/housing').createHousingManager({
            store,
            tickMs: 0,
        });
    const p = { currentmap: 'housing_nid', x: 400, y: 400 },
        c = {
            id: 1,
            supported: true,
            socket: { connected: true, emit() {} },
            getPlayer: () => p,
            canUse: () => true,
        };
    await m.attach(c, null);
    assert.equal(m.cacheStats().occupiedHouses, 0);
    // A database with any number of unoccupied profiles is never enumerated by the manager.
    const home = {
        ownerId: 1,
        ownerName: 'Test',
        entryKey: entries.entries[0].key,
        floors: [base('nid')],
        inventory: {},
        revision: 1,
    };
    await m.attach(c, { home, visit: { ownerId: 1, floor: 0 } });
    for (let n = 0; n < 1000; n++) assert.equal(await m.step(1), false);
    assert.equal(reads, 0);
    assert.equal(m.cacheStats().occupiedHouses, 1);
    m.detach(c);
    assert.equal(m.cacheStats().occupiedHouses, 0);
    m.stop();
});
