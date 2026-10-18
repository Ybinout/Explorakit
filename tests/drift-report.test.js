const test = require('node:test');
const assert = require('node:assert/strict');
const { createLobbyStore, RECONNECT_MS } = require('../server/game/drift/lobbyStore');
const { createRunManager } = require('../server/game/drift/runManager');
const factory = require('../server/game/drift/pokemonFactory');
const economy = require('../server/game/drift/economy');
const report = require('../server/game/drift/runReport');
const effects = require('../server/game/drift/driftEffects');

function fixture(size = 2, random = () => 0) {
    let time = 1000;
    const store = createLobbyStore({ now: () => time });
    const messages = [];
    const runtime = createRunManager({ starterChoiceMs:0, store, namespace: { to: id => ({ emit: (event, payload) => messages.push({ id, event, payload }) }) }, now: () => time, random, paceMs: 0 });
    const users = Array.from({ length: size }, (_, i) => ({ id: i + 1, username: `Joueur ${i + 1}` }));
    users.forEach(user => store.connect(user, `s${user.id}`));
    const { code } = store.create(users[0], { capacity: size, durationMinutes: 20 });
    users.slice(1).forEach(user => store.join(user, code));
    users.forEach(user => store.ready(user, true));
    runtime.start(users[0]); users.forEach(user => runtime.enter(user, { id: `s${user.id}` }));
    const run = store.getLobby(users[0]).run;
    return { runtime, run, messages, users, a: run.players.get(1), b: run.players.get(2), advance: ms => { time += ms; runtime.tick(); } };
}
const npc = (id = 19, level = 5) => ({ npc: true, equipe: { pokemons: [factory.create(id, level)] }, drifts: [], equipped: [], chain: 0 });
function kill(p, battle) { p.equipe.pokemons.forEach(pokemon => effects.damage(pokemon, pokemon.currentHp)); battle.prune(); battle.checkEnd(); }

test('bilan final conserve les deux équipes avant purge et leurs stats, reste privé avant résultats et immuable ensuite', () => {
    const f = fixture();
    const initial = f.a.equipe.pokemons[0];
    const initialIv = { ...initial.iv };
    f.runtime.beginTournament(f.run);
    assert.equal(Object.hasOwn(f.runtime.state(f.a), 'report'), false);
    assert.equal(Object.hasOwn(f.runtime.state(f.b), 'report'), false);
    f.runtime.ready(f.a); f.runtime.ready(f.b);
    const battle = f.a.battle;
    const loserUuid = f.b.equipe.pokemons[0].uuid;
    kill(f.b, battle);
    const result = f.runtime.state(f.a).report;
    assert.equal(result.version, 1); assert.equal(result.winnerId, f.a.userId);
    assert.deepEqual(result.rules, { capacity: 2, durationMinutes: 20, visibility: 'private' });
    assert.deepEqual(f.a.equipe.pokemons, []); assert.deepEqual(f.b.equipe.pokemons, []);
    assert.equal(result.players.length, 2);
    const winner = result.players.find(p => p.id === f.a.userId), loser = result.players.find(p => p.id === f.b.userId);
    assert.equal(winner.team[0].uuid, initial.uuid); assert.equal(winner.starter.level, 5);
    assert.deepEqual(winner.team[0].ivs, initialIv); assert.equal(winner.team[0].potential, initial.k);
    assert.equal(winner.team[0].stats.hp, initial.maxHp); assert.equal(winner.team[0].moves.length, initial.abilities.length);
    assert.equal(winner.tournamentTeam[0].lostAt, null);
    assert.equal(loser.team[0].uuid, loserUuid); assert.equal(loser.team[0].lostAt, 1000);
    assert.equal(loser.stats.pokemonLost, 1); assert.equal(loser.stats.defeats, 1); assert.equal(winner.stats.pvpWins, 1);
    const serialized = JSON.stringify(result);
    initial.iv.hp = 0; initial.level = 999;
    f.a.runReport.events.push({ text: 'late mutation' });
    battle.finish(f.a, 'finished');
    assert.equal(JSON.stringify(f.runtime.state(f.b).report), serialized);
    assert.ok(Object.isFrozen(result.players[0].team[0]));
    assert.ok(!serialized.includes('socketId')); assert.ok(!serialized.includes('battleState'));
    assert.ok(!serialized.includes('password')); assert.ok(!serialized.includes('disconnectedAt'));
    assert.ok(f.messages.filter(message => message.event === 'drift:state' && message.payload.phase !== 'results').every(message => !message.payload.report));
});

