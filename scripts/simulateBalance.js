// Reproducible bot matches through the actual combat engine. This is a regression
// and measurement tool, not a substitute for human playtesting.
const assert = require('node:assert/strict');
const { DriftBattle } = require('../server/game/drift/driftBattle');
const factory = require('../server/game/drift/pokemonFactory');

function seeded(seed) {
    return () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
    };
}
function participant(id, species, level) {
    return {
        userId: id,
        username: `Bot ${id}`,
        equipe: { pokemons: [factory.create(species, level, true)] },
        drifts: [],
        equipped: [],
        items: {},
        defeated: new Set(),
        chain: 0,
        money: 0,
    };
}
const originalRandom = Math.random;
const measurements = [];
try {
    for (const level of [5, 25, 55])
        for (const species of [
            [1, 1],
            [1, 4],
            [4, 7],
            [7, 1],
        ]) {
            let leftWins = 0,
                rightWins = 0,
                draws = 0,
                totalTurns = 0,
                longest = 0;
            for (let seed = 1; seed <= 30; seed++) {
                Math.random = seeded(seed * 971 + level);
                const a = participant(1, species[0], level),
                    b = participant(2, species[1], level);
                let winner = null;
                const battle = new DriftBattle(a, b, {
                    type: 'pvp',
                    emit() {},
                    now: () => 0,
                    random: Math.random,
                    paceMs: 0,
                    onFinish: (_battle, result) => {
                        winner = result;
                    },
                });
                for (let step = 0; step < 1000 && !battle.finished; step++) {
                    for (const player of [a, b])
                        if (battle.awaiting && !battle.finished)
                            battle.action(player, { ...battle.defaultAction(player), turnId: battle.token });
                    battle.tick();
                }
                assert(battle.finished, `Combat bloqué : niveau ${level}, ${species}, graine ${seed}`);
                for (const pokemon of battle.originals)
                    assert(Number.isFinite(pokemon.currentHp), 'PV invalides');
                if (winner === a) leftWins++;
                else if (winner === b) rightWins++;
                else draws++;
                totalTurns += battle.round;
                longest = Math.max(longest, battle.round);
            }
            measurements.push({
                level,
                species,
                matches: 30,
                leftWins,
                rightWins,
                draws,
                averageTurns: Number((totalTurns / 30).toFixed(2)),
                longest,
            });
        }
} finally {
    Math.random = originalRandom;
}
console.log(
    JSON.stringify(
        {
            matches: 360,
            policy: 'Random legal damaging move, fixed starter IVs; no items or Drifts',
            humanPlaytest: false,
            measurements,
        },
        null,
        2
    )
);
