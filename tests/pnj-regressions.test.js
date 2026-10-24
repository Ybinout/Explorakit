const test = require('node:test');
const assert = require('node:assert/strict');

const { getPnjTeam } = require('../server/game/world/pnjTeamFactory');
const { getPnjsForMap, isPnjBlockingTile } = require('../server/game/world/pnjStore');

test('une nouvelle equipe de PNJ est creee pour chaque combat', () => {
    const firstTeam = getPnjTeam('moonpunch');
    const secondTeam = getPnjTeam('moonpunch');

    assert.ok(firstTeam);
    assert.ok(secondTeam);
    assert.notStrictEqual(firstTeam, secondTeam);
    assert.notStrictEqual(firstTeam.pokemons[0], secondTeam.pokemons[0]);

    const initialSecondTeamHp = secondTeam.pokemons[0].currentHp;
    firstTeam.pokemons[0].currentHp = 0;

    assert.equal(secondTeam.pokemons[0].currentHp, initialSecondTeamHp);
});

test('la configuration PNJ charge moonpunch dans l’arène de ville1', () => {
    const pnjs = getPnjsForMap('ville1_arene');
    const moonpunch = pnjs.find((pnj) => pnj.name === 'moonpunch');

    assert.ok(moonpunch);
    assert.equal(moonpunch.interactionName, 'moon');
    assert.equal(isPnjBlockingTile('ville1_arene', 13, 4), true);
});
