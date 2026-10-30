const test = require('node:test');
const assert = require('node:assert/strict');
const {DriftBattle} = require('../server/game/drift/driftBattle');
const factory = require('../server/game/drift/pokemonFactory');
const resources = require('../server/game/battle/battleResources');

function pokemon(id, moves = ['Splash'], props = {}) {
    return Object.assign(factory.create(id, 50, true), {
        maxHp: 160, currentHp: 160, passiveAbility: null, heldItem: null,
        status: 'normal', abilities: moves, movePp: moves.map(resources.getMaxMovePp),
        __battle: {statStages: {}}
    }, props);
}
const modes = [
    {name: 'Rift wild', type: 'wild', npc: true, mode: 'rift', permanent: true},
    {name: 'Rift PvP', type: 'pvp', npc: false, mode: 'rift', permanent: true},
    {name: 'Colosseum', type: 'arena', npc: true, mode: 'colosseum', permanent: true},
    {name: 'Super Tournament', type: 'trainer', npc: true, permanent: false}
];
function setup(mode, own, foe, reserves = [], foeReserves = []) {
    const player = (userId, list) => ({userId, socketId: `round-${userId}`, equipe: {pokemons: list},
        items: {}, money: 0, drifts: [], equipped: [], defeated: new Set(), chain: 0});
    const a = player(1, [own, ...reserves]), b = player(2, [foe, ...foeReserves]);
    a.run = {mode: mode.mode}; b.npc = mode.npc;
    const events = [];
    const battle = new DriftBattle(a, b, {type: mode.type, now: () => 0, random: () => .99, paceMs: 0,
        rules: {report: false, rewards: false, permanentDeaths: mode.permanent},
        emit: (p, event, data) => events.push({userId: p.userId, event, data: JSON.parse(JSON.stringify(data))})});
    return {a, b, battle, events};
}
function resolve(battle, actions) {battle.awaiting = false; battle.resolveAttacks(actions);}
const action = (p, index, name) => ({index, pokemonUuid: p.uuid, name});
const texts = events => events.filter(e => e.userId === 1 && e.event === 'battleText').map(e => e.data.message);

for (const mode of modes) for (const reserve of [false, true]) {
    test(`${mode.name}: Curse from exactly 1 HP ticks before ${reserve ? 'replacement' : 'final defeat'}`, () => {
        const caster = pokemon(94, ['Curse'], {currentHp: 1}), foe = pokemon(143), bench = pokemon(25);
        const {a, b, battle, events} = setup(mode, caster, foe, reserve ? [bench] : []);
        resolve(battle, [action(caster, 0, 'Curse'), action(foe, 1, 'Splash')]);
        assert.equal(caster.currentHp, 0);
        assert.equal(caster.movePp[0], 9);
        assert.equal(foe.currentHp, 120);
        assert.equal(foe.movePp[0], resources.getMaxMovePp('Splash'), 'a KO defender cannot be attacked');
        assert.equal(battle.state.turn, 2);
        assert.equal(texts(events).filter(t => /souffre de la malediction/.test(t)).length, 1);
        if (reserve) {
            assert.equal(battle.finished, false);
            assert.equal(battle.active(0), caster);
            battle.tick(); battle.tick();
            assert.equal(battle.replacementPhase, true);
            assert.equal(foe.currentHp, 120, 'waiting for a choice does not repeat residuals');
            const token = battle.token;
            assert(battle.action(a, {action: 'change', number: 1, turnId: token}));
            assert.equal(battle.active(0), bench);
            assert.equal(foe.currentHp, 120);
            assert.equal(battle.state.turn, 2, 'mandatory replacement is not a new turn');
            assert(battle.action(a, {action: 'attack', number: 0, turnId: battle.token}));
            if (!b.npc) assert(battle.action(b, {action: 'attack', number: 0, turnId: battle.token}));
            assert.equal(foe.currentHp, 80, 'curse remains after the caster leaves');
            battle.finish(null, 'fled');
        } else {
            assert.equal(battle.finished, true);
            const messages = events.filter(e => e.userId === 1);
            assert(messages.findIndex(e => e.event === 'battleText' && /souffre de la malediction/.test(e.data.message))
                < messages.findIndex(e => e.event === 'endbattle'));
            assert.equal(messages.find(e => e.event === 'endbattle').data.playerWon, false);
        }
    });
}

