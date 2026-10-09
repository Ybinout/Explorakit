const test = require('node:test');
const assert = require('node:assert/strict');

const {
    arePlayersCloseEnough,
    getDirectionFromAction,
    getPlayersInMap,
    sanitizeSpawnPosition
} = require('../server/realtime/playerState');

test('les joueurs ne peuvent interagir que sur la même carte et à une tuile', () => {
    const player = { x: 48, y: 48, currentmap: 'start' };
    assert.equal(arePlayersCloseEnough(player, { x: 80, y: 48, currentmap: 'start' }), true);
    assert.equal(arePlayersCloseEnough(player, { x: 112, y: 48, currentmap: 'start' }), false);
    assert.equal(arePlayersCloseEnough(player, { x: 48, y: 48, currentmap: 'ville1' }), false);
});

test('les actions de déplacement sont limitées aux quatre commandes connues', () => {
    assert.equal(getDirectionFromAction('move_z'), 'up');
    assert.equal(getDirectionFromAction('move_d'), 'right');
    assert.equal(getDirectionFromAction('teleport'), null);
});

test('la liste publique est filtrée par carte et sans équipe', () => {
    const visible = getPlayersInMap({
        a: { id: 'a', userId: 1, username: 'A', x: 16, y: 16, currentmap: 'start', equipe: { pokemons: [1] } },
        b: { id: 'b', userId: 2, username: 'B', x: 16, y: 16, currentmap: 'ville1', equipe: { pokemons: [2] } }
    }, 'start');
    assert.deepEqual(Object.keys(visible), ['a']);
    assert.equal('equipe' in visible.a, false);
});

test('une position hors carte revient sur une tuile praticable', () => {
    const collisionMap = [[1, 0], [1, 1]];
    assert.deepEqual(sanitizeSpawnPosition(9999, 9999, collisionMap, 'carte-test'), { x: 48, y: 16 });
});
