const test = require('node:test');
const assert = require('node:assert/strict');

test('bilan client : les anciens événements distinguent capture, fuite, victoire PVP et interruption', async () => {
    const { buildBattleResult } = await import('../vue-explorakit/src/services/battleResult.js');
    assert.equal(buildBattleResult({ playerWon: true, captured: true }).outcome, 'captured');
    assert.equal(buildBattleResult({ playerWon: false, fled: true }).outcome, 'fled');
    assert.equal(buildBattleResult({ playerWon: true, reason: 'fled', battleType: 'pvp' }).outcome, 'victory');
    assert.equal(buildBattleResult({ playerWon: false, reason: 'timer' }, 'drift').outcome, 'interrupted');
    assert.equal(buildBattleResult({ playerWon: false, reason: 'timeout' }).outcome, 'interrupted');
    assert.equal(buildBattleResult({ playerWon: false, reason: 'finished', draw: true }).outcome, 'draw');
    assert.equal(buildBattleResult({ playerWon: false, reason: 'defeat' }).outcome, 'defeat');
    assert.equal(buildBattleResult(null).outcome, 'interrupted');
    assert.deepEqual(buildBattleResult({ playerWon: true }).experience, [], 'aucun gain inventé pour un ancien serveur');
});

test('bilan client : conserve les gains et pertes serveur sans déduire de récompenses d’une victoire', async () => {
    const { buildBattleResult } = await import('../vue-explorakit/src/services/battleResult.js');
    const experience = [{ uuid: 'ally', name: 'Salamèche', xpGained: 94, previousLevel: 5, level: 6 }];
    const lostPokemon = [{ uuid: 'lost', pokemonId: 19, name: 'Rattata', level: 5 }];
    const result = buildBattleResult({ playerWon: true, summary: {
        outcome: 'victory', experience, lostPokemon, money: 200, loot: ['Potion ×1']
    } }, 'drift');
    assert.deepEqual(result.experience, experience);
    assert.deepEqual(result.lostPokemon, lostPokemon);
    assert.deepEqual(result.loot, ['Potion ×1']);
    assert.equal(result.money, 200);
    assert.equal(result.mode, 'drift');
    const capturedPokemon = { uuid: 'captured', pokemonId: 25, name: 'Pikachu', level: 7 };
    assert.deepEqual(buildBattleResult({ summary: { outcome: 'captured', capturedPokemon } }).capturedPokemon, capturedPokemon);
});
