const test = require('node:test'), assert = require('node:assert/strict');
const engine = require('../server/game/battle/battleEngine');
const model = require('../server/game/battle/humanTrainerModel');
const factory = require('../server/game/drift/pokemonFactory');
const { weatherHealingAmount } = require('../server/game/battle/weatherHealing');
const { machines, teachMachine } = require('../server/game/items/machines');

function mon(move = 'Morning Sun', extra = {}) {
    const p = factory.create(196, 40, true);
    return Object.assign(p, { maxHp: 101, currentHp: 1, heldItem: null, passiveAbility: null,
        status: 'normal', abilities: [move], movePp: [5], __battle: { statStages: {} } }, extra);
}

for (const name of ['Morning Sun', 'Synthesis', 'Moonlight']) {
    test(`${name}: actual healing follows effective weather, rounding, PP and HP cap`, () => {
        for (const [weather, expected] of [[null, 50], ['sun', 67], ['rain', 25], ['hail', 25], ['sandstorm', 25]]) {
            const p = mon(name), foe = mon('Splash'), state = engine.createBattleState({ battleType: 'wild' });
            state.weather = { kind: weather, turns: 5 };
            const result = engine.useattack(name, p, foe, { battleState: state });
            assert(result.success, weather);
            assert.equal(p.currentHp, 1 + expected, weather);
            assert.equal(p.movePp[0], 4);
            assert.equal(foe.currentHp, 1);
            assert.equal(state.weather.kind, weather);
            p.currentHp = 100;
            engine.useattack(name, p, foe, { battleState: state });
            assert.equal(p.currentHp, 101);
        }
    });
}

test('weather heal uses neutral conditions under active Air Lock/Cloud Nine; KO/suppressed abilities do not neutralize', () => {
    for (const ability of ['Air Lock', 'Cloud Nine']) for (const owner of ['self', 'foe']) {
        const p = mon(), foe = mon('Splash'), source = owner === 'self' ? p : foe;
        source.passiveAbility = ability;
        for (const weather of ['sun', 'rain', 'hail', 'sandstorm']) {
            assert.equal(weatherHealingAmount({ ename: 'Morning Sun' }, p, foe, { weather: { kind: weather } }), 50);
        }
        source.__battle.abilitySuppressed = true;
        assert.equal(weatherHealingAmount({ ename: 'Morning Sun' }, p, foe, { weather: { kind: 'sun' } }), 67);
    }
    assert.equal(weatherHealingAmount({ ename: 'Morning Sun' }, mon(), mon('Splash', { currentHp: 0, passiveAbility: 'Cloud Nine' }), { weather: { kind: 'rain' } }), 25);
    assert.equal(weatherHealingAmount({ ename: 'Recover' }, mon(), mon(), { weather: { kind: 'sun' } }), null);
    assert.equal(weatherHealingAmount({ ename: 'Morning Sun' }, mon('', { maxHp: 103 }), mon(), { weather: { kind: 'rain' } }), 26);
});

test('Aurore cannot revive or bypass Heal Block, fails at full HP and retains Normal/status/5 PP', () => {
    const move = engine.getMoveByName('Morning Sun');
    assert.equal(move.type, 'Normal'); assert.equal(move.pp, 5); assert.equal(move.combat.damage_class, 'status');
    for (const props of [{ currentHp: 101 }, { currentHp: 0 }, { __battle: { statStages: {}, healBlockTurns: 2 } }]) {
        const p = mon('Morning Sun', props), before = p.currentHp;
        assert.equal(engine.useattack('Morning Sun', p, mon('Splash')).success, false);
        assert.equal(p.currentHp, before);
    }
    const p = mon('Recover');
    engine.useattack('Recover', p, mon('Splash'), { battleState: { ...engine.createBattleState(), weather: { kind: 'sun', turns: 5 } } });
    assert.equal(p.currentHp, 51, 'other heals keep their existing half-HP rule');
});

test('trainer projections match real weather healing on private copies', () => {
    for (const weather of [null, 'sun', 'rain', 'hail', 'sandstorm']) for (const suppress of [null, 'Cloud Nine']) {
        const a = mon(), b = mon('Splash', { currentHp: 101, passiveAbility: suppress }), field = engine.createBattleState();
        field.weather = { kind: weather, turns: 5 };
        const before = JSON.stringify([a, b, field]);
        const projected = model.project(a, b, engine.getMoveByName('Morning Sun'), engine.getMoveByName('Splash'), {
            field, ownSide: field.sides.player, enemySide: field.sides.enemy, chance: () => 1
        });
        assert.equal(JSON.stringify([a, b, field]), before, 'planner must not mutate live state');
        const own = structuredClone(a), foe = structuredClone(b), actual = structuredClone(field);
        engine.useattack('Morning Sun', own, foe, { battleState: actual, attackerSide: actual.sides.player, defenderSide: actual.sides.enemy });
        engine.processEndOfRound(own, foe, actual.sides.player, actual.sides.enemy, actual);
        assert.equal(projected.own.currentHp, own.currentHp, `${weather}/${suppress}`);
    }
});

test('CS Aurore includes documented native learners and retained evolutions, excludes unrelated species', () => {
    for (const id of [48, 49, 58, 59, 77, 78, 175, 176, 191, 192, 196, 267, 420, 421, 468]) assert(machines.cs_morning_sun.species.includes(id));
    assert(machines.cs_morning_sun.species.includes(235), 'Permanent Sketch compatibility');
    assert.equal(machines.cs_morning_sun.price, 3000);
    for (const id of machines.cs_morning_sun.species) {
        const p = factory.create(id, 40, true); p.abilities = ['Tackle']; p.movePp = [2];
        const result = teachMachine(p, 'cs_morning_sun', { slot: 1, expectedMoves: [...p.abilities] });
        assert.deepEqual(result.abilities, ['Tackle', 'Morning Sun']); assert.deepEqual(result.movePp, [2, 5]);
    }
    for (const id of [1, 25, 133, 134, 197]) {
        const p = factory.create(id, 40, true); p.abilities = ['Tackle']; p.movePp = [2];
        assert.throws(() => teachMachine(p, 'cs_morning_sun', { slot: 1, expectedMoves: [...p.abilities] }), /compatible/);
    }
});
