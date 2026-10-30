const test = require('node:test');
const assert = require('node:assert/strict');
const { auditMoves } = require('../scripts/auditMoves');

test('aucun effet ou cas special de degats ne reste silencieusement inconnu', () => {
    const report = auditMoves();
    assert.equal(report.totalMoves, 634);
    assert.equal(report.executionChecks, 634*8*2);
    assert.deepEqual(report.executionFailures, []);
    assert.equal(report.aiChecks,634*3);
    assert.deepEqual(report.aiFailures,[]);
    assert.deepEqual(report.unknownEffectKinds, []);
    assert.deepEqual(report.unsupportedSpecialCases, []);
});
