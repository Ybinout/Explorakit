const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../server/game/battle/battleEngine');
const factory = require('../server/game/drift/pokemonFactory');
const resources = require('../server/game/battle/battleResources');

// Gen7 retains damaging Hail. These tests deliberately do not model Gen9 Snow.
// Primary reference: Pokemon Showdown data/conditions.ts, data/abilities.ts,
// data/moves.ts and their gen7 overrides, also exercised through @pkmn/sim below.
let nextId = 0;
function mon(extra = {}, moves = ['Splash']) {
    const p = factory.create(143, 50, true);
    Object.assign(p, {
        uuid: `canonical-weather-${++nextId}`, type1: 'Normal', type2: null,
        maxHp: 160, currentHp: 160, attack: 100, currentAttack: 100,
        defense: 100, currentDefense: 100, specialAttack: 100, currentSpecialAttack: 100,
        specialDefense: 100, currentSpecialDefense: 100, speed: 100, currentSpeed: 100,
        passiveAbility: null, heldItem: null, status: 'normal', abilities: moves,
        movePp: moves.map(resources.getMaxMovePp), ...extra
    });
    engine.ensureBattleData(p);
    return p;
}
function fixture(weather = null, own = {}, foe = {}, moves = ['Splash']) {
    const a = mon(own, moves), b = mon(foe), state = engine.createBattleState();
    state.weather = {kind: weather, turns: 5};
    const end = () => engine.processEndOfRound(a, b, state.sides.player, state.sides.enemy, state);
    const cast = (name, user = a, target = b) => engine.useattack(name, user, target, {
        battleState: state, attackerSide: state.sides[user === a ? 'player' : 'enemy'],
        defenderSide: state.sides[user === a ? 'enemy' : 'player'],
        attackerTeam: [user], defenderTeam: [target], consumePp: false
    });
    return {a, b, state, end, cast};
}
function fixed(fn) {
    const old = Math.random;
    Math.random = () => .5;
    try { return fn(); } finally { Math.random = old; }
}
function damage(x, move = 'Swift', weather = x.state.weather.kind) {
    const state = structuredClone(x.state);
    state.weather.kind = weather;
    return engine.estimateDamage(x.a, x.b, engine.getMoveByName(move), {battleState: state});
}
function nativeBattle(own = {}, foe = {}) {
    const {Battle} = require('@pkmn/sim');
    const battle = new Battle({formatid: 'gen7customgame', seed: [1, 2, 3, 4]});
    battle.setPlayer('p1', {name: 'One', team: [{species: 'Snorlax', ability: 'Run Away', moves: ['Splash'], ...own}]});
    battle.setPlayer('p2', {name: 'Two', team: [{species: 'Snorlax', ability: 'Run Away', moves: ['Splash'], ...foe}]});
    battle.choose('p1', 'team 1'); battle.choose('p2', 'team 1');
    for (const p of [battle.p1.active[0], battle.p2.active[0]]) p.maxhp = p.baseMaxhp = p.hp = 160;
    return battle;
}

test('sand boosts Rock Special Defense by 50%, independently of stat stages and Assault Vest', () => {
    for (const stage of [-6, 0, 6]) for (const heldItem of [null, 'assault_vest']) {
        const x = fixture('sandstorm', {specialAttack: 1000, currentSpecialAttack: 1000},
            {type1: 'Rock', heldItem, specialDefense: 400, currentSpecialDefense: 400});
        x.b.__battle.statStages.specialDefense = stage;
        const reference = structuredClone(x.b);
        reference.specialDefense = reference.currentSpecialDefense = 600;
        const expected = engine.estimateDamage(x.a, reference, engine.getMoveByName('Swift'), {
            battleState: {...x.state, weather: {kind: null, turns: 0}}
        });
        assert.equal(damage(x), expected, `${stage}/${heldItem}`);
        assert(damage(x) < damage(x, 'Swift', null), `${stage}/${heldItem}`);
    }
});

