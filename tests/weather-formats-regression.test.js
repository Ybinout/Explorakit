const test = require('node:test');
const assert = require('node:assert/strict');
const {make} = require('../scripts/calibrateCorruptionRaids');
const {DoublesBattle} = require('../server/game/doubles/doublesBattle');
const {RaidBattle} = require('../server/game/raids/RaidBattle');
const codec = require('../server/game/drift/checkpointCodec');
const engine = require('../server/game/battle/battleEngine');
const {calculate} = require('../server/game/strategy/damageCalculator');

const seed = [1, 2, 3, 4];
const formats = ['doubles', 'raid ordinary', 'raid reactive'];
function mon(id = 143, moves = ['Splash'], ability = 'Keen Eye') {
    const p = make(id, 100, 4, moves, ability);
    p.heldItem = null;
    return p;
}
function fixture(format, {allies, foes} = {}) {
    allies ||= [mon(143, ['Thunderbolt', 'Psyshock', 'Tackle', 'Splash']), mon(), mon(), mon()];
    foes ||= [mon(185), mon()];
    const battle = format === 'doubles'
        ? new DoublesBattle(
            {id: 'weather-one', username: 'One', equipe: {pokemons: allies.slice(0, 2)}},
            {id: 'weather-two', username: 'Two', equipe: {pokemons: foes.slice(0, 2)}},
            {emit() {}, now: () => 0})
        : new RaidBattle(allies.map(pokemon => ({ownerId: 1, ownerName: 'One', pokemon})), foes[0],
            {reactive: format === 'raid reactive', seed, now: () => 0});
    battle.sim.resetRNG(seed);
    return battle;
}
function setWeather(b, kind) {
    if (b.sim.field.weather === (kind || '')) return;
    if (kind) assert(b.sim.field.setWeather(kind, b.sim.p1.active[0]));
    else b.sim.field.clearWeather();
}
function damage(b, move = 'Thunderbolt', target = b.sim.p2.active[0]) {
    b.sim.resetRNG(seed);
    const attack = b.sim.dex.getActiveMove(move);
    attack.willCrit = false;
    return b.sim.actions.getDamage(b.sim.p1.active[0], target, attack);
}
// Go through the actual public action boundary in each raid mode, including
// reactive decision pauses. The native engine resolves the residual queue once.
function round(b, moveIndex = 0) {
    const turn = b.sim.turn;
    b.sim.resetRNG(seed);
    if (b instanceof DoublesBattle) {
        const move = b.sim.dex.moves.get(b.sim.p1.active[0].moveSlots[moveIndex].id);
        const target = ['normal', 'any', 'adjacentFoe'].includes(move.target) ? ' 1' : '';
        assert(b.sim.choose('p1', `move ${moveIndex + 1}${target}, move 1`));
        assert(b.sim.choose('p2', 'move 1, move 1'));
    } else if (b.flowVersion === 2) {
        let actions = 0;
        while (b.sim.turn === turn && !b.finished && actions++ < 8) {
            const slot = b.view(1).currentSlot;
            assert(slot >= 0);
            b.action(1, {token: b.token, slot, action: 'attack', moveIndex: slot === 0 ? moveIndex : 0, targetLoc: 1});
        }
    } else {
        for (let slot = 0; slot < 4; slot++) if (b.sim.p1.active[slot].hp && !b.sim.p1.active[slot].m.retired) {
            b.action(1, {token: b.token, slot, action: 'attack', moveIndex: slot === 0 ? moveIndex : 0, targetLoc: 1});
        }
    }
    assert.equal(b.sim.turn, turn + 1, 'one complete native round');
}
function dispose(...battles) { for (const b of battles) b.sim.destroy(); }

