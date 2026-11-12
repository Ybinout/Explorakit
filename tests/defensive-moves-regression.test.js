const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../server/game/battle/battleEngine');
const factory = require('../server/game/drift/pokemonFactory');
const resources = require('../server/game/battle/battleResources');

let nextId = 0;
function mon(moves = ['Splash'], extra = {}) {
    const pokemon = factory.create(143, 50, true);
    Object.assign(pokemon, {
        uuid: `defensive-moves-${++nextId}`, type1: 'Normal', type2: null,
        maxHp: 1000, currentHp: 1000, attack: 100, currentAttack: 100,
        defense: 100, currentDefense: 100, specialAttack: 100, currentSpecialAttack: 100,
        specialDefense: 100, currentSpecialDefense: 100, speed: 100, currentSpeed: 100,
        passiveAbility: null, heldItem: null, status: 'normal', abilities: moves,
        movePp: moves.map(resources.getMaxMovePp), ...extra
    });
    engine.ensureBattleData(pokemon);
    return pokemon;
}
function fixture(move, own = {}, foe = {}) {
    const a = mon([move], own), b = mon(['Splash'], foe), state = engine.createBattleState();
    const team = [a], enemyTeam = [b];
    function cast(name = move, user = a, target = b) {
        const forward = user === a;
        return engine.useattack(name, user, target, {battleState: state,
            attackerSide: state.sides[forward ? 'player' : 'enemy'],
            defenderSide: state.sides[forward ? 'enemy' : 'player'],
            attackerTeam: forward ? team : enemyTeam, defenderTeam: forward ? enemyTeam : team});
    }
    const end = () => engine.processEndOfRound(a, b, state.sides.player, state.sides.enemy, state);
    return {a, b, state, team, enemyTeam, cast, end};
}
function fixed(fn, value = .5) {
    const original = Math.random;
    Math.random = () => value;
    try { return fn(); } finally { Math.random = original; }
}

test('Foul Play applies Unaware to borrowed Attack like the native Gen7 simulator', () => fixed(() => {
    for (const stage of [-2, 2]) for (const userAbility of [null, 'Unaware']) for (const targetAbility of [null, 'Unaware']) {
        const x = fixture('Foul Play', {passiveAbility: userAbility}, {passiveAbility: targetAbility});
        x.b.__battle.statStages.attack = stage;
        const reference = structuredClone(x.b);
        reference.passiveAbility = null;
        if (targetAbility === 'Unaware') reference.__battle.statStages.attack = 0;
        const expected = engine.calculateDamage(x.a, reference, engine.getMoveByName('Foul Play'));
        assert.equal(x.cast().damage, expected, `Attack stage ${stage}`);
    }
    const {Battle} = require('@pkmn/sim');
    const damage = (userAbility, targetAbility, stage) => {
        const battle = new Battle({formatid: 'gen7customgame', seed: [1, 2, 3, 4]});
        try {
            battle.setPlayer('p1', {name: 'One', team: [{species: 'Sableye', ability: userAbility, moves: ['Foul Play']}]});
            battle.setPlayer('p2', {name: 'Two', team: [{species: 'Clefable', ability: targetAbility, moves: ['Splash']}]});
            battle.choose('p1', 'team 1'); battle.choose('p2', 'team 1');
            const target = battle.p2.active[0], hp = target.hp;
            target.boosts.atk = stage;
            battle.choose('p1', 'move 1'); battle.choose('p2', 'move 1');
            return hp - target.hp;
        } finally { battle.destroy(); }
    };
    const base = damage('Prankster', 'Cute Charm', 0);
    assert(damage('Prankster', 'Cute Charm', 2) > base);
    assert.equal(damage('Prankster', 'Unaware', 2), base);
    assert.equal(damage('Unaware', 'Cute Charm', 2), damage('Prankster', 'Cute Charm', 2));
}));

test('Taunt bypasses Substitute, cannot refresh itself, and lasts three opportunities to move', () => fixed(() => {
    const x = fixture('Taunt');
    x.b.__battle.substituteHp = 100;
    assert(x.cast().success);
    assert.equal(x.b.__battle.tauntTurns, 3);
    x.end();
    assert.equal(x.cast().success, false);
    assert.equal(x.b.__battle.tauntTurns, 2);
    const late = fixture('Taunt');
    late.cast('Splash', late.b, late.a);
    late.cast();
    late.end();
    assert.equal(late.b.__battle.tauntTurns, 3, 'an already-spent turn does not shorten Taunt');
}));

