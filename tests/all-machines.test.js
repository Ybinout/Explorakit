const test = require('node:test'), assert = require('node:assert/strict');
const { auditMachines } = require('../scripts/auditMachines');
const { machines, teachMachine } = require('../server/game/items/machines');
const factory = require('../server/game/drift/pokemonFactory');
const reference = require('../data/vendor/machine_learnability.json');

test('every learnable engine move has a CS, with exact all-method compatibility for every existing species', () => {
    const report = auditMachines();
    assert.equal(report.machines, 633); assert.equal(report.checkedPairs, 633 * 809);
    assert.equal(Object.values(machines).filter(machine => machine.species.includes(235)).length, 633, 'Permanent Sketch learning');
});

// These examples cover different independent sources, not a type-based guess.
for (const [species, key, method] of [
    [7, 'cs_bite', 'level_up'], [7, 'cs_aqua_jet', 'egg'], [25, 'cs_fly', 'event'],
    [25, 'cs_celebrate', 'event'], [129, 'cs_hydro_pump', 'event'], [149, 'cs_heal_bell', 'event'],
    [25, 'cs_surf', 'stadium_surfing_pikachu'], [172, 'cs_volt_tackle', 'light_ball_egg'],
    [94, 'cs_dream_eater', 'tutor'],
]) test(`CS ${key}: #${species} can learn via ${method}, actually taught with correct PP and no mutation`, () => {
    const m = machines[key]; assert(reference.species[species][method].includes(m.moveId));
    assert(m.species.includes(species));
    const p = factory.create(species, 20, true); p.abilities = ['Tackle']; p.movePp = [2];
    const before = JSON.stringify(p), result = teachMachine(p, key, { slot: 1, expectedMoves: p.abilities });
    assert.deepEqual(result.abilities, ['Tackle', m.move]);
    assert.equal(result.movePp[0], 2); assert.equal(result.movePp[1], require('../server/game/battle/battleResources').getMaxMovePp(m.move));
    assert.equal(JSON.stringify(p), before);
});
test('pre-evolution moves stay teachable after evolving; siblings, temporary copying and typing do not grant arbitrary moves', () => {
    assert(reference.species[25].event.includes(machines.cs_celebrate.moveId));
    assert(!Object.values(reference.species[26]).some(moves => moves.includes(machines.cs_celebrate.moveId)));
    assert(machines.cs_celebrate.species.includes(26), 'Raichu keeps Celebrate from event Pikachu');
    for (const [species, key] of [[129, 'cs_surf'], [4, 'cs_surf'], [132, 'cs_spore'], [135, 'cs_morning_sun']]) {
        assert(!machines[key].species.includes(species));
        assert.throws(() => teachMachine(factory.create(species, 20, true), key, {}), /compatible/);
    }
});
test('Purify keeps the Poison story exception as well as native and Sketch learners', () => {
    for (const id of [94, 235, 771]) assert(machines.cs_purify.species.includes(id));
    assert(!machines.cs_purify.species.includes(25));
});
