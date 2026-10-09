const test = require('node:test');
const assert = require('node:assert/strict');
const {
    HOME_RESPAWN_POINT,
    POKEMON_CENTER_RESPAWN_POINT,
    hasConsciousPokemon,
    healTeam,
    resolveRespawnPoint
} = require('../server/game/world/playerRecovery');

test('une equipe entierement KO est soignee completement', () => {
    const team = {
        pokemons: [
            { currentHp: 0, maxHp: 42, status: 'poison', __battle: { trappedTurns: 2 } },
            { currentHp: -5, maxHp: 87, status: 'sleep', __battle: { sleepTurns: 1 } }
        ]
    };

    assert.equal(hasConsciousPokemon(team), false);
    healTeam(team);
    assert.equal(hasConsciousPokemon(team), true);
    assert.deepEqual(team.pokemons.map((pokemon) => pokemon.currentHp), [42, 87]);
    assert.deepEqual(team.pokemons.map((pokemon) => pokemon.status), ['normal', 'normal']);
    assert.equal('__battle' in team.pokemons[0], false);
});

test('le dernier centre valide est utilise comme point de reapparition', () => {
    const savedPoint = { map: 'centre', x: 304, y: 432 };
    assert.deepEqual(resolveRespawnPoint(savedPoint), POKEMON_CENTER_RESPAWN_POINT);
});

test('la maison sert de repli sans centre enregistre', () => {
    assert.deepEqual(resolveRespawnPoint(null), HOME_RESPAWN_POINT);
    assert.deepEqual(resolveRespawnPoint({ map: '', x: 'invalide', y: null }), HOME_RESPAWN_POINT);
});