const residuals = [
    {name: 'Curse', damage: 40, apply: p => {p.__battle.curseSource = 'old-source';}},
    {name: 'poison', damage: 20, apply: p => {p.status = 'poison';}},
    {name: 'toxic', damage: 10, apply: p => {p.status = 'badly_poison';}},
    {name: 'burn', damage: 10, apply: p => {p.status = 'burn';}},
    {name: 'sandstorm', damage: 10, apply: (_p, b) => {b.state.weather = {kind: 'sandstorm', turns: 3};}},
    {name: 'hail', damage: 10, apply: (_p, b) => {b.state.weather = {kind: 'hail', turns: 3};}}
];
for (const mode of modes) for (const effect of residuals) for (const reserve of [false, true]) {
    test(`${mode.name}: ${effect.name} ticks when the opposing active is KO, reserve=${reserve}`, () => {
        const own = pokemon(94, ['Splash'], {currentHp: 1}), foe = pokemon(143, ['Dragon Rage']);
        const {battle} = setup(mode, own, foe, reserve ? [pokemon(25)] : []);
        effect.apply(foe, battle);
        resolve(battle, [action(foe, 1, 'Dragon Rage'), action(own, 0, 'Splash')]);
        assert.equal(own.currentHp, 0);
        assert.equal(own.movePp[0], resources.getMaxMovePp('Splash'), 'KO actor spends no PP');
        assert.equal(foe.currentHp, 160 - effect.damage);
        assert.equal(battle.state.turn, 2);
        if (['sandstorm', 'hail'].includes(effect.name)) assert.equal(battle.state.weather.turns, 2);
        if (!battle.finished) battle.finish(null, 'fled');
    });
}

for (const mode of modes) test(`${mode.name}: non-damaging moves and sleep still tick poison; invalid commands and fleeing do not`, () => {
    const own = pokemon(94, ['Splash'], {status: 'sleep'}), foe = pokemon(143);
    const {a, b, battle} = setup(mode, own, foe);
    own.__battle.sleepTurns = 3; foe.status = 'poison';
    const token = battle.token;
    assert.equal(battle.action(a, {action: 'attack', number: 99, turnId: token}), false);
    assert.equal(foe.currentHp, 160);
    assert(battle.action(a, {action: 'attack', number: 0, turnId: token}));
    if (!b.npc) assert(battle.action(b, {action: 'attack', number: 0, turnId: token}));
    assert.equal(foe.currentHp, 140);
    assert.equal(own.movePp[0], resources.getMaxMovePp('Splash'));
    assert.equal(battle.state.turn, 2);
    battle.tick();
    assert(battle.action(a, {action: 'flee', turnId: battle.token}));
    if (!b.npc) assert(battle.action(b, {action: 'attack', number: 0, turnId: battle.token}));
    assert.equal(foe.currentHp, 140);
    assert.equal(battle.state.turn, 2);
});

test('NPC KO replacement happens after residuals: reserve takes no poison tick and entry weather keeps its full duration', () => {
    const own = pokemon(94, ['Dragon Rage'], {status: 'burn'}), foe = pokemon(143, ['Splash'], {currentHp: 1});
    const reserve = pokemon(9, ['Splash'], {status: 'poison', passiveAbility: 'Drizzle'});
    const {battle, events} = setup(modes[2], own, foe, [], [reserve]);
    resolve(battle, [action(own, 0, 'Dragon Rage'), action(foe, 1, 'Splash')]);
    assert.equal(foe.currentHp, 0);
    assert.equal(own.currentHp, 150);
    assert.equal(battle.active(1), reserve);
    assert.equal(reserve.currentHp, 160);
    assert.equal(reserve.movePp[0], resources.getMaxMovePp('Splash'));
    assert.equal(battle.state.weather.kind, 'rain');
    assert.equal(battle.state.weather.turns, 5);
    assert.equal(texts(events).filter(t => /poison/.test(t)).length, 0);
    battle.finish(null, 'fled');
});

