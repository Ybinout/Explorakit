const test = require('node:test'),
    assert = require('node:assert/strict'),
    content = require('../server/game/draft/content'),
    compat = require('../server/game/draft/compatibility'),
    prep = require('../server/game/draft/preparation'),
    { createDraftManager } = require('../server/realtime/draftManager');
function card(id) {
    const p = content.pokemon(id, 50, () => 0.5);
    p.abilities = ['Tackle'];
    return { id: content.uuid(), kind: 'pokemon', pokemon: p };
}
test('attack hints distinguish legal, incompatible and already-known moves using the actual complete movepool', () => {
    const a = card(6),
        b = card(9),
        c = card(157);
    c.pokemon.abilities = ['Flamethrower'];
    const hints = compat.forMove(
        'Flamethrower',
        [a, b, c].map((c) => ({ cardId: c.id, pokemon: c.pokemon }))
    );
    assert.deepEqual(
        hints.map((p) => [p.compatible, p.known]),
        [
            [true, false],
            [false, false],
            [true, true],
        ]
    );
    assert.equal(hints[0].pokemonId, 6);
    assert.deepEqual(compat.forMove('Surf', []), []);
    assert.equal(
        compat.decorate({ id: 'i', kind: 'iv', stat: 'hp' }, []).compatibility,
        undefined
    );
});
test('Draft DTOs expose only your selected Pokémon and refresh compatibility when the collection or prepared moves change', async (t) => {
    const manager = createDraftManager(null, {
        store: { loadActive: async () => [] },
        tickMs: 0,
    });
    t.after(() => manager.stop());
    await manager.ready;
    const a = card(6),
        b = card(9),
        hidden = card(157),
        move = { id: content.uuid(), kind: 'move', move: 'Flamethrower' },
        cards = [a, b, hidden, move];
    const r = {
        id: content.uuid(),
        phase: 'draft',
        version: 1,
        hostId: 1,
        level: 50,
        round: 0,
        pick: 0,
        cards: new Map(cards.map((c) => [c.id, c])),
        choices: [null, null, null, null],
        packs: [[move.id], [], [], []],
        matches: [],
        seats: [
            { index: 0, userId: 1, collection: [b.id] },
            { index: 1, userId: 2, collection: [hidden.id] },
            { index: 2, collection: [] },
            { index: 3, collection: [] },
        ],
    };
    let dto = manager.view(r, 1),
        hint = dto.pack[0].compatibility;
    assert.equal(hint.length, 1);
    assert(!hint[0].compatible);
    assert(!JSON.stringify(dto).includes(hidden.id));
    r.seats[0].collection.push(a.id, move.id);
    hint = manager.view(r, 1).pack[0].compatibility;
    assert.equal(hint.filter((v) => v.compatible && !v.known).length, 1);
    r.phase = 'preparation';
    for (const s of r.seats) s.plan = prep.empty();
    prep.edit(r, r.seats[0], { action: 'slot', slot: 0, cardId: a.id });
    prep.edit(r, r.seats[0], {
        action: 'apply',
        pokemonId: a.id,
        cardId: move.id,
        moveSlot: 0,
    });
    dto = manager.view(r, 1);
    hint = dto.collection.find((c) => c.id === move.id).compatibility;
    assert(hint.find((v) => v.cardId === a.id).known);
    assert(!a.pokemon.abilities.includes('Flamethrower'));
    assert(
        dto.collection
            .find((c) => c.id === a.id)
            .pokemon.abilities.includes('Flamethrower')
    );
    assert.equal(dto.preparation.rifts.length, 0);
});
test('the Safari encounter map alone disables permanent deaths, including old snapshots with no region', () => {
    const policy = require('../server/game/raids/lossPolicy');
    for (let i = 1; i <= 15; i++)
        assert.equal(policy.permanentDeaths({ map: 'safari' + i }), false);
    for (const r of [
        { map: 'jungle4', region: 'safari' },
        {},
        { map: 'safari999' },
    ])
        assert.equal(policy.permanentDeaths(r), true);
});
