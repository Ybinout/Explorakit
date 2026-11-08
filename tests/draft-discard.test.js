const test = require('node:test'),
    assert = require('node:assert/strict');
const c = require('../server/game/draft/content'),
    prep = require('../server/game/draft/preparation'),
    format = require('../server/game/draft/format');
function fixture() {
    const p = {
            id: c.uuid(),
            kind: 'pokemon',
            pokemon: c.pokemon(9, 100, () => 0.4),
        },
        q = {
            id: c.uuid(),
            kind: 'pokemon',
            pokemon: c.pokemon(6, 100, () => 0.4),
        };
    p.pokemon.abilities = ['Surf', 'Tackle', 'Bite', 'Withdraw'];
    const extra = [
        { kind: 'move', move: 'Ice Beam' },
        { kind: 'item', item: 'leftovers' },
        {
            kind: 'nature',
            nature: p.pokemon.nature === 'Timid' ? 'Modest' : 'Timid',
        },
        { kind: 'iv', stat: 'speed' },
        {
            kind: 'ability',
            ability:
                p.pokemon.passiveAbility === 'Intimidate'
                    ? 'Levitate'
                    : 'Intimidate',
        },
        { kind: 'rift', rift: 'brute' },
    ].map((v) => ({ id: c.uuid(), ...v }));
    p.pokemon.iv.speed = 12;
    const cards = [p, q, ...extra],
        run = { cards: new Map(cards.map((v) => [v.id, v])) },
        seat = { collection: cards.map((v) => v.id), plan: prep.empty() };
    prep.edit(run, seat, { action: 'slot', slot: 0, cardId: p.id });
    prep.edit(run, seat, { action: 'slot', slot: 1, cardId: q.id });
    return { run, seat, cards, p, q };
}
test('classic card generation uses 35/20/20/10/10/5 percent boundaries; stored legacy weights remain usable', () => {
    assert.deepEqual(c.config.weights, {
        pokemon: 35,
        move: 20,
        item: 20,
        nature: 10,
        iv: 10,
        ability: 5,
    });
    assert.equal(
        Object.values(c.config.weights).reduce((a, b) => a + b),
        100
    );
    for (const [value, kind] of [
        [0, 'pokemon'],
        [0.34999, 'pokemon'],
        [0.35, 'move'],
        [0.54999, 'move'],
        [0.55, 'item'],
        [0.74999, 'item'],
        [0.75, 'nature'],
        [0.85, 'iv'],
        [0.95, 'ability'],
        [0.9999, 'ability'],
    ])
        assert.equal(c.createCard(50, () => value).kind, kind);
    assert.equal(
        c.createCard(
            50,
            () => 0.32,
            false,
            format.forRun({ phase: 'draft' }).weights
        ).kind,
        'move'
    );
    assert.equal(c.createCard(50, () => 0.32).kind, 'pokemon');
    assert.deepEqual(
        [format.current().riftPackSize, format.current().riftPicks],
        [4, 2]
    );
});
test('every preparation category can be permanently discarded without touching other cards or owners', () => {
    for (const kind of [
        'pokemon',
        'move',
        'item',
        'nature',
        'iv',
        'ability',
        'rift',
    ]) {
        const { run, seat, cards, q } = fixture(),
            card = cards.find((v) => v.kind === kind),
            before = q.pokemon.currentHp;
        prep.edit(run, seat, { action: 'discard', cardId: card.id });
        assert(!run.cards.has(card.id));
        assert(!seat.collection.includes(card.id));
        assert(!prep.consumed(seat.plan).includes(card.id));
        assert(run.cards.has(q.id));
        assert.equal(q.pokemon.currentHp, before);
        prep.validate(run, seat);
        assert.throws(
            () => prep.edit(run, seat, { action: 'discard', cardId: card.id }),
            /collection/
        );
    }
});
test('discarding a selected Pokémon releases all its improvements; deselecting still retains the Pokémon', () => {
    const { run, seat, cards, p } = fixture(),
        original = JSON.stringify(p.pokemon);
    for (const card of cards.slice(2).filter((v) => v.kind !== 'rift'))
        prep.edit(run, seat, {
            action: 'apply',
            cardId: card.id,
            pokemonId: p.id,
            moveSlot: 0,
        });
    prep.edit(run, seat, { action: 'slot', slot: 0, cardId: null });
    assert(seat.collection.includes(p.id));
    assert(run.cards.has(p.id));
    assert(prep.consumed(seat.plan).length > 0);
    prep.edit(run, seat, { action: 'slot', slot: 0, cardId: p.id });
    prep.edit(run, seat, { action: 'discard', cardId: p.id });
    assert.equal(seat.plan.slots[0], null);
    assert(!seat.plan.attachments[p.id]);
    for (const card of cards.slice(2))
        assert(seat.collection.includes(card.id));
    assert.equal(prep.consumed(seat.plan).length, 0);
    assert.equal(JSON.stringify(p.pokemon), original);
});
test('discarding applied improvements restores the original trait and selected Rift slots retain their positions', () => {
    for (const kind of ['move', 'item', 'nature', 'iv', 'ability']) {
        const { run, seat, cards, p } = fixture(),
            card = cards.find((v) => v.kind === kind),
            before = JSON.stringify(prep.build(run, seat, p.id));
        prep.edit(run, seat, {
            action: 'apply',
            pokemonId: p.id,
            cardId: card.id,
            moveSlot: 0,
        });
        prep.edit(run, seat, { action: 'discard', cardId: card.id });
        assert.equal(JSON.stringify(prep.build(run, seat, p.id)), before);
        prep.validate(run, seat);
    }
    const { run, seat, cards } = fixture(),
        a = cards.find((v) => v.kind === 'rift'),
        b = { id: c.uuid(), kind: 'rift', rift: 'swift' };
    run.cards.set(b.id, b);
    seat.collection.push(b.id);
    prep.edit(run, seat, { action: 'rift', cardId: a.id, riftSlot: 0 });
    prep.edit(run, seat, { action: 'rift', cardId: b.id, riftSlot: 1 });
    prep.edit(run, seat, { action: 'discard', cardId: a.id });
    assert.deepEqual(seat.plan.rifts, [null, b.id]);
    assert.equal(seat.plan.rift, b.id);
    prep.validate(run, seat);
});
test('discarding a move safely releases dependent moves that would duplicate a restored original move', () => {
    const { run, seat, cards, p } = fixture(),
        move = cards.find((v) => v.kind === 'move');
    prep.edit(run, seat, {
        action: 'apply',
        pokemonId: p.id,
        cardId: move.id,
        moveSlot: 0,
    });
    for (const [i, name] of ['Surf', 'Tackle', 'Bite'].entries()) {
        const card = { id: c.uuid(), kind: 'move', move: name };
        run.cards.set(card.id, card);
        seat.collection.push(card.id);
        prep.edit(run, seat, {
            action: 'apply',
            pokemonId: p.id,
            cardId: card.id,
            moveSlot: i + 1,
        });
    }
    prep.edit(run, seat, { action: 'discard', cardId: move.id });
    assert.deepEqual(
        prep.build(run, seat, p.id).abilities,
        p.pokemon.abilities
    );
    assert.equal(prep.consumed(seat.plan).length, 0);
    prep.validate(run, seat);
});
test('foreign cards and validated plans reject permanent deletion', () => {
    const { run, seat, cards } = fixture(),
        foreign = { id: c.uuid(), kind: 'rift', rift: 'swift' };
    run.cards.set(foreign.id, foreign);
    assert.throws(
        () => prep.edit(run, seat, { action: 'discard', cardId: foreign.id }),
        /collection/
    );
    assert(run.cards.has(foreign.id));
    seat.plan.confirmed = true;
    assert.throws(
        () => prep.edit(run, seat, { action: 'discard', cardId: cards[0].id }),
        /validée/
    );
    assert(run.cards.has(cards[0].id));
});