for (const format of formats) {
    test(`${format}: Rock gets exactly one native sand SpD boost, and real special damage decreases`, () => {
        const dry = fixture(format), sand = fixture(format);
        try {
            const a = dry.sim.p2.active[0], b = sand.sim.p2.active[0];
            setWeather(sand, 'sandstorm');
            assert.equal(b.getStat('spd'), sand.sim.modify(a.getStat('spd'), 1.5));
            assert.equal(b.getStat('def'), a.getStat('def'));
            assert.equal(damage(sand, 'Psyshock'), damage(dry, 'Psyshock'), 'Psyshock uses Defense');
            assert.equal(damage(sand, 'Tackle'), damage(dry, 'Tackle'), 'physical attacks are unchanged');
            assert(damage(sand) < damage(dry));
            // Use real move resolution for Mold Breaker's suppression lifecycle.
            dry.sim.p1.active[0].setAbility('Mold Breaker');
            sand.sim.p1.active[0].setAbility('Mold Breaker');
            const dryHp = a.hp, sandHp = b.hp;
            round(dry); round(sand);
            const normalHit = dryHp - a.hp, sandHit = sandHp - b.hp;
            assert(normalHit > 0 && sandHit > 0);
            assert(sandHit < normalHit * .75 && sandHit > normalHit * .6,
                `one 1.5x defense modifier, not a duplicated bonus: ${normalHit} -> ${sandHit}`);
            assert.equal(sand.sim.p1.active[0].moveSlots[0].pp, dry.sim.p1.active[0].moveSlots[0].pp);
        } finally { dispose(dry, sand); }
    });

    test(`${format}: sand follows current types and survives crits, stages and Mold Breaker`, () => {
        const b = fixture(format);
        try {
            const attacker = b.sim.p1.active[0], defender = b.sim.p2.active[0];
            defender.boosts.spd = 2;
            const base = defender.getStat('spd');
            setWeather(b, 'sandstorm');
            assert.equal(defender.getStat('spd'), b.sim.modify(base, 1.5));
            attacker.setAbility('Mold Breaker');
            const hit = kind => {
                setWeather(b, kind);
                b.sim.resetRNG(seed);
                const move = b.sim.dex.getActiveMove('Thunderbolt'); move.willCrit = true;
                return b.sim.actions.getDamage(attacker, defender, move);
            };
            assert(hit('sandstorm') < hit(null), 'crits and Mold Breaker do not remove weather');
            setWeather(b, 'sandstorm');
            defender.setType(['Water']);
            assert.equal(defender.getStat('spd'), base, 'Soak-like loss of Rock removes the bonus');
            defender.setType(['Rock', 'Flying']);
            assert.equal(defender.getStat('spd'), b.sim.modify(base, 1.5));
            defender.hp--;
            b.sim.actions.useMove('Roost', defender);
            assert.deepEqual(defender.getTypes(), ['Rock']);
            assert.equal(defender.getStat('spd'), b.sim.modify(base, 1.5), 'Roost retains Rock');
        } finally { dispose(b); }
    });

    test(`${format}: old hail chips 1/16 once per round and gives Ice no Defense boost`, () => {
        const b = fixture(format, {allies: [mon(), mon(362), mon(), mon()], foes: [mon(), mon()]});
        try {
            const ice = b.sim.p1.active[1], plain = b.sim.p1.active[0], boss = b.sim.p2.active[0];
            const before = b.sim.getAllActive().map(p => ({p, hp: p.hp}));
            const defense = ice.getStat('def'), plainDamage = damage(b, 'Tackle', ice);
            setWeather(b, 'hail');
            assert.equal(ice.getStat('def'), defense);
            assert.equal(damage(b, 'Tackle', ice), plainDamage);
            round(b);
            for (const {p, hp} of before) assert.equal(hp - p.hp,
                p.hasType('Ice') ? 0 : Math.max(1, Math.floor(p.baseMaxhp / 16)), p.name);
            assert(plain.hp < plain.maxhp);
            assert(boss.hp < boss.maxhp, 'the raid boss also receives ordinary weather residuals');
            assert.equal(b.sim.field.weather, 'hail');
        } finally { dispose(b); }
    });

    test(`${format}: hail respects native protections; non-Ice Slush Rush is not an immunity`, () => {
        for (const ability of ['Overcoat', 'Magic Guard', 'Snow Cloak', 'Ice Body', 'Slush Rush']) {
            const b = fixture(format, {allies: [mon(143, ['Splash'], ability), mon(), mon(), mon()]});
            try {
                const p = b.sim.p1.active[0];
                p.hp -= 100;
                const before = p.hp, tick = Math.max(1, Math.floor(p.baseMaxhp / 16));
                setWeather(b, 'hail'); round(b);
                assert.equal(p.hp - before, ability === 'Ice Body' ? tick : ability === 'Slush Rush' ? -tick : 0, ability);
            } finally { dispose(b); }
        }
    });

    for (const ability of ['Cloud Nine', 'Air Lock']) test(`${format}: ${ability} on a non-target ally suppresses all weather without erasing it`, () => {
        const allies = [mon(), mon(), mon(), mon()];
        allies[format === 'doubles' ? 1 : 3] = mon(143, ['Splash'], ability);
        let b = fixture(format, {allies});
        try {
            const base = b.sim.p2.active[0].getStat('spd'), neutral = damage(b);
            setWeather(b, 'sandstorm');
            assert.equal(b.sim.field.weather, 'sandstorm');
            assert.equal(b.sim.field.effectiveWeather(), '');
            assert.equal(b.sim.p2.active[0].getStat('spd'), base);
            assert.equal(damage(b), neutral);
            setWeather(b, 'hail');
            if (format !== 'doubles') {
                const restored = RaidBattle.restore(codec.decode(codec.encode(b.snapshot())), () => 0);
                dispose(b); b = restored;
                assert.equal(b.sim.p1.active[3].getAbility().name, ability);
                assert.equal(b.sim.field.effectiveWeather(), '', 'fourth-slot suppression survives cold restore');
            }
            const before = b.sim.getAllActive().map(p => p.hp);
            round(b);
            assert.deepEqual(b.sim.getAllActive().map(p => p.hp), before);
            assert.equal(b.sim.field.weather, 'hail');
            if (format !== 'doubles') {
                b.retreat(3);
                assert.equal(b.sim.field.effectiveWeather(), 'hail', 'a withdrawn ally no longer suppresses weather');
                const hp = b.sim.p1.active[0].hp;
                round(b);
                assert.equal(hp - b.sim.p1.active[0].hp, Math.max(1, Math.floor(b.sim.p1.active[0].baseMaxhp / 16)));
            }
        } finally { dispose(b); }
    });
}

