const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../server/game/battle/battleEngine');
const resources = require('../server/game/battle/battleResources');
const factory = require('../server/game/drift/pokemonFactory');
const ai = require('../server/game/battle/humanTrainerAI');
const model = require('../server/game/battle/humanTrainerModel');
const {redundantReason} = require('../server/game/battle/moveRedundancy');
const {switchPokemonByIndex, switchToNextAlive} = require('../server/game/battle/battleTeam');

function mon(id = 94, overrides = {}) {
    return Object.assign(factory.create(id, 50, true), {
        uuid: `curse-${id}`, abilities: ['Curse', 'Splash'], movePp: [10, 40],
        maxHp: 200, currentHp: 200, passiveAbility: null, heldItem: null,
        status: 'normal', __battle: {statStages: {}}
    }, overrides);
}
function cast(a, b, state = engine.createBattleState(), extra = {}) {
    return engine.useattack('Curse', a, b, {
        battleState: state, attackerSide: state.sides.player, defenderSide: state.sides.enemy,
        attackerTeam: [a], defenderTeam: [b], ...extra
    });
}
function residual(p, other, state) {
    return engine.processEndOfRound(p, other, state.sides.enemy, state.sides.player, state);
}

test('Ghost Curse costs half max HP, curses only the opponent, and drains one quarter each round', () => {
    const a = mon(), b = mon(143), state = engine.createBattleState();
    const result = cast(a, b, state);
    assert.equal(result.success, true);
    assert.equal(a.currentHp, 100);
    assert.equal(b.currentHp, 200);
    assert.equal(a.__battle.curseSource, null);
    assert.equal(b.__battle.curseSource, a.uuid);
    assert.equal(a.movePp[0], 9);
    for (let n = 1; n <= 4; n++) {
        residual(b, a, state);
        assert.equal(b.currentHp, 200 - n * 50);
    }
    assert.match(result.messages.join(' '), /sacrifie 100 PV/);
    assert.equal(engine.getMoveByName('Curse').combat.target, 'single', 'shared catalogue must stay unchanged');
});

test('already cursed target: failure consumes PP but no additional HP or curse stack', () => {
    const a = mon(), b = mon(143), state = engine.createBattleState();
    cast(a, b, state);
    state.turn++;
    const result = cast(a, b, state);
    assert.equal(result.success, false);
    assert.equal(a.currentHp, 100);
    assert.equal(a.movePp[0], 8);
    residual(b, a, state);
    assert.equal(b.currentHp, 150);
});

for (const props of [{currentHp: 20}, {currentHp: 20, passiveAbility: 'Magic Guard', heldItem: 'focus_sash'}]) {
    test(`Curse can sacrifice a low-HP user, even with Magic Guard/Focus Sash: ${JSON.stringify(props)}`, () => {
        const a = mon(94, props), b = mon(143), state = engine.createBattleState();
        const result = cast(a, b, state);
        assert.equal(result.success, true);
        assert.equal(a.currentHp, 0);
        residual(b, a, state);
        assert.equal(b.currentHp, 150, 'curse survives the caster being KO');
    });
}

test('odd max HP rounds down both cost and residual; Magic Guard blocks residual only', () => {
    const a = mon(94, {maxHp: 201, currentHp: 201}), b = mon(143, {maxHp: 203, currentHp: 203});
    const state = engine.createBattleState();
    cast(a, b, state);
    assert.equal(a.currentHp, 101);
    b.passiveAbility = 'Magic Guard'; residual(b, a, state); assert.equal(b.currentHp, 203);
    b.passiveAbility = null; residual(b, a, state); assert.equal(b.currentHp, 153);
});

for (const guard of ['protect', 'substituteHp', 'magicCoat', 'Magic Bounce']) {
    test(`Ghost Curse bypasses ${guard} and Normal type immunity`, () => {
        const a = mon(), b = mon(143);
        if (guard === 'Magic Bounce') b.passiveAbility = guard;
        else b.__battle[guard] = guard === 'substituteHp' ? 50 : true;
        const result = cast(a, b);
        assert.equal(result.success, true);
        assert.equal(a.currentHp, 100);
        assert.equal(a.__battle.curseSource, null);
        assert.equal(b.__battle.curseSource, a.uuid);
        if (guard === 'substituteHp') assert.equal(b.__battle.substituteHp, 50);
    });
}