test('sand rounds effective Special Defense down before damage; Ground, Steel and hail receive no bonus', () => {
    const x = fixture('sandstorm', {}, {type1: 'Rock', specialDefense: 101, currentSpecialDefense: 101});
    const reference = fixture(null, {}, {type1: 'Rock', specialDefense: 151, currentSpecialDefense: 151});
    assert.equal(damage(x), damage(reference));
    for (const type1 of ['Ground', 'Steel', 'Ice', 'Normal']) {
        const other = fixture('sandstorm', {}, {type1});
        assert.equal(damage(other), damage(other, 'Swift', null), type1);
        assert.equal(damage(other, 'Tackle', 'hail'), damage(other, 'Tackle', null), type1);
    }
});

test('sand uses current corrupted, temporary and form typing, including successful Roost', () => fixed(() => {
    const x = fixture('sandstorm', {}, {type1: 'Normal'});
    x.b.corruption = {version: 1, revision: 1, permanent: true, modules: {
        type: {itemKey: 'cmod_type_rock', types: ['Normal', 'Rock']}
    }};
    require('../server/game/corruption/pokemon').applyTraits(x.b);
    assert(damage(x) < damage(x, 'Swift', null), 'corrupted Rock receives the boost');
    x.b.__battle.tempTypes = ['Water'];
    assert.equal(damage(x), damage(x, 'Swift', null), 'Soak overrides the persistent Rock type');
    x.b.__battle.tempTypes = [];
    x.b.__battle.formTypes = ['Normal'];
    assert.equal(damage(x), damage(x, 'Swift', null), 'current form overrides persistent typing');
    x.b.__battle.formTypes = ['Rock'];
    assert(damage(x) < damage(x, 'Swift', null), 'a current Rock form receives the boost');
    const roost = fixture('sandstorm', {}, {type1: 'Rock', type2: 'Flying', currentHp: 80});
    assert(roost.cast('Roost', roost.b, roost.a).success);
    assert.deepEqual(engine.getPokemonTypes(roost.b), ['Rock']);
    assert(damage(roost) < damage(roost, 'Swift', null), 'Roost removes Flying, not Rock');
}));

for (const move of ['Psyshock', 'Psystrike', 'Secret Sword']) test(`${move} targets Defense and bypasses the sand Special Defense bonus`, () => {
    const x = fixture('sandstorm', {}, {type1: 'Rock', heldItem: 'assault_vest'});
    x.b.__battle.statStages.specialDefense = 6;
    assert.equal(damage(x, move), damage(x, move, null));
    x.b.__battle.statStages.defense = 2;
    assert.equal(damage(x, move), damage(x, move, null));
});

test('critical hits, Mold Breaker and Unaware preserve the sand bonus', () => fixed(() => {
    for (const passiveAbility of [null, 'Mold Breaker', 'Unaware']) {
        const x = fixture('sandstorm', {passiveAbility}, {type1: 'Rock'}, ['Frost Breath']);
        const base = damage(x, 'Frost Breath');
        x.b.__battle.statStages.specialDefense = 6;
        assert.equal(damage(x, 'Frost Breath'), base, passiveAbility);
        assert(base < damage(x, 'Frost Breath', null), passiveAbility);
        const result = x.cast('Frost Breath');
        assert(result.critical);
        assert.equal(result.damage, base, 'preview agrees with the real critical attack');
    }
}));

for (const ability of ['Cloud Nine', 'Air Lock']) test(`${ability} suppresses sand defense and residuals only while active`, () => {
    const x = fixture('sandstorm', {passiveAbility: ability}, {type1: 'Rock'});
    assert.equal(damage(x), damage(x, 'Swift', null));
    x.end(); assert.equal(x.a.currentHp, 160);
    assert.equal(x.state.weather.kind, 'sandstorm'); assert.equal(x.state.weather.turns, 4);
    x.a.__battle.abilitySuppressed = true;
    assert(damage(x) < damage(x, 'Swift', null));
    x.end(); assert.equal(x.a.currentHp, 150);
    x.a.__battle.abilitySuppressed = false; x.a.currentHp = 0;
    assert(damage(x) < damage(x, 'Swift', null), 'a fainted weather suppressor is inactive');
});

