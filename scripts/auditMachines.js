// Independent, offline CS audit: collect each species' ancestors rather than
// regenerating the catalogue's forward evolution closure. No database writes.
const assert = require('node:assert/strict');
const reference = require('../data/vendor/machine_learnability.json');
const source = require('../data/vendor/pokeapi/learnsets.gen7.json');
const catalog = require('../data/game/moves.json');
const dex = require('../data/game/pokedex.json');
const normalize = value => {
    const key = value.toLowerCase().replace(/[^a-z0-9]/g, '');
    return ({ vicegrip: 'visegrip', hijumpkick: 'highjumpkick', smellingsalt: 'smellingsalts', celebration: 'celebrate' })[key] || key;
};

function auditMachines(machines = require('../data/game/machines.json').machines) {
    const sourceIds = new Map(Object.entries(source.moves).map(([id, move]) => [normalize(move.name), +id]));
    const parents = new Map(reference.evolutions.map(([parent, child]) => [child, parent]));
    const legal = new Map();
    for (const species of Object.keys(reference.species).map(Number)) {
        const moves = new Set(), ancestors = new Set();
        for (let id = species; id; id = parents.get(id)) {
            assert(!ancestors.has(id), `Evolution cycle #${species}`);
            ancestors.add(id);
            for (const values of Object.values(reference.species[id])) for (const move of values) moves.add(move);
        }
        if (dex.find(p => p.id === species)?.type.includes('Poison')) moves.add(685); // Explicit Purify story exception.
        legal.set(species, { moves, sketch: [...ancestors].some(id => reference.sketch.species.includes(id)) });
    }
    assert.equal(legal.size, 809);
    const expected = catalog.filter(move => move.ename !== 'Struggle');
    assert.equal(Object.keys(machines).length, expected.length, 'One CS per learnable engine move');
    const items = require('../data/game/items.json').items;
    const floors = require('../data/game/department_store.json').floors;
    assert.equal(items.filter(item => item.category === 'machine').length, expected.length);
    let pairs = 0, compatibilities = 0;
    for (const move of expected) {
        const id = sourceIds.get(normalize(move.ename));
        assert(id, `Missing source ID: ${move.ename}`);
        const key = 'cs_' + source.moves[id].slug.replace(/-/g, '_'), machine = machines[key];
        assert(machine, `Missing CS: ${move.ename}`);
        assert.equal(machine.move, move.ename); assert.equal(machine.moveId, id); assert.equal(machine.type, move.type);
        assert.deepEqual(machine.species, [...new Set(machine.species)].sort((a, b) => a - b), key);
        const actual = new Set(machine.species);
        for (const [species, learning] of legal) {
            const wanted = learning.moves.has(id) || (learning.sketch && !reference.sketch.excludedMoves.includes(move.ename));
            assert.equal(actual.has(species), wanted, `${key} #${species}`); pairs++;
        }
        for (const species of actual) assert(legal.has(species), `Unexpected species ${key} #${species}`);
        assert(actual.size, `Empty CS: ${key}`); compatibilities += actual.size;
        const item = items.find(item => item.key === key);
        assert(item && item.category === 'machine' && item.machineMove === move.ename && item.name === machine.name, key);
        assert.equal(machine.price, (move.power || 0) >= 100 ? 5000 : (move.power || 0) >= 80 ? 4000 : 3000, key);
        assert.deepEqual(floors.tour_etage1.offers[key], { price: machine.price, requiredTier: 2 }, key);
        for (const [floor, data] of Object.entries(floors)) if (floor !== 'tour_etage1') assert(!data.offers[key], floor + '/' + key);
    }
    assert(!Object.values(machines).some(machine => machine.move === 'Struggle'));
    assert.deepEqual(machines, require('../vue-explorakit/src/data/machines.json'));
    return { engineMoves: catalog.length, machines: expected.length, species: legal.size, checkedPairs: pairs, compatibilities, excluded: ['Struggle'] };
}
module.exports = { auditMachines };
if (require.main === module) {
    const { execFileSync } = require('node:child_process'), root = require('node:path').resolve(__dirname, '..');
    const baseline = '0c240c3d40c5f4c531a7b995a7466e95c22e800a';
    const previous = name => JSON.parse(execFileSync('git', ['show', `${baseline}:${name}`], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }));
    const current = require('../data/game/machines.json').machines, old = previous('data/game/machines.json').machines;
    for (const [key, machine] of Object.entries(old)) {
        const { species, ...fields } = machine, { species: now, ...newFields } = current[key];
        assert.deepEqual(newFields, fields, `Existing CS fields ${key}`);
        for (const id of species) assert(now.includes(id), `Lost compatibility ${key} #${id}`);
    }
    const withoutMachines = items => items.filter(item => item.category !== 'machine');
    assert.deepEqual(withoutMachines(require('../data/game/items.json').items), withoutMachines(previous('data/game/items.json').items));
    const withoutCSOffers = store => {
        for (const floor of Object.values(store.floors)) floor.offers = Object.fromEntries(Object.entries(floor.offers).filter(([key]) => !key.startsWith('cs_')));
        return store;
    };
    assert.deepEqual(withoutCSOffers(structuredClone(require('../data/game/department_store.json'))), withoutCSOffers(previous('data/game/department_store.json')));
    assert.deepEqual(require('../data/game/level_up_moves.json'), previous('data/game/level_up_moves.json'));
    assert.deepEqual(require('../data/game/moves.json'), previous('data/game/moves.json'));
    console.log(JSON.stringify({ ...auditMachines(), baseline, preservedMachines: Object.keys(old).length, existingPricesAndCompatibilityPreserved: true, naturalProgressionAndOtherItemsUnchanged: true }));
}