test('Roost removes Flying only until the round ends and only when healing succeeds', () => fixed(() => {
    for (const [type1, type2, expected] of [['Steel', 'Flying', ['Steel']], ['Ground', 'Flying', ['Ground']], ['Flying', null, ['Normal']]]) {
        const x = fixture('Roost', {type1, type2, currentHp: 200});
        assert(x.cast().success);
        assert.deepEqual(engine.getPokemonTypes(x.a), expected);
        assert(engine.calculateDamage(x.b, x.a, engine.getMoveByName('Earthquake')) > 0);
        x.end();
        assert.deepEqual(engine.getPokemonTypes(x.a), [type1, type2].filter(Boolean));
    }
    const full = fixture('Roost', {type1: 'Flying'});
    assert.equal(full.cast().success, false);
    assert.deepEqual(engine.getPokemonTypes(full.a), ['Flying']);
}));

test('Heal Bell respects Soundproof, cures only major status, and fails with nothing to cure', () => fixed(() => {
    const x = fixture('Heal Bell');
    x.a.__battle.confusionTurns = 3;
    x.a.__battle.infatuationTurns = 3;
    const sick = mon(['Splash'], {status: 'burn'}), soundproof = mon(['Splash'], {status: 'poison', passiveAbility: 'Soundproof'});
    x.team.push(sick, soundproof);
    assert(x.cast().success);
    assert.equal(sick.status, 'normal');
    assert.equal(soundproof.status, 'poison');
    assert.equal(x.a.__battle.confusionTurns, 2, 'ordinary turn-start confusion tick only');
    assert.equal(x.a.__battle.infatuationTurns, 2);
    assert.equal(x.cast().success, false);
}));

test('Defog obeys Protect and preserves Substitute against the evasion drop', () => fixed(() => {
    const protectedTarget = fixture('Defog');
    protectedTarget.b.__battle.protect = true;
    protectedTarget.state.sides.player.hazards.stealthRock = true;
    assert.equal(protectedTarget.cast().success, false);
    assert(protectedTarget.state.sides.player.hazards.stealthRock);
    const sub = fixture('Defog');
    sub.b.__battle.substituteHp = 100;
    sub.state.sides.player.hazards.stealthRock = true;
    sub.state.sides.enemy.screens.reflectTurns = 3;
    sub.state.sides.enemy.screens.tailwindTurns = 3;
    assert(sub.cast().success);
    assert.equal(sub.b.__battle.statStages.evasion, 0);
    assert.equal(sub.state.sides.player.hazards.stealthRock, false);
    assert.equal(sub.state.sides.enemy.screens.reflectTurns, 0);
    assert.equal(sub.state.sides.enemy.screens.tailwindTurns, 3);
}));

test('Scald thaws its user and Scald/Flamethrower thaw a frozen target after an HP hit', () => fixed(() => {
    const frozenUser = fixture('Scald', {status: 'freeze'});
    assert(frozenUser.cast().damage > 0);
    assert.equal(frozenUser.a.status, 'normal');
    for (const move of ['Scald', 'Flamethrower']) {
        const x = fixture(move, {}, {status: 'freeze'});
        assert(x.cast().damage > 0);
        assert.equal(x.b.status, 'normal', move);
        const sub = fixture(move, {}, {status: 'freeze'});
        sub.b.__battle.substituteHp = 500;
        sub.cast();
        assert.equal(sub.b.status, 'freeze');
    }
}));

test('Taunt and Will-O-Wisp report their immunities and Substitute failures honestly', () => fixed(() => {
    for (const ability of ['Oblivious', 'Aroma Veil']) {
        const x = fixture('Taunt', {}, {passiveAbility: ability});
        assert.equal(x.cast().success, false, ability);
        assert.equal(x.b.__battle.tauntTurns, 0);
    }
    for (const condition of ['fire', 'burn', 'substitute']) {
        const x = fixture('Will-O-Wisp');
        if (condition === 'fire') x.b.type1 = 'Fire';
        if (condition === 'burn') x.b.status = 'burn';
        if (condition === 'substitute') x.b.__battle.substituteHp = 100;
        assert.equal(x.cast().success, false, condition);
    }
}));

