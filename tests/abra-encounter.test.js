const test = require('node:test'), assert = require('node:assert/strict');
const { applyEncounterGuarantee, ABRA_ID, ABRA_MAP } = require('../server/persistence/adventureEncounterRepository');
const factory = require('../server/game/world/wildPokemonFactory');
const maps = require('../data/game/nextMap.json').maps;
const { getMoveDefinition } = require('../server/game/battle/battleResources');

test('Abra belongs to Route 2, and the guarantee keeps the rolled level and natural moves', async () => {
    assert.equal(ABRA_ID, 63); assert.equal(ABRA_MAP, 'route2');
    assert.deepEqual(maps.filter(m => m.wildpokemon?.includes(ABRA_ID)).map(m => m.mapName), [ABRA_MAP]);
    for (const level of [11, 15]) {
        const wild = await factory.createAtLevel(12, level), before = JSON.stringify(wild);
        let reads = 0;
        const result = await applyEncounterGuarantee(42, ABRA_MAP, wild, { execute: async (sql, args) => {
            reads++; assert.match(sql.trim(), /^SELECT seen_count, caught_count FROM user_pokedex/);
            assert.deepEqual(args, [42, 63]); return [[]];
        } });
        assert.equal(result.data.id, 63); assert.equal(result.level, level); assert.equal(reads, 1);
        assert(result.currentHp === result.maxHp && result.maxHp > 0);
        assert(result.abilities.includes('Teleport')); assert(result.abilities.every(getMoveDefinition));
        assert.equal(JSON.stringify(wild), before, 'the ordinary candidate is never mutated');
    }
});

test('Seen or captured Abra keeps the ordinary draw; an empty old record still needs the encounter', async () => {
    const wild = await factory.createAtLevel(12, 13);
    for (const row of [{ seen_count: 1, caught_count: 0 }, { seen_count: '3', caught_count: '0' }, { seen_count: 0, caught_count: 1 }]) {
        assert.equal(await applyEncounterGuarantee(42, 'route2', wild, { execute: async () => [[row]] }), wild);
    }
    assert.equal((await applyEncounterGuarantee(42, 'route2', wild, { execute: async () => [[{ seen_count: 0, caught_count: 0 }]] })).data.id, 63);
});

test('Other maps, natural Abra and legendary encounters never read SQL or change their Pokémon', async () => {
    const never = { execute() { throw Error('Unexpected database query'); } };
    for (const map of ['start', 'route1', 'route3', 'cave1', 'centre', 'route2_maison']) {
        const wild = await factory.createAtLevel(12, 15);
        assert.equal(await applyEncounterGuarantee(42, map, wild, never), wild);
    }
    for (const id of [63, 144, 150, 380, 493]) {
        const wild = await factory.createAtLevel(id, 11);
        assert.equal(await applyEncounterGuarantee(42, 'route2', wild, never), wild);
    }
    assert.equal(await applyEncounterGuarantee(42, 'route2', null, never), null);
});

test('A selection is read-only and cannot consume another player’s guarantee', async () => {
    const wild = await factory.createAtLevel(12, 11), rows = new Map([[1, { seen_count: 1, caught_count: 0 }]]);
    const executor = { execute: async (sql, [id]) => { assert.match(sql.trim(), /^SELECT /); return [rows.has(id) ? [rows.get(id)] : []]; } };
    assert.equal(await applyEncounterGuarantee(1, 'route2', wild, executor), wild);
    assert.equal((await applyEncounterGuarantee(2, 'route2', wild, executor)).data.id, 63);
    assert.equal((await applyEncounterGuarantee(2, 'route2', wild, executor)).data.id, 63, 'selection alone does not record an encounter');
    assert(!rows.has(2));
    await assert.rejects(applyEncounterGuarantee(0, 'route2', wild, executor), /Utilisateur/);
    await assert.rejects(applyEncounterGuarantee(2, 'route2', wild, { execute: async () => { throw Error('offline'); } }), /offline/);
});
