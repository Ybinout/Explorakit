const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../server/game/battle/battleEngine');
const resources = require('../server/game/battle/battleResources');
const model = require('../server/game/battle/humanTrainerModel');
const {DriftBattle} = require('../server/game/drift/driftBattle');
const factory = require('../server/game/drift/pokemonFactory');

let serial = 0;
function mon(props = {}, moves = ['Pound']) {
    return Object.assign(factory.create(19, 50, true), {
        uuid: `status-${++serial}`, name: 'Test', truename: 'Test', type1: 'Normal', type2: null,
        maxHp: 320, currentHp: 320, currentAttack: 100, currentDefense: 100,
        currentSpecialAttack: 100, currentSpecialDefense: 100, currentSpeed: 100,
        status: 'normal', passiveAbility: null, heldItem: null, abilities: moves,
        movePp: moves.map(resources.getMaxMovePp), __battle: {statStages: {}}
    }, props);
}
function rng(n, work) {
    const previous = Math.random; Math.random = () => n;
    try {return work();} finally {Math.random = previous;}
}
function hit(a, b = mon(), name = 'Pound', field = engine.createBattleState()) {
    return rng(.5, () => engine.useattack(name, a, b, {battleState: field,
        attackerSide: field.sides.player, defenderSide: field.sides.enemy,
        attackerTeam: [a], defenderTeam: [b]}));
}
function damage(status, name = 'Pound', props = {}) {
    return hit(mon({status, ...props}, [name]), mon(), name).damage;
}

test('paralysis halves actual speed without changing the saved stat, and a cure restores it', () => {
    const a = mon({currentSpeed: 101}), b = mon();
    assert(engine.applyStatus(a, 'paralyze', null, []));
    assert.equal(engine.getBattleSpeed(a), 50);
    assert.equal(a.currentSpeed, 101);
    assert(hit(a, b, 'Refresh').success);
    assert.equal(a.status, 'normal'); assert.equal(engine.getBattleSpeed(a), 101);
});

test('paralysis is rounded after Tailwind and Scarf, including an odd Speed', () => {
    const a = mon({currentSpeed: 101, status: 'paralyze'}), f = engine.createBattleState();
    f.sides.player.screens.tailwindTurns = 3;
    assert.equal(engine.getBattleSpeed(a, f.sides.player, f), 101);
    a.heldItem = 'choice_scarf';
    assert.equal(engine.getBattleSpeed(a, f.sides.player, f), 151);
    f.field.magicRoomTurns = 3;
    assert.equal(engine.getBattleSpeed(a, f.sides.player, f), 101);
});

test('paralysis changes turn order, while priority and Trick Room keep their rules', () => {
    const a = mon({currentSpeed: 150}), b = mon({currentSpeed: 100}), f = engine.createBattleState();
    const actions = [{pokemon: a, moveName: 'Pound', side: f.sides.player},
        {pokemon: b, moveName: 'Pound', side: f.sides.enemy}];
    assert.equal(engine.orderBattleActions(actions, f)[0].pokemon, a);
    a.status = 'paralyze'; assert.equal(engine.orderBattleActions(actions, f)[0].pokemon, b);
    f.field.trickRoomTurns = 3; assert.equal(engine.orderBattleActions(actions, f)[0].pokemon, a);
    actions[1].moveName = 'Quick Attack';
    assert.equal(engine.orderBattleActions(actions, f)[0].pokemon, b);
});

test('Gyro Ball uses the same paralyzed speed as turn order, with Tailwind and Quick Feet', () => {
    const a = mon({status: 'paralyze', currentSpeed: 100}, ['Gyro Ball']), b = mon({currentSpeed: 150});
    const f = engine.createBattleState(), options = {battleState: f, attackerSide: f.sides.player, defenderSide: f.sides.enemy};
    const move = engine.getMoveByName('Gyro Ball');
    assert.equal(engine.getSpecialMoveResolution(move, a, b, options).power, 76);
    f.sides.player.screens.tailwindTurns = 3;
    assert.equal(engine.getSpecialMoveResolution(move, a, b, options).power, 38);
    const expected = engine.estimateDamage(mon(), mon(), {...move, power: 38});
    assert.equal(hit(a, b, 'Gyro Ball', f).damage, expected);
    a.passiveAbility = 'Quick Feet';
    assert.equal(engine.getSpecialMoveResolution(move, a, b, options).power, 13);
});

