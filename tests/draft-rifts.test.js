const test = require('node:test'),
    assert = require('node:assert/strict');
const content = require('../server/game/draft/content'),
    prep = require('../server/game/draft/preparation'),
    rifts = require('../server/game/draft/rifts'),
    codec = require('../server/game/drift/checkpointCodec');
function fixture() {
    const pokemon = {
        id: content.uuid(),
        kind: 'pokemon',
        pokemon: content.pokemon(9, 100, () => 0.3),
    };
    const cards = [
        pokemon,
        ...['brute', 'element-Water', 'element-Fire'].map((rift) => ({
            id: content.uuid(),
            kind: 'rift',
            rift,
        })),
    ];
    const run = { cards: new Map(cards.map((c) => [c.id, c])) },
        seat = { collection: cards.map((c) => c.id), plan: prep.empty() };
    prep.edit(run, seat, { action: 'slot', slot: 0, cardId: pokemon.id });
    return { run, seat, cards };
}
test('two Rift cards are reversible, unique, owned and replaceable; a third cannot be added implicitly', () => {
    const { run, seat, cards } = fixture();
    for (const c of cards.slice(1, 3))
        prep.edit(run, seat, { action: 'rift', cardId: c.id });
    assert.deepEqual(
        prep.selectedRifts(seat.plan),
        cards.slice(1, 3).map((c) => c.id)
    );
    assert.equal(seat.plan.rift, cards[1].id);
    assert.equal(prep.consumed(seat.plan).length, 2);
    prep.validate(run, seat);
    assert.throws(
        () => prep.edit(run, seat, { action: 'rift', cardId: cards[3].id }),
        /Deux Rifts/
    );
    assert.throws(
        () =>
            prep.edit(run, seat, {
                action: 'rift',
                cardId: cards[1].id,
                riftSlot: 1,
            }),
        /déjà sélectionnée/
    );
    assert.throws(
        () => prep.edit(run, seat, { action: 'rift', cardId: content.uuid() }),
        /collection/
    );
    assert.throws(
        () =>
            prep.edit(run, seat, {
                action: 'rift',
                cardId: cards[3].id,
                riftSlot: 2,
            }),
        /Emplacement/
    );
    prep.edit(run, seat, { action: 'rift', cardId: cards[3].id, riftSlot: 0 });
    assert(!prep.consumed(seat.plan).includes(cards[1].id));
    prep.edit(run, seat, { action: 'rift', cardId: null, riftSlot: 1 });
    assert.deepEqual(prep.selectedRifts(seat.plan), [cards[3].id]);
    prep.edit(run, seat, { action: 'rift', cardId: null });
    assert.deepEqual(prep.selectedRifts(seat.plan), []);
});
test('legacy single-Rift plans, dual selection and native owner contexts survive checkpoints', () => {
    const { run, seat, cards } = fixture();
    delete seat.plan.rifts;
    seat.plan.rift = cards[1].id;
    assert.deepEqual(prep.selectedRifts(seat.plan), [cards[1].id]);
    prep.edit(run, seat, { action: 'rift', cardId: cards[2].id });
    const restored = codec.decode(codec.encode({ run, seat }));
    assert.deepEqual(prep.selectedRifts(restored.seat.plan), [
        cards[1].id,
        cards[2].id,
    ]);
    prep.validate(restored.run, restored.seat);
    prep.finalize(restored.run, restored.seat);
    assert.equal(prep.selectedRifts(restored.seat.plan).length, 2);
});
test('all pairs multiply both bonuses and penalties exactly once; legacy owners and status moves remain unchanged', () => {
    for (const a of rifts.list)
        for (const b of rifts.list) {
            const pair = { draftRifts: [a.key, b.key], draftRift: a.key },
                left = { draftRift: a.key },
                right = { draftRift: b.key };
            for (const stat of [
                'attack',
                'defense',
                'specialAttack',
                'specialDefense',
                'speed',
            ])
                assert.equal(
                    rifts.stat(pair, stat),
                    rifts.stat(left, stat) * rifts.stat(right, stat)
                );
            for (const type of ['Water', 'Fire', 'Normal'])
                for (const damage_class of ['physical', 'special']) {
                    const move = { type, combat: { damage_class } };
                    assert(
                        Math.abs(
                            rifts.multiplier(pair, null, move) -
                                rifts.multiplier(left, null, move) *
                                    rifts.multiplier(right, null, move)
                        ) < 1e-10
                    );
                    assert(
                        Math.abs(
                            rifts.multiplier(null, pair, move) -
                                rifts.multiplier(null, left, move) *
                                    rifts.multiplier(null, right, move)
                        ) < 1e-10
                    );
                }
            assert.equal(
                rifts.multiplier(pair, pair, {
                    type: 'Water',
                    combat: { damage_class: 'status' },
                }),
                1
            );
        }
});
test('dual Rifts are copied into AI forecasts and produce the same native damage and speed as the real battle', () => {
    const effects = require('../server/game/drift/driftEffects'),
        engine = require('../server/game/battle/battleEngine');
    const p = content.pokemon(9, 100, () => 0.3),
        q = content.pokemon(6, 100, () => 0.3);
    p.passiveAbility = q.passiveAbility = 'Keen Eye';
    const owner = {
            draftRifts: ['brute', 'element-Water'],
            draftRift: 'brute',
            drifts: [],
            equipped: [],
        },
        field = engine.createBattleState(),
        move = engine.getMoveByName('Surf');
    const before = codec.encode(p);
    effects.attach([p], owner, true);
    const predicted = engine.estimateDamage(p, q, move, { battleState: field });
    const actual = engine.calculateDamageDetailed(p, q, move, {
        battleState: field,
        preview: true,
    }).damage;
    assert.equal(predicted, actual);
    const copy = effects.copyTournamentPacts(p, codec.decode(before));
    assert.deepEqual(copy.__towerPactContext.draftRifts, owner.draftRifts);
    assert.notEqual(copy.__towerPactContext.draftRifts, owner.draftRifts);
    assert.equal(
        engine.estimateDamage(copy, q, move, { battleState: field }),
        actual
    );
    assert.equal(
        engine.getBattleSpeed(copy, null, field, q),
        engine.getBattleSpeed(p, null, field, q)
    );
    effects.detach([p]);
    assert(!p.__towerPactContext);
});

test('Rift slots preserve their actual drop position when the other slot is empty or removed', () => {
    const { run, seat, cards } = fixture();
    prep.edit(run, seat, { action: 'rift', cardId: cards[1].id, riftSlot: 1 });
    assert.deepEqual(seat.plan.rifts, [null, cards[1].id]);
    prep.edit(run, seat, { action: 'rift', cardId: cards[2].id });
    assert.deepEqual(seat.plan.rifts, [cards[2].id, cards[1].id]);
    prep.edit(run, seat, { action: 'rift', cardId: null, riftSlot: 0 });
    assert.deepEqual(seat.plan.rifts, [null, cards[1].id]);
    assert.deepEqual(prep.selectedRifts(seat.plan), [cards[1].id]);
    prep.validate(run, seat);
});
