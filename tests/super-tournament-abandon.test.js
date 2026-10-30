const test = require('node:test'), assert = require('node:assert/strict');
const {TournamentController} = require('../server/game/superTournament/controller');
const codec = require('../server/game/drift/checkpointCodec');
const factory = require('../server/game/drift/pokemonFactory');
const {getPokemonCenterRespawnPoint} = require('../server/game/world/playerRecovery');
const party = () => ({pokemons: [9, 94, 212].map(id => factory.create(id, 100, true))});

function setup() {
    let version = 0, snapshot = null, fail = false, travelFail = false;
    const saves = [], events = [], trips = [];
    const player = {id: 'owner', username: 'tester', centerReturnPoint: {map: 'route4', x: 720, y: 144}};
    const persist = {
        async load() {return {version, run: snapshot ? codec.decode(snapshot) : null};},
        async save(id, run, expected, final) {
            assert.equal(id, 1); assert.equal(expected, version);
            if (fail) {fail = false; throw Error('storage unavailable');}
            saves.push({run: Boolean(run), final}); snapshot = run ? codec.encode(run) : null;
            return ++version;
        }
    };
    const create = () => new TournamentController({userId: 1, persist, getPlayer: () => player,
        emit: (name, data) => events.push({name, data}),
        travel: async destination => {trips.push(destination); if (travelFail) throw Error('connection lost');}});
    return {c: create(), create, player, saves, events, trips, fail: () => {fail = true;}, failTravel: () => {travelFail = true;}};
}
async function stage(c, phase, team = party()) {
    await c.register(team);
    if (['battle', 'replacement'].includes(phase)) {
        await c.next(); await c.atomic(() => c.startBattle());
        if (phase === 'replacement') await c.atomic(() => {
            const b = c.run.battle; b.a.equipe.pokemons[0].currentHp = 0; b.prune(); b.awaiting = false; b.request();
        });
    } else await c.atomic(() => {c.run.phase = phase;});
    await c.atomic(() => {c.run.score = 1300; c.run.cleared = 4;});
}
for (const phase of ['sas', 'ready', 'battle', 'replacement', 'reward', 'cleared']) {
    test(`${phase}: abandon commits score, closes the battle and returns to the last Center without touching Adventure`, async () => {
        const f = setup(), original = party(), before = codec.encode(original);
        await stage(f.c, phase, original); const battle = f.c.run.battle;
        const start = f.events.length;
        assert.equal(await f.c.execute(() => f.c.abandon()), true);
        assert.equal(f.c.active, false); assert.equal(f.player.inbattle, false);
        assert.deepEqual(f.trips, [getPokemonCenterRespawnPoint()]);
        assert.deepEqual(f.player.centerReturnPoint, {map: 'route4', x: 720, y: 144});
        assert.deepEqual(f.saves.at(-1), {run: false, final: {score: 1300, rooms: 4, returnToCenter: true}});
        const finished = f.events.slice(start).filter(e => e.name === 'superTournamentFinished');
        assert.equal(finished.length, 1); assert.equal(finished[0].data.reason, 'abandoned');
        assert.equal(finished[0].data.score, 1300);
        if (battle) {
            assert(battle.finished);
            assert.equal(f.events.slice(start).filter(e => e.name === 'endbattle').length, 1);
            assert.equal(f.events.slice(start).find(e => e.name === 'endbattle').data.tournamentAbandoned, true);
            assert(!f.events.slice(start).some(e => e.name === 'teamStateChanged'));
        }
        assert.deepEqual(codec.encode(original), before);
        assert.equal(await f.c.action({action: 'attack', turnId: battle?.token, number: 0}), false);
        assert.equal(await f.c.tick(), false); assert.equal(await f.c.abandon(), false);
        assert.equal(f.trips.length, 1);
        const resumed = f.create(); await resumed.load(); assert.equal(resumed.active, false);
    });
}
test('failed abandonment save restores the live resources and prompt and emits neither a final result nor a teleport', async () => {
    const f = setup(); await stage(f.c, 'battle'); const before = codec.encode(f.c.run), start = f.events.length;
    f.fail(); await assert.rejects(() => f.c.abandon(), /storage unavailable/);
    const previous = codec.decode(before);
    const resources = team => team.pokemons.map(p => ({uuid: p.uuid, currentHp: p.currentHp, status: p.status, movePp: p.movePp, heldItem: p.heldItem}));
    assert.deepEqual(resources(f.c.run.player.equipe), resources(previous.player.equipe));
    assert.deepEqual(resources(f.c.run.battle.b.equipe), resources(previous.battle.b.equipe));
    assert.equal(f.c.run.battle.token, previous.battle.token); assert.equal(f.c.run.battle.finished, false);
    assert.deepEqual(f.c.run.battle.state, previous.battle.state); assert.equal(f.c.run.score, previous.score);
    assert.equal(f.player.inbattle, true);
    assert(!f.events.slice(start).some(e => ['endbattle', 'superTournamentFinished'].includes(e.name)));
    assert.equal(f.trips.length, 0);
    assert.equal(await f.c.abandon(), true); assert.equal(f.trips.length, 1);
});
test('simultaneous abandonment requests cannot finalize or teleport twice', async () => {
    const f = setup(); await stage(f.c, 'reward');
    assert.deepEqual(await Promise.all([f.c.execute(() => f.c.abandon()), f.c.execute(() => f.c.abandon())]), [true, false]);
    assert.equal(f.trips.length, 1);
    assert.equal(f.events.filter(e => e.name === 'superTournamentFinished').length, 1);
});
test('lost map delivery after commit keeps the finalized run and the durable Center return instruction', async () => {
    const f = setup(); await stage(f.c, 'battle'); f.failTravel();
    await assert.rejects(() => f.c.abandon(), /connection lost/);
    assert.equal(f.c.active, false); assert.equal(f.saves.at(-1).final.returnToCenter, true);
    const resumed = f.create(); await resumed.load(); assert.equal(resumed.active, false);
});