for (const [ability, expected] of [[null, [1, 1, -1]], ['Clear Body', [1, 1, -1]], ['Contrary', [-1, -1, 1]], ['Simple', [2, 2, -2]]]) {
    test(`non-Ghost Curse changes only the user's stats, including ${ability || 'normal ability'}`, () => {
        const a = mon(143, {passiveAbility: ability}), b = mon(94);
        b.__battle.protect = true; b.__battle.snatch = true;
        const result = cast(a, b);
        assert.equal(result.success, true);
        assert.deepEqual(['attack', 'defense', 'speed'].map(s => a.__battle.statStages[s]), expected);
        assert.equal(a.currentHp, 200);
        assert.equal(b.currentHp, 200);
        assert.equal(b.__battle.curseSource, null);
        assert.equal(a.__battle.curseSource, null);
    });
}

test('non-Ghost Curse fails only once all three stage changes are at their caps', () => {
    const a = mon(143), b = mon(), state = engine.createBattleState();
    a.__battle.statStages = {attack: 6, defense: 6, speed: -5};
    assert.equal(cast(a, b, state).success, true);
    state.turn++;
    assert.equal(cast(a, b, state).success, false);
    assert.equal(a.currentHp, 200);
    assert.equal(redundantReason(a, engine.getMoveByName('Curse'), state, {opponent: b}), 'stage_at_limit');
});

for (const [id, types, ghost] of [[143, ['Ghost'], true], [94, ['Normal'], false]]) {
    test(`Curse uses current types rather than base species ${id}`, () => {
        const a = mon(id), b = mon(143);
        a.__battle.tempTypes = types;
        assert.equal(cast(a, b).success, true);
        assert.equal(a.currentHp, ghost ? 100 : 200);
        assert.equal(Boolean(b.__battle.curseSource), ghost);
    });
}

test('switching the caster does not remove Curse; switching the target does; Baton Pass transfers it', () => {
    const a = mon(), b = mon(143), state = engine.createBattleState();
    cast(a, b, state);
    const casters = [a, mon(25)]; assert.equal(switchPokemonByIndex(casters, 1), true);
    residual(b, casters[0], state); assert.equal(b.currentHp, 150);
    const targets = [b, mon(113)];
    switchToNextAlive(targets, {batonPass: true});
    assert.equal(Boolean(b.__battle?.curseSource), false);
    assert.equal(targets[0].__battle.curseSource, a.uuid);
    residual(targets[0], casters[0], state); assert.equal(targets[0].currentHp, 150);
    switchPokemonByIndex(targets, 1);
    assert.equal(Boolean(targets[1].__battle?.curseSource), false);
});

test('catalogue and generated UI expose ten PP', () => {
    assert.equal(resources.getMaxMovePp('Curse'), 10);
    assert.equal(require('../vue-explorakit/src/data/moveLearning.json').Curse.pp, 10);
    assert.equal(require('../vue-explorakit/src/data/pokemonReference.fr.json').moves.Curse.pp, 10);
    const {prepareMoveAnimation} = require('../server/game/battle/battleEvents');
    assert.equal(prepareMoveAnimation(mon(143), mon(), 'Curse', engine.createBattleState()).moveTarget, 'self');
    assert.equal(prepareMoveAnimation(mon(), mon(143), 'Curse', engine.createBattleState()).moveTarget, 'single');
});

for (const [id, ability, alreadyCursed] of [[94, null, false], [143, null, false], [143, 'Contrary', false], [94, null, true]]) {
    test(`AI projects the real Curse outcome without mutation: ${id}/${ability}/${alreadyCursed}`, () => {
        const a = mon(id, {passiveAbility: ability}), b = mon(143), state = engine.createBattleState();
        if (alreadyCursed) b.__battle.curseSource = 'previous-caster';
        engine.ensureBattleData(a); engine.ensureBattleData(b);
        const before = JSON.stringify([a, b, state]);
        const projection = model.project(a, b, engine.getMoveByName('Curse'), engine.getMoveByName('Splash'), {
            field: state, ownSide: state.sides.player, enemySide: state.sides.enemy,
            damage: () => 0, chance: () => 1
        });
        assert.equal(JSON.stringify([a, b, state]), before);
        const result = cast(a, b, state);
        residual(a, b, state);
        assert.equal(projection.own.currentHp, a.currentHp);
        assert.equal(projection.foe.currentHp, b.currentHp);
        assert.deepEqual(projection.own.__battle.statStages, a.__battle.statStages);
        assert.equal(projection.action.useful, result.success);
        const publicFoe = ai.publicPokemon(b);
        assert.equal(publicFoe.__battle.curseSource, Boolean(b.__battle.curseSource));
        if (alreadyCursed) assert.equal(redundantReason(a, engine.getMoveByName('Curse'), state, {opponent: b}), 'effect_already_active');
    });
}