test('captures, pertes, XP partagée, monnaie et objets du bilan proviennent des actions réellement exécutées', () => {
    const f = fixture(4), p = f.a;
    const wild = npc(); const captured = wild.equipe.pokemons[0];
    const capture = f.runtime.battle(p, wild, 'wild');
    capture.action(p, { action: 'bag', itemKey: 'pokeball', turnId: capture.token });
    assert.equal(p.equipe.pokemons.length, 2);
    const captureDrift = p.drifts[0];
    assert.ok(captureDrift);
    p.equipe.pokemons[0].currentHp--;
    economy.usePotion(p, 'drift_potion', p.equipe.pokemons[0].uuid, () => .99);
    const enemy = npc(19, 10), battle = f.runtime.battle(p, enemy, 'arena', 'arena_report');
    const startingXp = p.equipe.pokemons.reduce((sum, pokemon) => sum + pokemon.experience, 0);
    const startingLevels = p.equipe.pokemons.reduce((sum, pokemon) => sum + pokemon.level, 0);
    battle.reward(enemy.equipe.pokemons[0]); battle.reward(enemy.equipe.pokemons[0]);
    const xp = p.equipe.pokemons.reduce((sum, pokemon) => sum + pokemon.experience, 0) - startingXp;
    const levels = p.equipe.pokemons.reduce((sum, pokemon) => sum + pokemon.level, 0) - startingLevels;
    battle.finish(p, 'finished');
    const earned = p.money - 500;
    assert.equal(p.drifts.length, 1);
    const drift = p.drifts[0];
    assert.equal(drift.uuid, captureDrift.uuid);assert.equal(drift.rarity, 'rare');assert.equal(p.runReport.stats.driftsFused, 1);
    economy.equip(p, drift.uuid, true); economy.equip(p, drift.uuid, false);
    p.currentmap = 'ville1_shop'; economy.remove(p, drift.uuid, true);
    economy.buy(p, 'drift_potion', 1);
    f.runtime.abandon(p);
    for (const other of [...f.run.players.values()].filter(player => player !== p && player.userId !== 4)) f.runtime.abandon(other);
    const archived = f.run.report.players.find(player => player.id === p.userId);
    assert.equal(archived.stats.battles, 2); assert.equal(archived.stats.arenaWins, 1);
    assert.equal(archived.stats.captures, 1); assert.equal(archived.stats.captureAttempts, 1);
    assert.equal(archived.stats.xpGained, xp); assert.equal(archived.stats.levelsGained, levels);
    assert.equal(archived.stats.moneyEarned, earned + economy.prices[drift.rarity]);
    assert.equal(archived.stats.moneySpent, 100); assert.equal(archived.stats.potionsUsed, 1);
    assert.equal(archived.stats.driftsFound, 2); assert.equal(archived.stats.driftsSold, 1);
    assert.equal(archived.drifts.find(d => d.uuid === drift.uuid).status, 'sold');
    assert.equal(archived.drifts.find(d => d.source === 'arena').status, 'fused');
    assert.equal(archived.drifts.find(d => d.uuid === captureDrift.uuid).source, 'capture');
    assert.equal(archived.drifts.find(d => d.uuid === captureDrift.uuid).status, 'sold');
    assert.equal(archived.equippedDrifts.length, 0);
    assert.equal(archived.pokemon.find(pokemon => pokemon.uuid === captured.uuid).source, 'capture');
    assert.equal(archived.reason, 'forfeit'); assert.equal(archived.team.length, 2);
    assert.ok(archived.pokemon.every(pokemon => pokemon.lostAt === null), 'abandon does not invent Pokémon deaths');
    assert.ok(archived.events.some(event => event.type === 'purchase'));
});

test('pertes partielles puis élimination totale gardent le mémorial et la dernière équipe de combat', () => {
    const f = fixture(4), p = f.a;
    const old = p.equipe.pokemons[0]; const next = factory.create(7, 10); p.equipe.pokemons.push(next);
    const first = f.runtime.battle(p, npc(), 'wild');
    effects.damage(old, old.currentHp); first.prune(); first.finish(null, 'fled');
    f.advance(200);
    const second = f.runtime.battle(p, npc(), 'wild'); kill(p, second);
    assert.equal(p.alive, false); assert.equal(f.runtime.state(p).report, undefined);
    f.runtime.abandon(f.run.players.get(3)); f.runtime.abandon(f.run.players.get(4));
    const archived = f.run.report.players.find(player => player.id === p.userId);
    assert.equal(archived.pokemon.length, 2); assert.equal(archived.stats.pokemonLost, 2);
    assert.deepEqual(archived.team.map(pokemon => pokemon.uuid), [next.uuid]);
    assert.equal(archived.pokemon.find(pokemon => pokemon.uuid === old.uuid).lostAt, 1000);
    assert.equal(archived.team[0].lostAt, 1200); assert.equal(archived.stats.fled, 1);
    assert.equal(archived.survivedMs, 200);
});