for (const weather of ['sandstorm', 'hail']) {
    test(`${weather} damage is floor(max HP / 16), minimum one, and respects type immunities`, () => {
        for (const maxHp of [15, 17, 31, 32, 101, 160]) {
            const x = fixture(weather, {maxHp, currentHp: maxHp});
            x.end(); assert.equal(x.a.currentHp, maxHp - Math.max(1, Math.floor(maxHp / 16)), `${maxHp} HP`);
        }
        for (const type1 of weather === 'sandstorm' ? ['Rock', 'Ground', 'Steel'] : ['Ice']) {
            const x = fixture(weather, {type1}); x.end(); assert.equal(x.a.currentHp, 160, type1);
        }
    });
    for (const passiveAbility of ['Overcoat', 'Magic Guard', ...(weather === 'sandstorm'
        ? ['Sand Veil', 'Sand Force', 'Sand Rush'] : ['Ice Body', 'Snow Cloak'])]) {
        test(`${passiveAbility} protects a nonimmune type from ${weather}, unless suppressed`, () => {
            const x = fixture(weather, {passiveAbility}); x.end(); assert.equal(x.a.currentHp, 160);
            x.a.__battle.abilitySuppressed = true; x.end(); assert.equal(x.a.currentHp, 150);
        });
    }
    for (const [move, immune] of [['Dig', true], ['Dive', true], ['Fly', false], ['Bounce', false]]) {
        test(`${move} ${immune ? 'avoids' : 'does not avoid'} ${weather} while charging`, () => fixed(() => {
            const x = fixture(weather, {}, {}, [move]);
            assert.equal(x.cast(move).phase, 'prepare');
            x.end(); assert.equal(x.a.currentHp, immune ? 160 : 150);
        }));
    }
}

test('Slush Rush doubles Speed but does not protect a non-Ice type from hail', () => {
    const x = fixture('hail', {passiveAbility: 'Slush Rush'});
    assert.equal(engine.getBattleSpeed(x.a, x.state.sides.player, x.state, x.b), 200);
    x.end(); assert.equal(x.a.currentHp, 150);
    const battle = nativeBattle({ability: 'Slush Rush'});
    try {
        battle.field.setWeather('hail', battle.p1.active[0]);
        battle.choose('p1', 'move 1'); battle.choose('p2', 'move 1');
        assert.equal(battle.p1.active[0].hp, 150);
    } finally { battle.destroy(); }
});

test('native Gen7 Safety Goggles block both weather residuals (item is not in the local catalogue)', () => {
    for (const weather of ['sandstorm', 'hail']) {
        const battle = nativeBattle({item: 'Safety Goggles'});
        try {
            battle.field.setWeather(weather, battle.p1.active[0]);
            battle.choose('p1', 'move 1'); battle.choose('p2', 'move 1');
            assert.equal(battle.p1.active[0].hp, 160, weather);
            assert.equal(battle.p2.active[0].hp, 150, weather);
        } finally { battle.destroy(); }
    }
});

for (const [weather, move, ability, item, nativeItem] of [
    ['sandstorm', 'Sandstorm', 'Sand Stream', 'smooth_rock', 'Smooth Rock'],
    ['hail', 'Hail', 'Snow Warning', 'icy_rock', 'Icy Rock']
]) {
    for (const extended of [false, true]) test(`${move} lasts ${extended ? 8 : 5} turns, expiring before its final residual`, () => {
        const duration = extended ? 8 : 5;
        const x = fixture(null, {heldItem: extended ? item : null}, {}, [move]);
        assert(x.cast(move).success); assert.equal(x.state.weather.turns, duration);
        const battle = nativeBattle({item: extended ? nativeItem : '', moves: [move, 'Splash']});
        try {
            for (let turn = 1; turn <= duration; turn++) {
                assert.equal(x.state.weather.kind, weather, 'weather exists during the last offensive turn');
                const before = x.a.currentHp;
                x.end();
                battle.choose('p1', turn === 1 ? 'move 1' : 'move 2'); battle.choose('p2', 'move 1');
                assert.equal(before - x.a.currentHp, turn < duration ? 10 : 0, `turn ${turn}`);
                assert.equal(x.a.currentHp, battle.p1.active[0].hp, `native turn ${turn}`);
                if (turn === 1) {
                    assert.equal(x.cast(move).success, false, 'recasting the same weather fails');
                    assert.equal(x.state.weather.turns, duration - 1, 'a failed recast does not reset its duration');
                }
            }
            assert.equal(x.state.weather.kind, null); assert.equal(battle.field.weather, '');
        } finally { battle.destroy(); }
    });
    test(`${ability} sets finite weather and the matching rock extends its duration`, () => {
        for (const heldItem of [null, item]) {
            const x = fixture(null, {passiveAbility: ability, heldItem});
            engine.applySwitchInEffects(x.a, x.state.sides.player, x.state.sides.enemy, x.state, x.b);
            assert.equal(x.state.weather.kind, weather); assert.equal(x.state.weather.turns, heldItem ? 8 : 5);
        }
    });
}