for (const effect of residuals) test(`a terminal ${effect.name} KO resolves once, including a double KO`, () => {
    const own = pokemon(94, ['Splash'], {currentHp: 1}), foe = pokemon(143, ['Dragon Rage'], {currentHp: effect.damage});
    const {battle, events} = setup(modes[1], own, foe);
    effect.apply(foe, battle);
    resolve(battle, [action(foe, 1, 'Dragon Rage'), action(own, 0, 'Splash')]);
    assert.equal(own.currentHp, 0); assert.equal(foe.currentHp, 0);
    assert.equal(battle.finished, true);
    const end = events.filter(e => e.userId === 1 && e.event === 'endbattle');
    assert.equal(end.length, 1);
    assert.equal(end[0].data.draw, true);
});

for (const kind of ['leftovers', 'aquaRing', 'ingrain', 'perishSong', 'trapping', 'leechSeed']) {
    test(`${kind} is processed even with a fainted opponent`, () => {
        const own = pokemon(94, ['Splash'], {currentHp: 1}), foe = pokemon(143, ['Dragon Rage'], {currentHp: 80});
        const {battle, events} = setup(modes[2], own, foe);
        let expected = 90;
        if (kind === 'leftovers') foe.heldItem = 'leftovers';
        if (kind === 'aquaRing' || kind === 'ingrain') foe.__battle[kind] = true;
        if (kind === 'perishSong') {foe.__battle.perishSongTurns = 1; expected = 0;}
        if (kind === 'trapping') {foe.__battle.trappedTurns = 2; expected = 60;}
        if (kind === 'leechSeed') {foe.__battle.leechSeedSource = own; expected = 60;}
        resolve(battle, [action(foe, 1, 'Dragon Rage'), action(own, 0, 'Splash')]);
        assert.equal(own.currentHp, 0); assert.equal(foe.currentHp, expected);
        assert.equal(battle.state.turn, 2); assert.equal(battle.finished, true);
        if (kind === 'leechSeed') assert(texts(events).some(t => /Vampigraine/.test(t)), 'damage must remain visible without a living heal recipient');
    });
}

test('Leech Seed survives the original user dying and heals its chosen replacement on later turns', () => {
    const own = pokemon(94, ['Splash'], {currentHp: 1}), bench = pokemon(25, ['Splash'], {currentHp: 80});
    const foe = pokemon(143, ['Dragon Rage']);
    const {a, battle} = setup(modes[2], own, foe, [bench]);
    foe.__battle.leechSeedSource = own;
    resolve(battle, [action(foe, 1, 'Dragon Rage'), action(own, 0, 'Splash')]);
    assert.equal(foe.currentHp, 140); assert.equal(own.currentHp, 0);
    battle.tick(); assert(battle.action(a, {action: 'change', number: 1, turnId: battle.token}));
    assert.equal(bench.currentHp, 80, 'replacement choice grants no extra heal or damage');
    assert(battle.action(a, {action: 'attack', number: 0, turnId: battle.token}));
    assert.equal(foe.currentHp, 120);
    assert.equal(bench.currentHp, 60, '80 - Dragon Rage 40 + seed drain 20');
    battle.finish(null, 'fled');
});

test('a failed Ball consumes a turn: poison still ticks after the wild attack knocks out the thrower', () => {
    const own = pokemon(94, ['Splash'], {currentHp: 1}), foe = pokemon(143, ['Dragon Rage'], {status: 'poison'});
    const {a, battle} = setup(modes[0], own, foe, [pokemon(25)]);
    a.items.pokeball = 1;
    assert(battle.action(a, {action: 'bag', itemKey: 'pokeball', turnId: battle.token}));
    assert.equal(a.items.pokeball, 0);
    assert.equal(own.currentHp, 0); assert.equal(foe.currentHp, 140);
    assert.equal(own.movePp[0], resources.getMaxMovePp('Splash'));
    assert.equal(battle.state.turn, 2);
    battle.finish(null, 'fled');
});