test('full paralysis has a 25% boundary and consumes neither PP nor a hit when blocked', () => {
    const a = mon({status: 'paralyze'}), b = mon(), f = engine.createBattleState();
    const pp = a.movePp[0], hp = b.currentHp;
    const blocked = rng(.249, () => engine.useattack('Pound', a, b, {battleState: f}));
    assert.equal(blocked.success, false); assert.equal(b.currentHp, hp); assert.equal(a.movePp[0], pp);
    const allowed = rng(.25, () => engine.useattack('Pound', a, b, {battleState: f}));
    assert(allowed.damage > 0); assert.equal(a.movePp[0], pp - 1);
});

test('Quick Feet replaces the speed penalty but does not prevent full paralysis; suppression restores it', () => {
    const a = mon({passiveAbility: 'Quick Feet', status: 'paralyze'});
    assert.equal(engine.getBattleSpeed(a), 150);
    assert.equal(rng(0, () => engine.processTurnStart(a)).canAct, false);
    a.__battle.abilitySuppressed = true; assert.equal(engine.getBattleSpeed(a), 50);
    a.status = 'burn'; a.__battle.abilitySuppressed = false;
    assert.equal(engine.getBattleSpeed(a), 150);
    assert.equal(damage('burn', 'Pound', {passiveAbility: 'Quick Feet'}), damage('burn'));
});

for (const name of ['Pound', 'Slash']) test(`burn halves physical ${name}, including critical hits`, () => {
    for (const roll of [.5, 0]) {
        const cast = status => {const a = mon({status}, [name]), b = mon();
            return rng(roll, () => engine.useattack(name, a, b, {battleState: engine.createBattleState()})).damage;};
        const normal = cast('normal'), burned = cast('burn');
        assert(normal > 0); assert(Math.abs(burned - Math.floor(normal / 2)) <= 1);
    }
});
test('burn leaves special damage and Attack data intact; Refresh removes the penalty', () => {
    assert.equal(damage('burn', 'Water Gun'), damage('normal', 'Water Gun'));
    const a = mon({status: 'burn'});
    const reduced = hit(a).damage; assert.equal(a.currentAttack, 100);
    hit(a, mon(), 'Refresh'); assert.equal(a.status, 'normal');
    assert(hit(a).damage >= reduced * 2); assert.equal(a.currentAttack, 100);
});

test('Guts cancels the burn penalty and grants its Attack bonus; suppression restores normal burn', () => {
    const boosted = damage('burn', 'Pound', {passiveAbility: 'Guts'});
    assert.equal(boosted, damage('normal', 'Pound', {currentAttack: 150}));
    assert.equal(damage('paralyze', 'Pound', {passiveAbility: 'Guts'}), boosted);
    assert.equal(damage('burn', 'Water Gun', {passiveAbility: 'Guts'}), damage('normal', 'Water Gun'));
    assert.equal(damage('burn', 'Pound', {passiveAbility: 'Guts', __battle: {abilitySuppressed: true}}), damage('burn'));
});

test('Magic Guard prevents burn residuals but leaves its physical damage penalty', () => {
    const a = mon({status: 'burn', passiveAbility: 'Magic Guard'}), b = mon(), f = engine.createBattleState();
    assert.equal(hit(a, b).damage, damage('burn'));
    engine.processEndOfRound(a, b, f.sides.player, f.sides.enemy, f);
    assert.equal(a.currentHp, 320);
});

test('Flare Boost increases burned special damage without removing the physical penalty', () => {
    assert.equal(damage('burn', 'Water Gun', {passiveAbility: 'Flare Boost'}), damage('normal', 'Water Gun', {currentSpecialAttack: 150}));
    assert.equal(damage('burn', 'Pound', {passiveAbility: 'Flare Boost'}), damage('burn'));
});

for (const status of ['burn', 'poison', 'badly_poison', 'paralyze']) test(`Facade doubles power with ${status} and is exempt from the burn penalty`, () => {
    const a = mon({status}, ['Facade']), b = mon(), move = engine.getMoveByName('Facade');
    const expected = engine.estimateDamage(mon(), mon(), {...move, power: 140});
    const predicted = engine.estimateDamage(a, b, move);
    assert.equal(predicted, expected);
    assert.equal(hit(a, b, 'Facade').damage, expected);
    assert.equal(move.power, 70, 'the shared move catalogue is not modified');
});
for (const status of ['normal', 'sleep', 'freeze']) test(`Facade has no power bonus for ${status}`, () => {
    assert.equal(engine.estimateDamage(mon({status}), mon(), engine.getMoveByName('Facade')),
        engine.estimateDamage(mon(), mon(), engine.getMoveByName('Facade')));
});
test('Guts and Facade combine without a second burn penalty', () => {
    const a = mon({status: 'burn', passiveAbility: 'Guts'}, ['Facade']), b = mon();
    assert.equal(hit(a, b, 'Facade').damage, engine.estimateDamage(mon({currentAttack: 150}), mon(), {...engine.getMoveByName('Facade'), power: 140}));
});