test('abandon pendant combat, déconnexion, interruption du timer et double K.O. gardent des bilans fidèles', () => {
    const f = fixture(); const uuid = f.a.equipe.pokemons[0].uuid;
    f.runtime.battle(f.a, npc(), 'wild'); f.runtime.abandon(f.a);
    assert.equal(f.run.report.players[0].team[0].uuid, uuid);
    assert.equal(f.run.report.players[0].team[0].lostAt, null);
    assert.equal(f.run.report.players[0].reason, 'forfeit');
    assert.equal(f.run.report.players[0].stats.battles, 1);
    const g = fixture(); g.runtime.disconnect(g.users[0], { id: 's1' }); g.advance(RECONNECT_MS + 1);
    assert.equal(g.run.report.players[0].reason, 'disconnected');
    const h = fixture(); h.runtime.battle(h.a, npc(), 'wild'); h.runtime.beginTournament(h.run);
    h.runtime.ready(h.a); h.runtime.ready(h.b);
    const duel = h.a.battle;
    for (const p of [h.a, h.b]) effects.damage(p.equipe.pokemons[0], p.equipe.pokemons[0].currentHp);
    duel.prune(); duel.checkEnd();
    assert.equal(h.run.report.winnerId, null);
    assert.equal(h.run.report.players[0].stats.interrupted, 1);
    assert.ok(h.run.report.players.every(player => player.stats.draws === 1 && player.stats.pokemonLost === 1 && player.team.length === 1));
});

test('journal borné conserve les compteurs complets et explique les événements écartés', () => {
    const f = fixture();
    for (let i = 0; i < report.MAX_EVENTS + 30; i++) { report.event(f.a, 'test', `événement ${i}`); report.increment(f.a, 'steps'); }
    report.visit(f.a, 'maison'); report.visit(f.a, 'start');
    f.runtime.abandon(f.b);
    const result = f.run.report.players.find(player => player.id === f.a.userId);
    assert.equal(result.events.length, report.MAX_EVENTS); assert.ok(result.eventsOmitted > 30);
    assert.equal(result.stats.steps, report.MAX_EVENTS + 30);
    assert.deepEqual(result.visitedMaps.map(visit => visit.map), ['start', 'maison']);
    assert.equal(result.events.at(-1).type, 'end');
});

test('journal des adversaires affiche les prénoms du récit et masque les identifiants techniques inconnus', () => {
    const f = fixture();
    for (const [type, key, expected] of [
        ['trainer', 'dia1', 'Combat contre Timmy.'],
        ['trainer', 'town_ines', 'Combat contre Inès.'],
        ['arena', 'champion_hoze', 'Combat d’arène contre Hoze.'],
        ['arena', 'unknown_arena_fixture', 'Combat d’arène contre un champion.'],
        ['trainer', 'unknown_trainer_fixture', 'Combat contre un dresseur.']
    ]) {
        const battle = f.runtime.battle(f.a, npc(), type, key);
        assert.equal(f.a.runReport.events.filter(event => event.type === 'battle').at(-1).text, expected);
        battle.finish(null, 'fled');
    }
});

test('collections bornées préservent les compagnons vivants et les cinq emplacements dans leur ordre réel', () => {
    const f = fixture(), starter = f.a.equipe.pokemons[0];
    for (let i = 0; i < report.MAX_COLLECTION + 3; i++) {
        const pokemon = { ...starter, uuid: `fallen-${i}`, currentHp: 0 };
        report.capture(f.a, pokemon); report.lost(f.a, pokemon);
        const drift = { uuid: `drift-${i}`, definitionId: `DRF-${String(i % 59 + 1).padStart(3,'0')}`, rarity: 'common' };
        f.a.drifts.push(drift); report.driftFound(f.a, drift, 'wild');
    }
    const equipped = [f.a.drifts.at(-1), f.a.drifts[1]];
    equipped.forEach(drift => economy.equip(f.a, drift.uuid, true));
    f.runtime.beginTournament(f.run);
    f.runtime.abandon(f.b);
    const archived = f.run.report.players[0];
    assert.equal(archived.pokemon.length, report.MAX_COLLECTION);
    assert.ok(archived.pokemonOmitted > 0); assert.ok(archived.driftsOmitted > 0);
    assert.equal(archived.team[0].uuid, starter.uuid); assert.equal(archived.tournamentTeam[0].uuid, starter.uuid);
    assert.deepEqual(archived.equippedDrifts.map(drift => drift.uuid), equipped.map(drift => drift.uuid));
    assert.equal(archived.stats.pokemonLost, report.MAX_COLLECTION + 3);
});