test('Brave Bird rounds recoil from real damage and respects Rock Head and Magic Guard', () => fixed(() => {
    let roundingCase = false;
    for (let attack = 90; attack < 110; attack++) {
        const x = fixture('Brave Bird', {attack, currentAttack: attack});
        const result = x.cast(), damage = result.damage + result.substituteDamage;
        if (damage % 3 === 2) roundingCase = true;
        assert.equal(1000 - x.a.currentHp, Math.round(damage / 3), `damage ${damage}`);
    }
    assert(roundingCase);
    for (const ability of ['Rock Head', 'Magic Guard']) {
        const x = fixture('Brave Bird', {passiveAbility: ability});
        assert(x.cast().damage > 0);
        assert.equal(x.a.currentHp, 1000);
    }
}));

test('Prankster status moves respect Dark typing, Psychic Terrain and Magic Bounce', () => fixed(() => {
    for (const move of ['Taunt', 'Will-O-Wisp']) {
        const dark = fixture(move, {passiveAbility: 'Prankster'}, {type1: 'Dark'});
        assert.equal(engine.getMovePriority(move, dark.a), 1);
        assert.equal(dark.cast().success, false);
        assert.equal(dark.b.status, 'normal');
        assert.equal(dark.b.__battle.tauntTurns, 0);
        const terrain = fixture(move, {passiveAbility: 'Prankster'});
        terrain.state.terrain = {kind: 'psychic_terrain', turns: 5};
        assert.equal(terrain.cast().success, false);
    }
    const recovery = fixture('Recover', {passiveAbility: 'Prankster', currentHp: 100});
    recovery.state.terrain = {kind: 'psychic_terrain', turns: 5};
    assert(recovery.cast().success);
    assert.equal(recovery.a.currentHp, 600);
    const bounce = fixture('Will-O-Wisp', {passiveAbility: 'Prankster', type1: 'Dark'}, {passiveAbility: 'Magic Bounce'});
    assert(bounce.cast().success);
    assert.equal(bounce.a.status, 'burn');
    assert.equal(bounce.b.status, 'normal');
    assert.equal(bounce.b.movePp[0], resources.getMaxMovePp('Splash'));
}));

test('Foul Play borrows Attack only; burn and Choice Band belong to its user', () => fixed(() => {
    const baseline = fixture('Foul Play', {attack: 1, currentAttack: 1}, {attack: 300, currentAttack: 300});
    const damage = baseline.cast().damage;
    const targetModifiers = fixture('Foul Play', {attack: 999, currentAttack: 999}, {attack: 300, currentAttack: 300, heldItem: 'choice_band', status: 'burn'});
    assert.equal(targetModifiers.cast().damage, damage);
    const burned = fixture('Foul Play', {status: 'burn'}, {attack: 300, currentAttack: 300});
    assert(burned.cast().damage < damage);
    const band = fixture('Foul Play', {heldItem: 'choice_band'}, {attack: 300, currentAttack: 300});
    assert(band.cast().damage > damage);
}));

test('Roost preserves persistent typing, expires on switch, and cannot bypass Heal Block', () => fixed(() => {
    const x = fixture('Roost', {type1: 'Ground', type2: 'Flying', currentHp: 100});
    x.a.__battle.tempTypes = ['Ghost', 'Flying'];
    x.cast();
    assert.deepEqual(engine.getPokemonTypes(x.a), ['Ghost']);
    x.a.__battle.tempTypes = ['Water'];
    assert.deepEqual(engine.getPokemonTypes(x.a), ['Water']);
    x.end();
    assert.deepEqual(engine.getPokemonTypes(x.a), ['Water']);
    const switched = fixture('Roost', {type1: 'Flying', currentHp: 100});
    switched.cast();
    require('../server/game/battle/battleTeam').switchPokemonByIndex([switched.a, mon()], 1);
    assert.deepEqual(engine.getPokemonTypes(switched.a), ['Flying']);
    const blocked = fixture('Roost', {type1: 'Flying', currentHp: 100});
    blocked.a.__battle.healBlockTurns = 3;
    blocked.a.abilities.push('Tackle'); blocked.a.movePp.push(35);
    assert.equal(blocked.cast().success, false);
    assert.deepEqual(engine.getPokemonTypes(blocked.a), ['Flying']);
}));