test('persistent map weather damages every round and is not decremented', () => {
    const x = fixture('hail', {maxHp: 1000, currentHp: 1000});
    x.state.weather.persistent = true; x.state.weather.turns = 0;
    for (let i = 0; i < 8; i++) x.end();
    assert.equal(x.a.currentHp, 504); assert.equal(x.state.weather.kind, 'hail'); assert.equal(x.state.weather.turns, 0);
});

test('weather damage KOs before Poison Heal, Aqua Ring or Leftovers can rescue the holder', () => {
    for (const source of ['Poison Heal', 'Aqua Ring', 'Leftovers']) {
        const x = fixture('sandstorm', {currentHp: 1});
        if (source === 'Poison Heal') {x.a.passiveAbility = source; x.a.status = 'poison';}
        if (source === 'Aqua Ring') x.a.__battle.aquaRing = true;
        if (source === 'Leftovers') x.a.heldItem = 'leftovers';
        x.end(); assert.equal(x.a.currentHp, 0, source);
    }
});

test('Ice Body heals in the weather phase before poison, and does not heal on weather expiry', () => {
    const x = fixture('hail', {passiveAbility: 'Ice Body', currentHp: 11, status: 'poison'});
    x.end(); assert.equal(x.a.currentHp, 1, '11 + 10 from Ice Body - 20 from poison');
    const expiry = fixture('hail', {passiveAbility: 'Ice Body', currentHp: 80});
    expiry.state.weather.turns = 1; expiry.end(); assert.equal(expiry.a.currentHp, 80);
    const battle = nativeBattle({ability: 'Ice Body'});
    try {
        const p = battle.p1.active[0]; p.hp = 11; p.setStatus('psn');
        battle.field.setWeather('hail', p);
        battle.choose('p1', 'move 1'); battle.choose('p2', 'move 1');
        assert.equal(p.hp, 1, 'native Gen7 also heals before poison damage');
    } finally { battle.destroy(); }
});

test('weather suppression applies to both actives before a suppressor faints from poison', () => {
    for (const reverse of [false, true]) {
        const x = fixture('hail');
        const suppressor = reverse ? x.b : x.a, protectedMon = reverse ? x.a : x.b;
        Object.assign(suppressor, {passiveAbility: 'Cloud Nine', status: 'poison', currentHp: 1});
        x.end(); assert.equal(suppressor.currentHp, 0); assert.equal(protectedMon.currentHp, 160);
        assert.equal(x.state.weather.kind, 'hail');
        x.end(); assert.equal(protectedMon.currentHp, 150, 'weather damage resumes in the next residual phase');
        const battle = nativeBattle(reverse ? {} : {ability: 'Cloud Nine'}, reverse ? {ability: 'Cloud Nine'} : {});
        try {
            const nativeSuppressor = battle[reverse ? 'p2' : 'p1'].active[0];
            const nativeOther = battle[reverse ? 'p1' : 'p2'].active[0];
            nativeSuppressor.hp = 1; nativeSuppressor.setStatus('psn');
            battle.field.setWeather('hail', nativeSuppressor);
            battle.choose('p1', 'move 1'); battle.choose('p2', 'move 1');
            assert.equal(nativeSuppressor.hp, 0); assert.equal(nativeOther.hp, 160);
            assert.equal(battle.field.weather, 'hail');
        } finally { battle.destroy(); }
    }
});

