const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const maps = require('../server/game/world/mapRepository');
const world = require('../data/game/nextMap.json').maps;
const CreatePokemon = require('../server/game/world/wildPokemonFactory');

test('Routes 13/14 preserve all nine updated author files and every portal is reachable from every arrival', () => {
    const manifest = require('../docs/north-routes-author-assets.json');
    assert.equal(Object.keys(manifest).length, 9);
    for (const [file, hash] of Object.entries(manifest)) {
        const bytes = fs.readFileSync(path.join(__dirname, '..', file));
        assert.equal(createHash('sha256').update(bytes).digest('hex'), hash, file);
        if (file.endsWith('.png')) {
            assert.equal(bytes.readUInt32BE(16), 448);
            assert.equal(bytes.readUInt32BE(20), 320);
        }
    }
    for (const n of [13, 14]) {
        const name = `route${n}`, t = maps.changeMapData(name), c = maps.loadCollisionData(name);
        const config = world.find(m => m.mapName === name);
        assert.equal(config.mapchange.length, 10);
        for (const sx of [12, 13, 14, 15, 16]) for (const sy of [1, 18]) {
            const seen = reachable(name, [sx, sy]);
            t.forEach((row, y) => row.forEach((v, x) => {
                if (!v) return;
                assert(seen.has(`${x}:${y}`), `${name}: ${x}:${y} from ${sx}:${sy}`);
                assert.equal(c[y][x], 0);
                assert.equal(config.mapchange.filter(g => g.valX === x && g.valY === y).length, 1);
                const link = maps.getNextMap(name, x, y);
                const target = n === 13 ? y === 19 ? 'cave_rochebrume3' : 'route14' : y === 19 ? 'route13' : 'ville5';
                assert.equal(link.nextMap, target);
                const dx = Math.floor(link.nextX / 32), dy = Math.floor(link.nextY / 32);
                assert.equal(maps.loadCollisionData(target)[dy]?.[dx], 0);
                assert.equal(maps.changeMapData(target)[dy]?.[dx], 0);
                assert.equal(link.blockedMessage, undefined);
            }));
        }
        maps.battleMapData(name).forEach((row, y) => row.forEach((v, x) => {
            if (v) { assert.equal(c[y][x], 0); assert.equal(t[y][x], 0); }
        }));
    }
});

function reachable(name, start) {
    const c = maps.loadCollisionData(name), t = maps.changeMapData(name);
    const queue = [start], seen = new Set();
    for (let i = 0; i < queue.length; i++) {
        const [x, y] = queue[i], key = `${x}:${y}`;
        if (seen.has(key) || c[y]?.[x] !== 0) continue;
        seen.add(key);
        if (!t[y][x]) queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    return seen;
}

test('the nine northern cave files preserve the exact author delivery', () => {
    const manifest = require('../docs/north-caves-author-assets.json');
    assert.equal(Object.keys(manifest).length, 9);
    for (const [file, hash] of Object.entries(manifest)) {
        const bytes = fs.readFileSync(path.join(__dirname, '..', file));
        assert.equal(createHash('sha256').update(bytes).digest('hex'), hash, file);
        if (file.endsWith('.png')) {
            assert.equal(bytes.readUInt32BE(16), 448);
            assert.equal(bytes.readUInt32BE(20), 320);
        }
    }
});

test('every authored cave portal is reachable, mapped once and lands safely, in order', () => {
    const entry = maps.getNextMap('ville4', 13, 3);
    assert.equal(entry.nextMap, 'cave_rochebrume1');
    assert.deepEqual([Math.floor(entry.nextX / 32), Math.floor(entry.nextY / 32)], [13, 18]);
    for (let n = 1; n <= 3; n++) {
        const name = `cave_rochebrume${n}`, config = world.find(m => m.mapName === name);
        const t = maps.changeMapData(name), c = maps.loadCollisionData(name);
        const gates = t.flat().filter(Boolean).length;
        assert.equal(config.mapchange.length, gates);
        for (const start of [[12, 18], [13, 18], [14, 18], ...(n < 3 ? [[12, 1], [13, 1], [14, 1]] : [])]) {
            const seen = reachable(name, start);
            t.forEach((row, y) => row.forEach((v, x) => {
                if (!v) return;
                assert.equal(c[y][x], 0);
                assert(seen.has(`${x}:${y}`), `${name}: portal ${x}:${y} from ${start}`);
                assert.equal(config.mapchange.filter(l => l.valX === x && l.valY === y).length, 1);
                const link = maps.getNextMap(name, x, y);
                const back = y === 19;
                assert.equal(link.nextMap, back ? n === 1 ? 'ville4' : `cave_rochebrume${n - 1}` : n === 3 ? 'route13' : `cave_rochebrume${n + 1}`);
                const dx = Math.floor(link.nextX / 32), dy = Math.floor(link.nextY / 32);
                assert.equal(maps.loadCollisionData(link.nextMap)[dy]?.[dx], 0);
                assert.equal(maps.changeMapData(link.nextMap)[dy]?.[dx], 0);
                assert.equal(link.blockedMessage, undefined);
            }));
        }
    }
});

test('northern caves use real cave combat scenery, dry weather and gradual wild encounters', async () => {
    const environment = await import('../vue-explorakit/src/services/battleEnvironment.js');
    const labels = await import('../vue-explorakit/src/services/mapLocations.js');
    const engine = require('../server/game/battle/battleEngine');
    const random = Math.random;
    try {
        for (let n = 1; n <= 3; n++) {
            const name = `cave_rochebrume${n}`, config = world.find(m => m.mapName === name);
            assert.equal(environment.battleEnvironment(name), 'cave');
            assert.equal(engine.createBattleState({ mapName: name }).weather.kind, null);
            assert.match(labels.getMapLocationLabel(name), /Grottes de Rochebrume/);
            assert.match(labels.getMapLocationLabel(name, 'en'), /Miststone Caves/);
            const c = maps.loadCollisionData(name), t = maps.changeMapData(name);
            const battle = maps.battleMapData(name);
            assert(battle.flat().some(Boolean));
            battle.forEach((row, y) => row.forEach((v, x) => { if (v) { assert.equal(c[y][x], 0); assert.equal(t[y][x], 0); } }));
            assert.deepEqual(config.level, { min: 47 + n, max: 49 + n });
            for (let i = 0; i < config.wildpokemon.length; i++) {
                Math.random = () => (i + .5) / config.wildpokemon.length;
                const pokemon = await CreatePokemon(name);
                assert.equal(pokemon.data.id, config.wildpokemon[i]);
                assert(pokemon.level >= config.level.min && pokemon.level <= config.level.max);
                assert.equal(pokemon.abilities.length, 4);
                assert(pokemon.movePp.every(pp => pp > 0));
            }
        }
    } finally { Math.random = random; }
});
