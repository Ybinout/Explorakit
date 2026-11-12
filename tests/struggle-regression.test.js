const test = require('node:test'), assert = require('node:assert/strict');
const engine = require('../server/game/battle/battleEngine'), factory = require('../server/game/drift/pokemonFactory');
function fixture(type = 'Normal', ability = null) {
    const make = () => Object.assign(factory.create(143, 50, true), {
        uuid: Math.random().toString(), maxHp: 1002, currentHp: 1002,
        attack: 100, currentAttack: 100, defense: 100, currentDefense: 100,
        type1: 'Normal', type2: null, passiveAbility: null, heldItem: null,
        abilities: ['Tackle'], movePp: [0], status: 'normal'
    });
    const a = make(), b = make(), state = engine.createBattleState();
    b.type1 = type; b.passiveAbility = ability;
    engine.ensureBattleData(a); engine.ensureBattleData(b);
    const cast = () => engine.useattack('Tackle', a, b, {battleState: state,
        attackerSide: state.sides.player, defenderSide: state.sides.enemy, attackerTeam: [a], defenderTeam: [b]});
    return {a, b, state, cast};
}
function fixed(fn) { const old = Math.random; Math.random = () => .5; try { return fn(); } finally { Math.random = old; } }
test('Struggle is typeless against Ghost, Steel, Rock and Wonder Guard, with no STAB', () => fixed(() => {
    const normal = fixture().cast().damage;
    assert(normal > 0);
    for (const type of ['Ghost', 'Steel', 'Rock']) for (const ability of [null, 'Wonder Guard']) {
        const x = fixture(type, ability), result = x.cast();
        assert.equal(result.moveName, 'Struggle');
        assert.equal(result.damage, normal, `${type}/${ability}`);
        assert.equal(result.effectiveness, 1);
        assert.equal(x.a.currentHp, 751, 'one quarter max HP rounded, independent of inflicted damage');
        assert.deepEqual(x.a.movePp, [0]);
    }
    const nonNormal = fixture(); nonNormal.a.type1 = 'Water';
    assert.equal(nonNormal.cast().damage, normal);
}));
test('Struggle cannot be converted by type abilities or prevented by recoil immunity', () => fixed(() => {
    const baseline = fixture().cast().damage;
    for (const ability of ['Normalize', 'Pixilate', 'Refrigerate', 'Protean', 'Magic Guard', 'Rock Head']) {
        const x = fixture('Ghost'); x.a.passiveAbility = ability;
        assert.equal(x.cast().damage, baseline, ability);
        assert.equal(x.a.currentHp, 751, ability);
        assert.deepEqual(engine.getPokemonTypes(x.a), ['Normal']);
    }
}));
test('Struggle obeys Protect and Substitute and still recoils against a one-HP Endure target', () => fixed(() => {
    const protect = fixture('Ghost'); protect.b.__battle.protect = true;
    assert.equal(protect.cast().damage, 0); assert.equal(protect.a.currentHp, 1002);
    const sub = fixture('Ghost'); sub.b.__battle.substituteHp = 100;
    assert(sub.cast().substituteDamage > 0); assert.equal(sub.b.currentHp, 1002); assert.equal(sub.a.currentHp, 751);
    const endure = fixture(); endure.b.currentHp = 1; endure.b.__battle.endure = true;
    assert.equal(endure.cast().damage, 0); assert.equal(endure.b.currentHp, 1); assert.equal(endure.a.currentHp, 751);
}));
test('Struggle is selected for exhausted, disabled, taunted and exhausted Choice-locked pools', () => fixed(() => {
    for (const blocked of ['empty', 'disabled', 'taunt', 'choice']) {
        const x = fixture('Ghost');
        if (blocked === 'disabled') {x.a.movePp = [35]; x.a.__battle.disabledMove = 'Tackle'; x.a.__battle.disableTurns = 3;}
        if (blocked === 'taunt') {x.a.abilities = ['Recover']; x.a.movePp = [10]; x.a.__battle.tauntTurns = 3;}
        if (blocked === 'choice') {x.a.abilities.push('Recover'); x.a.movePp.push(10); x.a.heldItem = 'choice_band'; x.a.__battle.choiceMove = 'Tackle';}
        assert.equal(x.cast().moveName, 'Struggle', blocked);
        assert(x.b.currentHp < 1002, blocked);
    }
    const asleep = fixture('Ghost'); asleep.a.status = 'sleep'; asleep.a.__battle.sleepTurns = 3;
    assert.equal(asleep.cast().damage, 0); assert.equal(asleep.a.currentHp, 1002);
}));

test('native Gen7 confirms typeless Struggle, Wonder Guard bypass and unavoidable quarter-HP recoil', () => {
    const {Battle} = require('@pkmn/sim');
    let reference;
    for (const type of ['Normal', 'Ghost', 'Steel', 'Rock']) {
        const battle = new Battle({formatid: 'gen7customgame', seed: [1, 2, 3, 4]});
        try {
            battle.setPlayer('p1', {name: 'One', team: [{species: 'Snorlax', ability: 'Magic Guard', moves: ['Tackle']}]});
            battle.setPlayer('p2', {name: 'Two', team: [{species: 'Snorlax', ability: 'Wonder Guard', moves: ['Splash']}]});
            battle.choose('p1', 'team 1'); battle.choose('p2', 'team 1');
            const a = battle.p1.active[0], b = battle.p2.active[0];
            a.maxhp = a.baseMaxhp = a.hp = 1002;
            a.moveSlots[0].pp = 0;
            b.setType(type);
            const before = b.hp;
            battle.choose('p1', 'move 1'); battle.choose('p2', 'move 1');
            const damage = before - b.hp;
            reference ??= damage;
            assert(damage > 0); assert.equal(damage, reference); assert.equal(a.hp, 751);
        } finally { battle.destroy(); }
    }
});

test('AI projects typeless Struggle and exact recoil without mutating live combat state', () => fixed(() => {
    const model = require('../server/game/battle/humanTrainerModel');
    const x = fixture('Ghost', 'Wonder Guard');
    x.a.passiveAbility = 'Magic Guard';
    const before = JSON.stringify(x);
    const ctx = {field: x.state, ownSide: x.state.sides.player, enemySide: x.state.sides.enemy,
        chance: () => 1, damage: (p, q, move, side, state, extra) => engine.estimateDamage(p, q, move, {battleState: state, defenderSide: side, ...extra})};
    const out = model.project(x.a, x.b, engine.getMoveByName('Struggle'), engine.getMoveByName('Splash'), ctx, {first: true});
    assert.equal(JSON.stringify(x), before);
    x.cast();
    engine.processEndOfRound(x.a, x.b, x.state.sides.player, x.state.sides.enemy, x.state);
    assert.equal(out.own.currentHp, x.a.currentHp);
    assert.equal(out.foe.currentHp, x.b.currentHp);
    assert.equal(out.own.currentHp, 751);
    assert(out.foe.currentHp < 1002);
}));