test('Forecast updates before weather residuals and returns to Normal when hail expires', () => {
    const x = fixture('hail');
    x.a.data = {...x.a.data, id: 351}; x.a.passiveAbility = 'Forecast';
    engine.applySwitchInEffects(x.a, x.state.sides.player, x.state.sides.enemy, x.state, x.b);
    assert.deepEqual(engine.getPokemonTypes(x.a), ['Ice']);
    x.end(); assert.equal(x.a.currentHp, 160);
    x.state.weather.turns = 1;
    const before = x.b.currentHp; x.end();
    assert.equal(x.b.currentHp, before, 'no residual on the expiration turn');
    assert.deepEqual(engine.getPokemonTypes(x.a), ['Normal']);
});

test('weather triggers a healing berry immediately, before lethal toxic damage', () => {
    const x = fixture('sandstorm', {currentHp: 81, status: 'badly_poison', heldItem: 'sitrus_berry'});
    x.a.__battle.toxicCounter = 8;
    x.end();
    assert.equal(x.a.currentHp, 31, '81 - 10 sand + 40 Sitrus - 80 toxic');
    assert.equal(x.a.heldItem, null);
    const battle = nativeBattle({item: 'Sitrus Berry'});
    try {
        const p = battle.p1.active[0]; p.hp = 81; p.setStatus('tox'); p.statusState.stage = 7;
        battle.field.setWeather('sandstorm', p);
        battle.choose('p1', 'move 1'); battle.choose('p2', 'move 1');
        assert.equal(p.hp, 31); assert.equal(p.item, '');
    } finally { battle.destroy(); }
});

test('weather bypasses Substitute, Protect and Endure without damaging the substitute', () => fixed(() => {
    for (const weather of ['sandstorm', 'hail']) for (const move of ['Endure', 'Protect']) {
        const x = fixture(weather, {currentHp: 1}, {}, [move]);
        x.a.__battle.substituteHp = 40;
        assert(x.cast(move).success);
        x.end();
        assert.equal(x.a.currentHp, 0, `${weather}/${move}`);
        assert.equal(x.a.__battle.substituteHp, 40, `${weather}/${move}`);
    }
}));

test('AI projects minimum weather damage, Slush Rush, persistent weather and expiry without live mutation', () => {
    const model = require('../server/game/battle/humanTrainerModel');
    for (const scenario of ['minimum', 'slush-rush', 'persistent', 'expiry', 'berry-before-toxic']) {
        const x = fixture('hail');
        if (scenario === 'minimum') x.a.maxHp = x.a.currentHp = 15;
        if (scenario === 'slush-rush') x.a.passiveAbility = 'Slush Rush';
        if (scenario === 'persistent') Object.assign(x.state.weather, {persistent: true, turns: 0});
        if (scenario === 'expiry') x.state.weather.turns = 1;
        if (scenario === 'berry-before-toxic') {
            Object.assign(x.a, {currentHp: 81, status: 'badly_poison', heldItem: 'sitrus_berry'});
            x.a.__battle.toxicCounter = 8;
        }
        const before = JSON.stringify([x.a, x.b, x.state]);
        const ctx = {field: x.state, ownSide: x.state.sides.player, enemySide: x.state.sides.enemy,
            chance: () => 1, damage: (p, q, move, side, state, extra) => engine.estimateDamage(p, q, move,
                {battleState: state, defenderSide: side, ...extra})};
        const projected = model.project(x.a, x.b, engine.getMoveByName('Splash'), engine.getMoveByName('Splash'), ctx);
        assert.equal(JSON.stringify([x.a, x.b, x.state]), before, `${scenario}: preview is read-only`);
        x.cast('Splash'); x.cast('Splash', x.b, x.a); x.end();
        assert.equal(projected.own.currentHp, x.a.currentHp, scenario);
        assert.equal(projected.foe.currentHp, x.b.currentHp, scenario);
        assert.equal(projected.own.heldItem, x.a.heldItem, scenario);
        assert.deepEqual(projected.field.weather, x.state.weather, scenario);
        if (scenario === 'minimum') assert.equal(projected.own.currentHp, 14);
        if (scenario === 'slush-rush') assert.equal(projected.own.currentHp, 150);
        if (scenario === 'persistent') assert.equal(projected.field.weather.kind, 'hail');
        if (scenario === 'expiry') assert.equal(projected.own.currentHp, 160);
        if (scenario === 'berry-before-toxic') assert.equal(projected.own.currentHp, 31);
    }
});
