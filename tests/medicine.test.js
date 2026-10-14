const test = require('node:test');
const assert = require('node:assert/strict');
const { medicineResult } = require('../server/persistence/medicineRepository');

test('medicines respect HP caps, poison types and the difference between healing and revival', () => {
    const pokemon = { currentHp: 18, maxHp: 25, status: 'poison' };
    assert.deepEqual(medicineResult(pokemon, 'potion'), { currentHp: 25, status: 'poison' });
    assert.deepEqual(medicineResult(pokemon, 'super_potion'), { currentHp: 25, status: 'poison' });
    for (const status of ['poison', 'badly_poison'])
        assert.deepEqual(medicineResult({ ...pokemon, status }, 'antidote'), { currentHp: 18, status: 'normal' });
    assert.throws(() => medicineResult({ ...pokemon, status: 'burn' }, 'antidote'), /aucun effet/);
    assert.throws(() => medicineResult({ ...pokemon, currentHp: 0 }, 'potion'), /Rappel/);
    assert.deepEqual(medicineResult({ ...pokemon, currentHp: 0 }, 'revive'), { currentHp: 12, status: 'normal' });
    assert.throws(() => medicineResult(pokemon, 'revive'), /conscient/);
    assert.throws(() => medicineResult(pokemon, 'pokeball'), /invalide/);
});