test('Defog reflection clears both hazard fields but only the reflected target’s screens', () => fixed(() => {
    const x = fixture('Defog', {}, {passiveAbility: 'Magic Bounce'});
    for (const side of Object.values(x.state.sides)) {
        side.hazards.stealthRock = true; side.hazards.spikes = 3;
        side.screens.reflectTurns = 5; side.screens.safeguardTurns = 5;
    }
    x.state.terrain = {kind: 'grassy_terrain', turns: 5};
    assert(x.cast().success);
    assert.equal(x.a.__battle.statStages.evasion, -1);
    assert.equal(x.b.__battle.statStages.evasion, 0);
    assert.equal(x.state.sides.player.hazards.spikes, 0);
    assert.equal(x.state.sides.enemy.hazards.spikes, 0);
    assert.equal(x.state.sides.player.screens.reflectTurns, 0);
    assert.equal(x.state.sides.enemy.screens.reflectTurns, 5);
    assert.equal(x.state.terrain.kind, 'grassy_terrain', 'Gen7 Defog preserves terrain');
}));

for (const [move, expected] of [['Acid Armor', {defense: 2}], ['Calm Mind', {specialAttack: 1, specialDefense: 1}], ['Swords Dance', {attack: 2}]]) {
    test(`${move} applies the expected self boosts and respects the stage cap`, () => fixed(() => {
        const x = fixture(move);
        x.cast();
        for (const [stat, stage] of Object.entries(expected)) assert.equal(x.a.__battle.statStages[stat], stage);
        for (const stat of Object.keys(expected)) x.a.__battle.statStages[stat] = 6;
        x.cast();
        for (const stat of Object.keys(expected)) assert.equal(x.a.__battle.statStages[stat], 6);
    }));
}

for (const move of ['Recover', 'Soft-Boiled']) {
    test(`${move} heals half HP, fails at full HP and is blocked by Taunt`, () => fixed(() => {
        const x = fixture(move, {currentHp: 100});
        assert(x.cast().success); assert.equal(x.a.currentHp, 600);
        x.a.currentHp = 1000;
        assert.equal(x.cast().success, false);
        const taunted = fixture(move, {currentHp: 100});
        taunted.a.__battle.tauntTurns = 3;
        // Retain an ordinary legal move so this is a rejected status action,
        // not the intentional all-moves-disabled Struggle fallback.
        taunted.a.abilities.push('Tackle'); taunted.a.movePp.push(35);
        assert.equal(taunted.cast().success, false);
        assert.equal(taunted.a.currentHp, 100);
    }));
}

test('Facade doubles under toxic poison and Heal Bell allows Toxic Orb to reactivate', () => fixed(() => {
    const normal = fixture('Facade');
    const poisoned = fixture('Facade', {status: 'badly_poison'});
    assert.equal(require('../server/game/battle/moveDamageRules').power(engine.getMoveByName('Facade'), poisoned.a, poisoned.b), 140);
    assert(poisoned.cast().damage > normal.cast().damage);
    const x = fixture('Heal Bell', {}, {type1: 'Water'});
    const ally = mon(['Facade'], {status: 'badly_poison', passiveAbility: 'Poison Heal', heldItem: 'toxic_orb', currentHp: 400});
    x.team.push(ally);
    x.cast();
    assert.equal(ally.status, 'normal');
    engine.processEndOfRound(ally, x.b, x.state.sides.player, x.state.sides.enemy, x.state);
    assert.equal(ally.status, 'badly_poison');
    const hp = ally.currentHp;
    engine.processEndOfRound(ally, x.b, x.state.sides.player, x.state.sides.enemy, x.state);
    assert.equal(ally.currentHp - hp, 125);
}));

