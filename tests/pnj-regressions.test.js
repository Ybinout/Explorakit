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

test('les personnages du Super Tournoi occupent leur corps entier, comme les autres PNJ', () => {
    const base = require('../server/game/world/pnjStore');
    const {scopedStore, actors} = require('../server/realtime/handlers/superTournamentHandlers');
    const content = require('../server/game/superTournament/content');
    let run = {room: 0, phase: 'ready'};
    const store = scopedStore(base, () => run);
    for (const map of [content.MAPS.lobby, content.MAPS.room]) {
        for (let room = 0; room < content.roster.length * 2; room++) {
            run.room = room;
            const actor = actors(map, run)[0];
            assert(actor);
            for (const y of [actor.y - 1, actor.y]) {
                assert.equal(store.isPnjBlockingTile(map, actor.x, y), true, `${actor.name} ${actor.x}:${y}`);
                assert.equal(store.getPnjAtTile(map, actor.x, y).interactionName, actor.interactionName);
            }
            for (const [x, y] of [[actor.x - 1, actor.y], [actor.x + (actor.blockingWidth || 1), actor.y],
                [actor.x, actor.y - 2], [actor.x, actor.y + 1]]) {
                assert.equal(store.isPnjBlockingTile(map, x, y), false, 'les cases voisines restent libres');
            }
        }
    }
});

test('les collisions du tournoi suivent la présence personnelle sans modifier les PNJ du monde', () => {
    const base = require('../server/game/world/pnjStore');
    const {scopedStore} = require('../server/realtime/handlers/superTournamentHandlers');
    const {MAPS} = require('../server/game/superTournament/content');
    let run = {room: 0, phase: 'ready'};
    const store = scopedStore(base, () => run), other = scopedStore(base, () => null);
    for (const phase of ['ready', 'battle', 'reward', 'cleared']) {
        run.phase = phase;
        assert(store.isPnjBlockingTile(MAPS.room, 13, 8));
        assert.equal(other.isPnjBlockingTile(MAPS.room, 13, 8), false);
    }
    run = null;
    assert.equal(store.isPnjBlockingTile(MAPS.room, 13, 8), false);
    assert.equal(store.getPnjAtTile(MAPS.room, 13, 8), null);
    assert(store.isPnjBlockingTile(MAPS.lobby, 13, 4), 'l’hôtesse reste présente hors tentative');
    assert.equal(store.isPnjBlockingTile(MAPS.sas, 13, 8), false);
    assert.equal(store.isPnjBlockingTile('ville1_arene', 13, 4), base.isPnjBlockingTile('ville1_arene', 13, 4));
});
