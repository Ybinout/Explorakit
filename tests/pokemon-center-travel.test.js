const test = require('node:test');
const assert = require('node:assert/strict');
const { getPokemonCenterEntryReturn, getPokemonCenterExit, normalizeCenterReturnPoint } = require('../server/game/world/pokemonCenterTravel');
const { buildPositionSnapshot, positionsAreEqual } = require('../server/realtime/playerState');

test('chaque entrée du centre retourne à son propre parvis, pas à une ville fixe', () => {
    for (const [map, doorX, doorY, x, y] of [
        ['ville1', 15, 8, 15, 9], ['route4', 22, 3, 22, 4], ['route4', 27, 3, 26, 3]
    ]) {
        const previous = { x: x * 32 + 16, y: y * 32 + 16 };
        const point = getPokemonCenterEntryReturn(map, doorX, doorY, previous);
        assert.deepEqual(point, { map, ...previous });
        assert.deepEqual(getPokemonCenterExit(point), point);
        assert.deepEqual(getPokemonCenterExit(JSON.parse(JSON.stringify(point))), point);
    }
});

test('le retour refuse les murs, tuiles de changement, cartes étrangères et coordonnées non alignées', () => {
    for (const point of [null, { map: 'start', x: 80, y: 208 }, { map: '../centre', x: 80, y: 208 },
        { map: 'route4', x: 720, y: 112 }, { map: 'route4', x: 721, y: 144 }, { map: 'route4', x: 16, y: 16 }]) {
        assert.equal(normalizeCenterReturnPoint(point), null);
    }
    assert.deepEqual(getPokemonCenterExit(null), { map: 'ville1', x: 496, y: 304 });
    assert.equal(getPokemonCenterEntryReturn('ville1', 20, 8, { x: 656, y: 304 }), null, 'la boutique ne crée pas de retour de centre');
});

test('une entrée par une tuile change voisine choisit un parvis sûr dans la même zone', () => {
    assert.deepEqual(getPokemonCenterEntryReturn('route4', 27, 3, { x: 880, y: 144 }), { map: 'route4', x: 848, y: 112 });
});

test('la sauvegarde de position détecte aussi un changement du retour de centre', () => {
    const player = { currentmap: 'centre', x: 432, y: 464, centerReturnPoint: { map: 'route4', x: 720, y: 144 } };
    const before = buildPositionSnapshot(player);
    player.centerReturnPoint = { map: 'ville1', x: 496, y: 304 };
    assert.equal(positionsAreEqual(before, buildPositionSnapshot(player)), false);
    assert.deepEqual(before.centerReturnPoint, { map: 'route4', x: 720, y: 144 });
    assert.equal(positionsAreEqual(before, JSON.parse(JSON.stringify(before))), true);
});