test('Earthquake obeys Flying, Levitate, Grassy Terrain and an airborne balloon', () => fixed(() => {
    const damage = fixture('Earthquake').cast().damage;
    for (const foe of [{type1: 'Flying'}, {passiveAbility: 'Levitate'}, {heldItem: 'air_balloon'}]) {
        assert.equal(fixture('Earthquake', {}, foe).cast().damage, 0);
    }
    const grassy = fixture('Earthquake'); grassy.state.terrain = {kind: 'grassy_terrain', turns: 5};
    assert(grassy.cast().damage < damage);
    assert(fixture('Earthquake', {passiveAbility: 'Mold Breaker'}, {passiveAbility: 'Levitate'}).cast().damage > 0);
}));

test('Psyshock uses special offense against physical defense, even with Assault Vest', () => fixed(() => {
    const ordinary = fixture('Psyshock', {}, {defense: 50, currentDefense: 50, specialDefense: 400, currentSpecialDefense: 400});
    const vest = fixture('Psyshock', {}, {...ordinary.b, heldItem: 'assault_vest'});
    assert.equal(vest.cast().damage, ordinary.cast().damage);
    const special = fixture('Moonblast', {}, {heldItem: 'assault_vest'});
    assert(special.cast().damage < fixture('Moonblast').cast().damage);
}));

for (const [move, status, stat] of [['Moonblast', null, 'specialAttack'], ['Scald', 'burn'], ['Flamethrower', 'burn'], ['Ice Beam', 'freeze']]) {
    test(`${move} applies its native secondary effect, blocked by Shield Dust and Substitute`, () => fixed(() => {
        for (const guard of ['none', 'shield', 'substitute']) {
            const x = fixture(move, {}, {type1: 'Normal'});
            if (guard === 'shield') x.b.passiveAbility = 'Shield Dust';
            if (guard === 'substitute') x.b.__battle.substituteHp = 500;
            x.cast();
            if (status) assert.equal(x.b.status, guard === 'none' ? status : 'normal');
            if (stat) assert.equal(x.b.__battle.statStages[stat], guard === 'none' ? -1 : 0);
        }
    }, .01));
}

test('Stealth Rock stays on the opposing side, cannot stack, and Boots protect entry', () => fixed(() => {
    const x = fixture('Stealth Rock');
    assert(x.cast().success); assert.equal(x.cast().success, false);
    assert.equal(x.state.sides.player.hazards.stealthRock, false);
    for (const boots of [false, true]) {
        const incoming = mon(['Splash'], {type1: 'Fire', type2: 'Flying', heldItem: boots ? 'heavy_duty_boots' : null});
        engine.applySwitchInEffects(incoming, x.state.sides.enemy, x.state.sides.player, x.state, x.a);
        assert.equal(incoming.currentHp, boots ? 1000 : 500);
    }
}));

for (const type of ['trainer', 'arena', 'pvp']) test(`${type}: real queued Roost removes Flying before the reply and restores it after the round`, () => fixed(() => {
    const {DriftBattle} = require('../server/game/drift/driftBattle');
    const user = mon(['Roost'], {type1: 'Steel', type2: 'Flying', currentHp: 200, speed: 200, currentSpeed: 200});
    const foe = mon(['Earthquake']);
    const player = (id, pokemon) => ({userId: id, socketId: String(id), alive: true, currentmap: 'route1',
        run: {mode: 'colosseum'}, equipe: {pokemons: [pokemon, mon()]}, items: {}, money: 0,
        drifts: [], equipped: [], defeated: new Set()});
    const a = player(1, user), b = player(2, foe); b.npc = true;
    const battle = new DriftBattle(a, b, {type, emit: () => {}, random: () => .5, now: () => 0, paceMs: 0,
        rules: {rewards: false, report: false, permanentDeaths: false}});
    try {
        battle.state.weather = {kind: null, turns: 0};
        battle.pending.set(b, {action: 'attack', number: 0});
        assert(battle.action(a, {action: 'attack', number: 0, turnId: battle.token}));
        assert(user.currentHp < 700 && user.currentHp > 200, 'Earthquake hits the healed Steel user');
        assert.deepEqual(engine.getPokemonTypes(user), ['Steel', 'Flying']);
        assert.equal(battle.state.turn, 2);
        assert.equal(user.movePp[0], resources.getMaxMovePp('Roost') - 1);
    } finally { battle.finish(null, 'closed'); }
}));

