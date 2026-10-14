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

test('healing berries can be consumed from the bag; held equipment cannot', () => {
    const pokemon = { currentHp: 3, maxHp: 80, status: 'paralyze' };
    assert.deepEqual(medicineResult(pokemon, 'oran_berry'), { currentHp: 13, status: 'paralyze' });
    assert.deepEqual(medicineResult(pokemon, 'sitrus_berry'), { currentHp: 23, status: 'paralyze' });
    for (const status of ['poison', 'badly_poison', 'burn', 'paralyze', 'sleep', 'freeze'])
        assert.deepEqual(medicineResult({ ...pokemon, status }, 'lum_berry'), { currentHp: 3, status: 'normal' });
    assert.throws(() => medicineResult({ ...pokemon, status: 'normal' }, 'lum_berry'), /aucun effet/);
    assert.throws(() => medicineResult({ ...pokemon, currentHp: 80 }, 'oran_berry'), /aucun effet/);
    assert.throws(() => medicineResult({ ...pokemon, currentHp: 0 }, 'oran_berry'), /Rappel/);
    assert.throws(() => medicineResult(pokemon, 'leftovers'), /invalide/);
});
