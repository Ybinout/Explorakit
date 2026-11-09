const test = require('node:test'),
    assert = require('node:assert/strict'),
    slots = require('../server/game/casino/slots'),
    draft = require('../server/game/draft/content'),
    format = require('../server/game/draft/format');
function rngSequence(values) {
    let i = 0;
    return () => values[Math.min(i++, values.length - 1)];
}
test('new Draft format freezes the requested category odds, third Rift pick and independent sub-pools', () => {
    assert.deepEqual(format.current().weights, {
        pokemon: 35,
        move: 25,
        item: 15,
        nature: 10,
        iv: 10,
        ability: 5,
    });
    assert.equal(format.current().riftPicks, 3);
    assert.equal(format.current().riftPackSize, 4);
    assert.equal(draft.config.maximumTeamRifts, 2);
    for (const [roll, key] of [
        [0, 'pokemon'],
        [0.349999, 'pokemon'],
        [0.35, 'move'],
        [0.59999, 'move'],
        [0.6, 'item'],
        [0.74999, 'item'],
        [0.75, 'nature'],
        [0.85, 'iv'],
        [0.95, 'ability'],
    ])
        assert.equal(draft.createCard(100, () => roll).kind, key);
    for (const [roll, pool] of [
        [0, 'damage'],
        [0.749999, 'damage'],
        [0.75, 'status'],
        [0.99999, 'status'],
    ]) {
        const c = draft.createCard(100, rngSequence([0.4, roll, 0]));
        assert(draft.movePools[pool].includes(c.move));
    }
    for (const [roll, berry] of [
        [0, true],
        [0.199999, true],
        [0.2, false],
        [0.99999, false],
    ]) {
        const c = draft.createCard(100, rngSequence([0.65, roll, 0]));
        assert.equal(c.item.endsWith('_berry'), berry);
    }
});
test('only useful battle items enter new packs, while already picked legacy cards still render and work', () => {
    for (const key of [
        'survival_kit',
        'everstone',
        'exp_share',
        'macho_brace',
        'rift_talisman',
        'eviolite',
    ]) {
        assert(!draft.items.some((i) => i.key === key), key);
        assert(draft.view({ id: draft.uuid(), kind: 'item', item: key }).name);
    }
    assert(draft.items.some((i) => i.key === 'life_orb'));
    assert(draft.itemPools.berries.length > 0);
    assert(draft.itemPools.other.length > 0);
    const old = {
        version: 2,
        riftPicks: 2,
        weights: {
            pokemon: 35,
            move: 20,
            item: 20,
            nature: 10,
            iv: 10,
            ability: 5,
        },
    };
    assert.equal(format.forRun({ phase: 'draft', draftFormat: old }), old);
    assert.equal(
        draft.createCard(100, rngSequence([0.6, 0]), false, old.weights, old)
            .item,
        'everstone'
    );
});
test('slot probability boundaries, exact matching symbols, 90% RTP and inclusive bet limits', () => {
    const cases = [
        [0, 'none'],
        [504999, 'none'],
        [505000, 'pair'],
        [724999, 'pair'],
        [725000, 'cherry'],
        [874999, 'cherry'],
        [875000, 'star'],
        [954999, 'star'],
        [955000, 'bell'],
        [994999, 'bell'],
        [995000, 'seven'],
        [999999, 'seven'],
    ];
    for (const [roll, kind] of cases) {
        const d = slots.draw((n) => (n === 1000000 ? roll : 0));
        assert.equal(d.kind, kind);
        const distinct = new Set(d.symbols);
        assert.equal(
            distinct.size,
            kind === 'none' ? 3 : kind === 'pair' ? 2 : 1
        );
        if (!['none', 'pair'].includes(kind))
            assert.deepEqual(d.symbols, [kind, kind, kind]);
    }
    const expected = [0, 5000, 20000, 30000, 50000, 100000];
    slots.config.results.forEach((r, i) =>
        assert.equal(slots.reward(10000, r.kind), expected[i])
    );
    assert.equal(slots.reward(101, 'pair'), 50);
    assert.equal(
        slots.config.results.reduce((n, r) => n + r.weight, 0),
        1000000
    );
    assert.equal(
        slots.config.results.reduce(
            (n, r) => n + (r.weight * r.numerator) / r.denominator,
            0
        ) / 1000000,
        0.9
    );
    for (const n of [0, 99, -1, Infinity, 1000001, 100.5, '1000'])
        assert.throws(() => slots.amount(n));
    assert.equal(slots.amount(100), 100);
    assert.equal(slots.amount(1000000), 1000000);
});
test('exactly two approachable left-wall machines; hitboxes leave casino doors, table and counter untouched', () => {
    const maps = require('../server/game/world/mapRepository'),
        rules = require('../server/game/whitepeak/rules'),
        g = maps.loadCollisionData(slots.config.map);
    assert.equal(slots.config.machines.length, 2);
    const occupied = new Set();
    for (const m of slots.config.machines) {
        for (let y = m.y; y < m.y + m.h; y++)
            for (let x = m.x; x < m.x + m.w; x++) {
                assert.equal(g[y][x], 0);
                assert(slots.blocked(slots.config.map, x, y));
                assert(!slots.blocked('ville5_maison1', x, y));
                assert(!occupied.has(x + ',' + y));
                occupied.add(x + ',' + y);
            }
        const p = {
            currentmap: slots.config.map,
            x: (m.x + m.w) * 32 + 16,
            y: m.y * 32 + 16,
        };
        assert.equal(slots.at(p).id, m.id);
        assert(!rules.atRouletteTable(p));
        assert(!rules.atCasinoCounter(p));
    }
    assert(!slots.at({ currentmap: slots.config.map, x: 432, y: 560 }));
    assert(!slots.blocked(slots.config.map, 13, 17));
    assert(
        rules.atCasinoCounter({
            currentmap: slots.config.map,
            x: 4 * 32 + 16,
            y: 6 * 32 + 16,
        })
    );
    assert(
        rules.atRouletteTable({
            currentmap: slots.config.map,
            x: 11 * 32 + 16,
            y: 11 * 32 + 16,
        })
    );
});
