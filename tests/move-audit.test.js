const test = require('node:test');
const assert = require('node:assert/strict');
const { auditMoves } = require('../scripts/auditMoves');

test('aucun effet ou cas special de degats ne reste silencieusement inconnu', () => {
    const report = auditMoves();
    assert.equal(report.totalMoves, 612);
    assert.equal(report.executionChecks, 2448);
    assert.deepEqual(report.executionFailures, []);
    assert.deepEqual(report.unknownEffectKinds, []);
    assert.deepEqual(report.unsupportedSpecialCases, []);
});
