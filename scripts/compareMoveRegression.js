// Compare deterministic combat outcomes against an isolated source snapshot.
// Usage: node scripts/compareMoveRegression.js /path/to/baseline /tmp/report.json
const fs = require('node:fs'),
    path = require('node:path');
const root = path.resolve(__dirname, '..'),
    baseline = process.argv[2];
if (!baseline || !fs.existsSync(path.join(baseline, 'server/game/battle/battleEngine.js')))
    throw Error('Provide an isolated baseline source directory');
const reportPath = process.argv[3] || '/tmp/riftmon-move-regression-comparison.json';
const moves = require(root + '/data/game/moves.json');
const suites = [root, baseline].map((base) => ({
    e: require(base + '/server/game/battle/battleEngine'),
    f: require(base + '/server/game/drift/pokemonFactory'),
}));
const scenarios = [
    'normal',
    'low_hp',
    'substitute',
    'protect',
    'sleep',
    'freeze',
    'paralyze',
    'confused',
    'rain',
    'sun',
    'sheer_force',
    'inner_focus',
    'mold_breaker',
    'empty_pp',
    'life_orb',
    'recharge',
];
function run(suite, name, scenario, seed) {
    let rng = seed;
    Math.random = () => {
        rng = (Math.imul(1664525, rng) + 1013904223) >>> 0;
        return rng / 4294967296;
    };
    const { e, f } = suite;
    const a = f.create(52, 40, true),
        b = f.create(7, 40, true);
    for (const [i, p] of [a, b].entries()) {
        p.uuid = 'mon-' + i;
        p.passiveAbility = null;
        p.heldItem = null;
        p.type1 = 'Normal';
        p.type2 = null;
        p.currentHp = p.maxHp = 1000;
        p.abilities = [i ? 'Tackle' : name];
        p.movePp = [50];
    }
    const state = e.createBattleState();
    e.ensureBattleData(a);
    e.ensureBattleData(b);
    if (scenario === 'low_hp') a.currentHp = 1;
    if (scenario === 'substitute') b.__battle.substituteHp = 500;
    if (scenario === 'protect') b.__battle.protect = true;
    if (['sleep', 'freeze', 'paralyze'].includes(scenario)) {
        a.status = scenario;
        if (scenario === 'sleep') a.__battle.sleepTurns = 3;
    }
    if (scenario === 'confused') a.__battle.confusionTurns = 3;
    if (['rain', 'sun'].includes(scenario)) state.weather = { kind: scenario, turns: 5 };
    if (scenario === 'sheer_force') a.passiveAbility = 'Sheer Force';
    if (scenario === 'inner_focus') b.passiveAbility = 'Inner Focus';
    if (scenario === 'mold_breaker') {
        a.passiveAbility = 'Mold Breaker';
        b.passiveAbility = 'Inner Focus';
    }
    if (scenario === 'empty_pp') a.movePp = [0];
    if (scenario === 'life_orb') a.heldItem = 'life_orb';
    if (scenario === 'recharge') a.__battle.rechargeMove = 'Hyper Beam';
    const snap = (p) => ({
        hp: p.currentHp,
        status: p.status,
        pp: [...p.movePp],
        item: p.heldItem,
        ability: p.passiveAbility,
        stages: p.__battle?.statStages,
        sub: p.__battle?.substituteHp,
        charge: p.__battle?.chargeMove,
    });
    const out = [];
    for (let turn = 0; turn < 3; turn++) {
        if (a.currentHp <= 0 || b.currentHp <= 0) break;
        const r = e.useattack(name, a, b, {
            battleState: state,
            attackerTeam: [a],
            defenderTeam: [b],
            attackerSide: state.sides.player,
            defenderSide: state.sides.enemy,
        });
        const reply = e.useattack('Tackle', b, a, {
            battleState: state,
            attackerTeam: [b],
            defenderTeam: [a],
            attackerSide: state.sides.enemy,
            defenderSide: state.sides.player,
        });
        e.processEndOfRound(a, b, state.sides.player, state.sides.enemy, state);
        const pick = (r) =>
            Object.fromEntries(
                [
                    'damage',
                    'success',
                    'hits',
                    'critical',
                    'missed',
                    'blocked',
                    'forceSwitch',
                    'switchSelf',
                    'phase',
                ].map((k) => [k, r[k]])
            );
        out.push({
            r: pick(r),
            reply: pick(reply),
            a: snap(a),
            b: snap(b),
            weather: state.weather,
            terrain: state.terrain,
        });
    }
    return JSON.stringify(out);
}
const old = Math.random,
    diffs = [],
    errors = [];
let cases = 0;
try {
    for (const m of moves)
        for (const scenario of scenarios)
            for (const seed of [1, 100, 12345]) {
                cases++;
                try {
                    const [after, before] = suites.map((s) => run(s, m.ename, scenario, seed));
                    if (after !== before)
                        diffs.push({
                            move: m.ename,
                            scenario,
                            seed,
                            before: JSON.parse(before),
                            after: JSON.parse(after),
                        });
                } catch (e) {
                    errors.push({ move: m.ename, scenario, seed, error: e.stack });
                }
            }
} finally {
    Math.random = old;
}
fs.writeFileSync(reportPath, JSON.stringify({ cases, diffs, errors }));
console.log(
    JSON.stringify(
        { cases, differences: diffs.length, moves: [...new Set(diffs.map((d) => d.move))], errors },
        null,
        2
    )
);