for (const [ability, suppressed, loss] of [[null, false, 20], ['Heatproof', false, 10], ['Heatproof', true, 20], ['Guts', false, 20]]) {
    test(`burn residual: ${ability || 'ordinary'}, suppressed=${suppressed}`, () => {
        const a = mon({status: 'burn', passiveAbility: ability, __battle: {abilitySuppressed: suppressed}}), b = mon(), f = engine.createBattleState();
        engine.processEndOfRound(a, b, f.sides.player, f.sides.enemy, f);
        assert.equal(a.currentHp, 320 - loss);
        const projected = model.copy(mon({status: 'burn', passiveAbility: ability, __battle: {abilitySuppressed: suppressed}}));
        model.endTurn(projected, model.copy(mon()), engine.createBattleState());
        assert.equal(projected.currentHp, a.currentHp, 'AI projection matches the residual');
    });
}
test('burn still costs at least one HP with Heatproof, even at one remaining HP', () => {
    const a = mon({maxHp: 15, currentHp: 1, status: 'burn', passiveAbility: 'Heatproof'}), b = mon(), f = engine.createBattleState();
    engine.processEndOfRound(a, b, f.sides.player, f.sides.enemy, f);
    assert.equal(a.currentHp, 0);
    const projected = model.copy(mon({maxHp: 15, currentHp: 1, status: 'burn', passiveAbility: 'Heatproof'}));
    model.endTurn(projected, model.copy(b), engine.createBattleState()); assert.equal(projected.currentHp, 0);
});
for (const [ability, status, type] of [['Limber', 'paralyze', 'Normal'], ['Water Veil', 'burn', 'Normal'],
    [null, 'paralyze', 'Electric'], [null, 'burn', 'Fire']]) test(`${ability || type} prevents ${status} instead of applying a penalty`, () => {
    const p = mon({passiveAbility: ability, type1: type});
    assert.equal(engine.applyStatus(p, status, null, []), false); assert.equal(p.status, 'normal');
});
test('fixed-damage physical attacks are unaffected by burn', () => {
    assert.equal(damage('burn', 'Seismic Toss'), 50); assert.equal(damage('normal', 'Seismic Toss'), 50);
});

for (const mode of [
    {name: 'Rift wild', type: 'wild', npc: true, mode: 'rift'},
    {name: 'Rift PvP', type: 'pvp', npc: false, mode: 'rift'},
    {name: 'Colosseum', type: 'arena', npc: true, mode: 'colosseum'},
    {name: 'Super Tournament', type: 'trainer', npc: true}
]) for (const status of ['paralyze', 'burn']) test(`${mode.name}: real turn uses ${status} speed/damage penalties`, () => {
    const own = mon({status, currentSpeed: 150}), foe = mon({currentSpeed: 100}, ['Splash']);
    const player = (id, p) => ({userId: id, socketId: `status-${id}`, equipe: {pokemons: [p]}, items: {},
        money: 0, drifts: [], equipped: [], defeated: new Set(), chain: 0});
    const a = player(1, own), b = player(2, foe), events = [];
    a.run = {mode: mode.mode}; b.npc = mode.npc;
    const battle = new DriftBattle(a, b, {type: mode.type, now: () => 0, random: () => .5, paceMs: 0,
        rules: {report: false, rewards: false, permanentDeaths: false},
        emit: (p, event, data) => {if (p.userId === 1) events.push({event, data});}});
    try {
        rng(.5, () => {
            assert(battle.action(a, {action: 'attack', number: 0, turnId: battle.token}));
            if (!b.npc) assert(battle.action(b, {action: 'attack', number: 0, turnId: battle.token}));
        });
        const order = events.filter(e => e.event === 'battleMoveAnimation').map(e => e.data.actor);
        assert.deepEqual(order, status === 'paralyze' ? ['opponent', 'player'] : ['player', 'opponent']);
        assert.equal(320 - foe.currentHp, damage(status));
        assert.equal(own.currentHp, status === 'burn' ? 300 : 320);
    } finally {battle.finish(null, 'fled');}
});
