const test = require('node:test');
const assert = require('node:assert/strict');
const service = import('../vue-explorakit/src/services/driftReportHistory.js');
function memoryStorage(limit = Infinity) {
    const entries = new Map();
    return {
        getItem: key => entries.get(key) || null,
        setItem(key, value) { if (value.length > limit) throw new Error('Quota exceeded'); entries.set(key, value); }
    };
}
function report(runId, owner = 7, finishedAt = 10) {
    return { version: 1, runId, finishedAt, players: [{ id: owner, username: 'Dresseur', pokemon: [{ name: 'Rattata' }] }] };
}

test('souvenirs Drift : compte isolé, copie figée, doublons et dix parties récentes', async () => {
    const { readDriftReports, saveDriftReport } = await service;
    const storage = memoryStorage(), original = report('first');
    assert.equal(saveDriftReport(7, original, storage), true);
    original.players[0].pokemon[0].name = 'Mutation du runtime';
    assert.equal(readDriftReports(7, storage)[0].players[0].pokemon[0].name, 'Rattata');
    assert.deepEqual(readDriftReports(8, storage), []);
    assert.equal(saveDriftReport(8, original, storage), false, 'pas de souvenir d’une partie étrangère au compte');
    assert.equal(saveDriftReport(7, report('first'), storage), true);
    assert.equal(readDriftReports(7, storage).length, 1);
    for (let i = 0; i < 12; i++) saveDriftReport(7, report('run-' + i, 7, 20 + i), storage);
    const history = readDriftReports(7, storage);
    assert.equal(history.length, 10);
    assert.deepEqual(history.map(item => item.runId), Array.from({ length: 10 }, (_, i) => 'run-' + (11 - i)));
    assert.equal(saveDriftReport(null, report('bad'), storage), false);
    assert.equal(saveDriftReport(7, { ...report('unfinished'), finishedAt: undefined }, storage), false);
});

test('souvenirs Drift : corruption ou stockage bloqué sans interrompre le jeu', async () => {
    const { readDriftReports, saveDriftReport } = await service;
    const storage = memoryStorage();
    storage.setItem('explorakit:drift-reports:v1:7', '{invalid');
    assert.deepEqual(readDriftReports(7, storage), []);
    assert.equal(saveDriftReport(7, report('new'), storage), true);
    const blocked = { getItem() { throw new Error('Blocked'); }, setItem() { throw new Error('Blocked'); } };
    assert.deepEqual(readDriftReports(7, blocked), []);
    assert.equal(saveDriftReport(7, report('new'), blocked), false);
    const circular = report('circular'); circular.self = circular;
    assert.equal(saveDriftReport(7, circular, storage), false);
    assert.equal(readDriftReports(7, storage)[0].runId, 'new', 'un échec ne détruit pas les souvenirs existants');
});

test('souvenirs Drift : réduit les anciennes archives si le navigateur manque de place', async () => {
    const { readDriftReports, saveDriftReport } = await service;
    const first = report('old'), next = report('new');
    const storage = memoryStorage(JSON.stringify([next]).length + 1);
    assert.equal(saveDriftReport(7, first, storage), true);
    assert.equal(saveDriftReport(7, next, storage), true);
    assert.deepEqual(readDriftReports(7, storage).map(item => item.runId), ['new']);
    const huge = { ...report('huge'), events: 'x'.repeat(2000001) };
    assert.equal(saveDriftReport(7, huge, storage), false);
    assert.equal(readDriftReports(7, storage)[0].runId, 'new');
});