test('simple calculator matches live sand damage without mutating the real team; Psyshock and hail stay unchanged', () => {
    const team = [mon(143, ['Thunderbolt', 'Psyshock', 'Tackle']), mon(185)];
    const before = JSON.stringify(team);
    const calc = (move, options = {}) => calculate(team, {attacker: team[0].uuid, defender: team[1].uuid, move, options}).min;
    const dry = calc(0), sand = calc(0, {weather: 'sandstorm'});
    assert(sand > 0 && sand < dry);
    assert.equal(calc(1, {weather: 'sandstorm'}), calc(1));
    assert.equal(calc(2, {weather: 'sandstorm'}), calc(2));
    const [a, d] = structuredClone(team), state = engine.createBattleState();
    state.weather = {kind: 'sandstorm', turns: 5};
    const hp = d.currentHp;
    engine.useattack('Thunderbolt', a, d, {battleState: state, consumePp: false, skipTurnStart: true,
        damagePreview: {roll: 0, critical: false}});
    assert.equal(sand, hp - d.currentHp);
    assert.equal(JSON.stringify(team), before);
    const ice = [mon(143, ['Tackle']), mon(362)];
    const iceDamage = weather => calculate(ice, {attacker: ice[0].uuid, defender: ice[1].uuid, move: 0, options: {weather}}).min;
    assert.equal(iceDamage('hail'), iceDamage(null), 'old hail does not boost Ice Defense in the calculator');
    for (const ability of ['Cloud Nine', 'Air Lock']) {
        team[0].passiveAbility = ability;
        assert.equal(calc(0, {weather: 'sandstorm'}), calc(0), ability);
    }
});
