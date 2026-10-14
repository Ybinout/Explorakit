const test = require('node:test');
const assert = require('node:assert/strict');
const { createLobbyStore } = require('../server/game/drift/lobbyStore');
const { createRunManager } = require('../server/game/drift/runManager');
const { encode, decode } = require('../server/game/drift/checkpointCodec');
const effects = require('../server/game/drift/driftEffects');
const Pokemon = require('../server/game/models/Pokemon');
const factory = require('../server/game/drift/pokemonFactory');
function setup(clock) {
    const store = createLobbyStore({ now: () => clock.time });
    const runtime = createRunManager({
        store,
        namespace: { to: () => ({ emit() {} }) },
        now: () => clock.time,
        random: () => 0.1,
    });
    return { store, runtime };
}
test('restart restores battle identity, private fields, effects and paused timers', () => {
    const clock = { time: 100000 };
    const a = setup(clock);
    for (const id of [1, 2]) a.store.connect({ id, username: 'p' + id }, 's' + id);
    a.store.create({ id: 1 }, { capacity: 2, durationMinutes: 20 });
    a.store.join({ id: 2 }, a.store.snapshot({ id: 1 }).code);
    for (const id of [1, 2]) a.store.ready({ id }, true);
    a.runtime.start({ id: 1 });
    const p = a.runtime.playerFor({ id: 1 });
    const battle = a.runtime.battle(
        p,
        { npc: true, equipe: { pokemons: [factory.create(7, 5)] }, drifts: [], equipped: [], chain: 0 },
        'wild'
    );
    p.equipe.pokemons[0].currentHp = 7;
    const state = effects.states.get(p.equipe.pokemons[0]);
    state.shared.firstUsed = true;
    state.survival = true;
    const originalEnd = p.run.endsAt;
    const bytes = encode({ lobbies: a.store.exportLobbies(), runs: a.runtime.runs, savedAt: clock.time });
    clock.time += 600000;
    const b = setup(clock),
        saved = decode(bytes);
    b.store.restoreLobbies(saved.lobbies);
    b.runtime.restore(saved.runs, saved.savedAt);
    const q = b.runtime.playerFor({ id: 1 });
    assert(q.equipe.pokemons[0] instanceof Pokemon);
    assert.equal(q.equipe.pokemons[0].currentHp, 7);
    assert.equal(q.run.endsAt, originalEnd + 600000);
    assert.equal(q.socketId, null);
    assert.equal(q.battle.a, q);
    assert.equal(q.battle.token, battle.token);
    assert.equal(effects.states.get(q.equipe.pokemons[0]).owner, q);
    assert.equal(effects.states.get(q.equipe.pokemons[0]).shared.firstUsed, true);
    assert.equal(effects.states.get(q.equipe.pokemons[0]).survival, true);
    b.runtime.tick();
    assert.equal(q.alive, true);
    assert.equal(q.run.recoveryWaiting, true);
    for (const id of [1, 2]) {
        b.store.connect({ id }, 'new' + id);
        b.runtime.enter({ id }, { id: 'new' + id });
    }
    b.runtime.tick();
    assert.equal(q.run.recoveryWaiting, false);
    const restoredBattle = q.battle;
    assert.equal(q.battle.action(q, { action: 'attack', number: 0, turnId: q.battle.token }), true);
    restoredBattle.finish(q, 'finished');
    assert.equal(restoredBattle.finished, true);
    assert.equal(q.battle, null);
    assert(q.runReport.stats.battles >= 1);
});
test('corrupt snapshot is rejected instead of silently resetting games', () => {
    const data = encode({ runs: new Map() });
    data[Math.floor(data.length / 2)] ^= 255;
    assert.throws(() => decode(data));
});

test('storage failure suspends deadlines instead of eliminating players', () => {
    const clock = { time: 100000 },
        { store, runtime } = setup(clock);
    for (const id of [1, 2]) store.connect({ id, username: 'p' + id }, 's' + id);
    store.create({ id: 1 }, { capacity: 2, durationMinutes: 20 });
    store.join({ id: 2 }, store.snapshot({ id: 1 }).code);
    for (const id of [1, 2]) store.ready({ id }, true);
    runtime.start({ id: 1 });
    const player = runtime.playerFor({ id: 1 }),
        end = player.run.endsAt;
    runtime.setStorageAvailable(false);
    clock.time += 1800000;
    runtime.tick();
    assert.equal(player.run.phase, 'exploration');
    assert.equal(runtime.state(player).storagePaused, true);
    runtime.setStorageAvailable(true);
    runtime.tick();
    assert.equal(player.run.endsAt, end + 1800000);
    assert.equal(runtime.state(player).storagePaused, false);
});
