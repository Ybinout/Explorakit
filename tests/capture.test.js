const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateCaptureChance } = require('../server/game/battle/wildBattle');

test('affaiblir un Pokemon et utiliser une meilleure Ball augmente la capture', () => {
    const playerPokemon = { level: 20 };
    const healthyWild = { level: 20, currentHp: 100, maxHp: 100 };
    const weakenedWild = { level: 20, currentHp: 10, maxHp: 100 };

    const healthyChance = calculateCaptureChance(playerPokemon, healthyWild, 1);
    const weakenedChance = calculateCaptureChance(playerPokemon, weakenedWild, 1);
    const betterBallChance = calculateCaptureChance(playerPokemon, weakenedWild, 2);

    assert.ok(weakenedChance > healthyChance);
    assert.ok(betterBallChance > weakenedChance);
    assert.ok(betterBallChance <= 0.95);
});
