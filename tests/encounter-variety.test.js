const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { maps } = require('../data/game/nextMap.json');
const { battleMapData } = require('../server/game/world/mapRepository');
const factory = require('../server/game/drift/pokemonFactory');
const colosseum = require('../server/game/drift/colosseum');
const dex = require('../data/game/pokedex.json');
const zones = maps.filter(m => battleMapData(m.mapName).flat().some(Boolean));
const bst = species => Object.values(species.base).reduce((sum, value) => sum + value, 0);

test('each encounter zone has a distinct, diverse pool with shipped sprites and level-appropriate species', () => {
    const signatures = new Set();
    for (const zone of zones) {
        const ids = zone.wildpokemon;
        assert(ids.length >= 10, zone.mapName);
        assert.equal(new Set(ids).size, ids.length, 'Duplicated IDs distort encounter odds');
        const signature = [...ids].sort((a,b) => a-b).join(',');
        assert(!signatures.has(signature), 'Routes must not all reuse the same pool');signatures.add(signature);
        const types = new Set();
        for (const id of ids) {
            const species = dex.find(p => p.id === id);
            assert(species && !factory.legendary.has(id), `${zone.mapName}: unavailable or legendary ${id}`);
            species.type.forEach(type => types.add(type));
            const cap = zone.level.min < 11 ? 350 : zone.level.min < 19 ? 400 : zone.level.min < 24 ? 460 : zone.level.min < 32 ? 500 : zone.level.min < 50 ? 550 : 600;
            assert(bst(species) <= cap, `${zone.mapName}: species ${id} is too strong for this stage`);
            for (const dir of ['dp2', 'back']) assert(fs.existsSync(path.join(__dirname, '../vue-explorakit/src/assets', dir, `${id}.png`)), `${id}: missing ${dir}`);
            const pokemon = factory.create(id, zone.level.min);
            assert(pokemon.currentHp > 0 && pokemon.abilities.length > 0);
        }
        assert(types.size >= 5, `${zone.mapName}: too little type variety`);
    }
});

test('Rift and Colosseum sample the expanded pools within the expedition level ranges', () => {
    for (const zone of zones) {
        const seen = new Set();
        for (let i = 0; i < 200; i++) {
            const pokemon = factory.wild(zone.mapName, {}, () => (i + .5) / 200);
            assert(zone.wildpokemon.includes(pokemon.data.id));
            assert(pokemon.level >= (require('../server/game/drift/openingBalance').levels[zone.mapName]||zone.level).min && pokemon.level <= (require('../server/game/drift/openingBalance').levels[zone.mapName]||zone.level).max);
            seen.add(pokemon.data.id);
        }
        assert.equal(seen.size, zone.wildpokemon.length, `${zone.mapName}: unreachable species`);
    }
});

test('legacy v4 opening Colosseum waves vary types and species while keeping fair, increasing challenges', () => {
    const seen = new Set(), types = new Set();let previousStrength = 0;
    for (let wave = 1; wave <= 6; wave++) {
        const team = colosseum.opponent(wave,4).equipe.pokemons;
        const repeated = colosseum.opponent(wave,4).equipe.pokemons;
        assert.deepEqual(team.map(p=>p.data.id), repeated.map(p=>p.data.id));
        assert.deepEqual(team.map(p=>p.abilities), repeated.map(p=>p.abilities));
        const strength = team.reduce((sum,p)=>sum+bst(p.data)*p.level,0);
        assert(strength > previousStrength);
        if (!colosseum.waveInfo(wave,4).guardian) previousStrength = strength;
        for (const p of team) {
            assert(!seen.has(p.data.id), 'Early waves should introduce new species');seen.add(p.data.id);
            p.data.type.forEach(t=>types.add(t));
            // The first guardian now arrives at five, with its announced evolved
            // defensive team; ordinary opening trainers keep their modest stats.
            assert(bst(p.data) <= (colosseum.waveInfo(wave,4).guardian ? 510 : wave < 3 ? 300 : wave < 5 ? 350 : 400));
            assert.equal(p.k, 2);assert.equal(p.level, 10 + (wave - 1) * 3 + (wave === 5 ? 1 : 0));
        }
    }
    assert(seen.size >= 14);assert(types.size >= 8);
    assert.equal(colosseum.waveInfo(1).points, 300);
});