test('a voluntary switch into lethal hazards still closes the turn before asking for a replacement', () => {
    const own = pokemon(94), fragile = pokemon(25, ['Splash'], {currentHp: 1});
    const foe = pokemon(143, ['Dragon Rage'], {status: 'poison'});
    const {a, battle} = setup(modes[2], own, foe, [fragile]);
    battle.sides[0].hazards.spikes = 1;
    assert(battle.action(a, {action: 'change', number: 1, turnId: battle.token}));
    assert.equal(fragile.currentHp, 0);
    assert.equal(foe.currentHp, 140);
    assert.equal(foe.movePp[0], resources.getMaxMovePp('Dragon Rage'), 'cannot attack an entrant already KO from hazards');
    assert.equal(battle.state.turn, 2);
    battle.tick(); assert.equal(battle.replacementPhase, true);
    assert.equal(foe.currentHp, 140);
    battle.finish(null, 'fled');
});

for (const mode of modes) test(`${mode.name}: Magic Guard still blocks indirect damage`, () => {
    const own = pokemon(94, ['Splash'], {currentHp: 1}), foe = pokemon(143, ['Dragon Rage'], {passiveAbility: 'Magic Guard', status: 'poison'});
    const {battle} = setup(mode, own, foe);
    foe.__battle.curseSource = own.uuid;
    battle.state.weather = {kind: 'hail', turns: 3};
    resolve(battle, [action(foe, 1, 'Dragon Rage'), action(own, 0, 'Splash')]);
    assert.equal(own.currentHp, 0); assert.equal(foe.currentHp, 160);
    assert.equal(battle.state.turn, 2); assert.equal(battle.state.weather.turns, 2);
});

test('an automatic pivot that KOs the last opponent still runs residuals on its entrant before the result', () => {
    const own = pokemon(25, ['Volt Switch']), bench = pokemon(94, ['Splash'], {currentHp: 80, status: 'poison'});
    const foe = pokemon(143, ['Splash'], {currentHp: 1});
    const {a, battle, events} = setup(modes[2], own, foe, [bench]);
    assert(battle.action(a, {action: 'attack', number: 0, turnId: battle.token}));
    assert.equal(foe.currentHp, 0);
    assert.equal(bench.currentHp, 60);
    assert.equal(battle.state.turn, 2); assert.equal(battle.finished, true);
    assert.equal(events.filter(e => e.userId === 1 && e.event === 'endbattle').length, 1);
});

test('a pivot entrant KO by hazards closes that turn instead of carrying residuals across replacement choices', () => {
    const own = pokemon(94, ['Teleport']), fragile = pokemon(25, ['Splash'], {currentHp: 1});
    const foe = pokemon(143, ['Splash'], {status: 'poison'});
    const {a, battle} = setup(modes[2], own, foe, [fragile]);
    battle.sides[0].hazards.spikes = 1;
    assert(battle.action(a, {action: 'attack', number: 0, turnId: battle.token}));
    assert.equal(battle.replacementPhase, true); assert.equal(battle.state.turn, 1);
    assert(battle.action(a, {action: 'change', number: 1, turnId: battle.token}));
    assert.equal(fragile.currentHp, 0); assert.equal(foe.currentHp, 140);
    assert.equal(battle.state.turn, 2); assert.equal(battle.finished, false);
    battle.tick(); assert.equal(battle.replacementPhase, true);
    assert(battle.action(a, {action: 'change', number: 1, turnId: battle.token}));
    assert.equal(battle.active(0), own); assert.equal(foe.currentHp, 140);
    assert.equal(battle.state.turn, 2);
    battle.finish(null, 'fled');
});
