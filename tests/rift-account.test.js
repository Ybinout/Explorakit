const test = require('node:test');
const assert = require('node:assert/strict');
const { getProfile, recordRunStarted, recordRunFinished } = require('../server/persistence/riftAccountRepository');

test('le profil RiftMon rejette les identités ambiguës avant de lire SQL', async () => {
    for (const userId of [0, -1, '2oops', '1.5', {}, null, NaN]) {
        await assert.rejects(getProfile(userId), /Compte RiftMon invalide/);
    }
});

test('un départ RiftMon refuse les rosters incomplets ou dupliqués avant SQL', async () => {
    await assert.rejects(recordRunStarted({ id: 'run', players: [{ id: 1 }] }), /2 et 16/);
    await assert.rejects(recordRunStarted({ id: 'run', players: [{ id: 1 }, { id: '1' }] }), /deux fois/);
    await assert.rejects(recordRunStarted({ id: 'run', players: [{ id: 1 }, { id: '2x' }] }), /Compte RiftMon invalide/);
    await assert.rejects(recordRunStarted({ id: 'run', players: Array.from({ length: 17 }, (_, id) => ({ id: id + 1 })) }), /2 et 16/);
    await assert.rejects(recordRunStarted({ id: 'invalid run', players: [{ id: 1 }, { id: 2 }] }), /Partie RiftMon invalide/);
});

test('le règlement RiftMon refuse un vainqueur ou une date malformés avant SQL', async () => {
    await assert.rejects(recordRunFinished({ id: 'run', winnerId: '1oops' }), /Compte RiftMon invalide/);
    await assert.rejects(recordRunFinished({ id: 'run', winnerId: 1, finishedAt: 'invalide' }), /Date de fin RiftMon invalide/);
});