test('AI projects Roost typing and the incoming Earthquake without mutating live state', () => fixed(() => {
    const model = require('../server/game/battle/humanTrainerModel');
    const x = fixture('Roost', {type1: 'Steel', type2: 'Flying', currentHp: 200});
    x.b.abilities = ['Earthquake']; x.b.movePp = [10];
    const before = JSON.stringify(x);
    const ctx = {field: x.state, ownSide: x.state.sides.player, enemySide: x.state.sides.enemy,
        chance: () => 1, damage: (p, q, move, side, state, extra) => engine.estimateDamage(p, q, move, {battleState: state, defenderSide: side, ...extra})};
    const out = model.project(x.a, x.b, engine.getMoveByName('Roost'), engine.getMoveByName('Earthquake'), ctx, {first: true});
    assert.equal(JSON.stringify(x), before);
    x.cast(); x.cast('Earthquake', x.b, x.a); x.end();
    assert.equal(out.own.currentHp, x.a.currentHp);
    assert.deepEqual(model.types(out.own), ['Steel', 'Flying']);
}));

test('Doubles native simulator resolves Roost before Earthquake and restores Flying', () => {
    const {DoublesBattle} = require('../server/game/doubles/doublesBattle');
    const skarm = factory.create(227, 50, true);
    Object.assign(skarm, {abilities: ['Roost'], movePp: [10], heldItem: null, passiveAbility: 'Sturdy'});
    const players = [
        {id: 'a', username: 'One', equipe: {pokemons: [skarm, mon(['Splash'], {passiveAbility: 'No Ability'})]}},
        {id: 'b', username: 'Two', equipe: {pokemons: [mon(['Earthquake'], {passiveAbility: 'No Ability'}), mon(['Splash'], {passiveAbility: 'No Ability'})]}}
    ];
    const battle = new DoublesBattle(...players, {emit: () => {}});
    try {
        const user = battle.sim.p1.active[0];
        user.hp = user.maxhp - 20; user.storedStats.spe = 999;
        battle.sim.choose('p1', 'move Roost, move Splash');
        battle.sim.choose('p2', 'move Earthquake, move Splash');
        assert(user.hp < user.maxhp, 'Earthquake hits after Roost removes Flying');
        assert.deepEqual(user.getTypes(), ['Steel', 'Flying']);
        assert.equal(battle.sim.turn, 2);
        assert(battle.sim.log.some(line => line.includes('|move: Roost')));
    } finally { battle.sim.destroy(); }
});

for (const reactive of [false, true]) test(`Raid native Foul Play uses the boss’s boosted Attack (reactive=${reactive})`, () => {
    const {RaidBattle} = require('../server/game/raids/RaidBattle');
    const battle = new RaidBattle([0, 1, 2, 3].map(i => ({ownerId: 1, ownerName: 'One', pokemon: mon([i === 0 ? 'Foul Play' : 'Splash'], {passiveAbility: 'No Ability'})})), mon(['Splash'], {passiveAbility: 'No Ability'}),
        {reactive, seed: [1, 2, 3, 4], now: () => 0});
    try {
        const boss = battle.bossPokemon, initial = boss.hp;
        const base = battle.sim.actions.getDamage(battle.sim.p1.active[0], boss, 'Foul Play');
        boss.boosts.atk = 2;
        assert(battle.sim.actions.getDamage(battle.sim.p1.active[0], boss, 'Foul Play') > base);
        if (reactive) {
            let actions = 0;
            while (battle.sim.turn < 2 && !battle.finished && actions++ < 10) {
                const slot = battle.view(1).currentSlot;
                assert(battle.action(1, {token: battle.token, slot, action: 'attack', moveIndex: 0, targetLoc: 1}));
            }
        } else for (let slot = 0; slot < 4; slot++) {
            const resolved = battle.action(1, {token: battle.token, slot, action: 'attack', moveIndex: 0, targetLoc: 1});
            if (slot < 3) assert(battle.pending[slot]);
            else assert(resolved);
        }
        assert(boss.hp < initial);
        assert.equal(battle.sim.p1.active[0].moveSlots[0].pp, resources.getMaxMovePp('Foul Play') - 1);
        assert.equal(battle.sim.turn, 2);
    } finally { battle.sim.destroy(); }
});
