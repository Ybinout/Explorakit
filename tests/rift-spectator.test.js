const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { Server } = require('socket.io');
const { io: client } = require('../vue-explorakit/node_modules/socket.io-client');
const { signAccessToken } = require('../server/config/auth');
const { registerDriftLobbies } = require('../server/realtime/driftLobbyHandler');
const { createLobbyStore } = require('../server/game/drift/lobbyStore');
const { createRunManager } = require('../server/game/drift/runManager');
const { calculateAccountReward } = require('../server/game/drift/accountReward');

function event(socket, name, predicate = () => true) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { socket.off(name, listener); reject(new Error(`Événement absent : ${name}`)); }, 4000);
        const listener = value => { if (predicate(value)) { clearTimeout(timer); socket.off(name, listener); resolve(value); } };
        socket.on(name, listener);
    });
}
function command(socket, name, payload = {}) {
    return new Promise((resolve, reject) => socket.timeout(4000).emit(name, payload, (error, value) => error ? reject(error) : resolve(value)));
}

test('RiftMon Socket : liste publique, trois joueurs, exemption spectatrice, confidentialité et fin réelle du duel', { timeout: 15000 }, async () => {
    const store = createLobbyStore();
    const server = http.createServer(), io = new Server(server);
    const cleanup = registerDriftLobbies(io, { store, sweepMs: 60000, runtimeOptions: { starterChoiceMs:0, random: () => .2, paceMs: 0 } });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const url = `http://127.0.0.1:${server.address().port}/drift`;
    const sockets = [], users = Array.from({ length: 4 }, (_, i) => ({ id: 601 + i, username: `Rift ${i}` }));
    async function connect(user) {
        const socket = client(url, { auth: { token: signAccessToken(user) }, autoConnect: false, transports: ['websocket'], forceNew: true, reconnection: false });
        sockets.push(socket);
        const ready = event(socket, 'drift:bootstrap'); socket.connect(); await ready;
        return socket;
    }
    try {
        for (const user of users) await connect(user);
        const [host, guest, third, outsider] = sockets;
        const announced = event(outsider, 'drift:lobbies', list => list.length === 1);
        const created = await command(host, 'drift:create', { capacity: 3, durationMinutes: 120, visibility: 'public' });
        assert.equal((await announced)[0].code, created.lobby.code);
        assert.deepEqual((await command(outsider, 'drift:list')).lobbies.map(l => l.hostName), ['Rift 0']);
        await command(guest, 'drift:join', { code: created.lobby.code });
        await command(third, 'drift:join', { code: created.lobby.code });
        assert.deepEqual((await command(outsider, 'drift:list')).lobbies, [], 'un salon complet sort de la recherche');
        for (const socket of [host, guest, third]) await command(socket, 'drift:ready', { ready: true });
        assert.equal((await command(host, 'drift:start')).ok, true);
        for (const socket of [host, guest, third]) await command(socket, 'drift:enter');
        const run = store.getLobby(users[0]).run;
        assert.equal(run.endsAt - run.startedAt, 120 * 60000);
        assert.equal((await command(host, 'drift:spectate', { matchId: 'none' })).success, false, 'aucun espionnage pendant l’exploration');
        cleanup.runtime.beginTournament(run);
        const match = run.matches.find(m => m.status === 'waiting');
        const watcher = [...run.players.values()].find(p => !match.players.includes(p.userId));
        const viewer = sockets[watcher.userId - 601];
        const [a, b] = match.players.map(id => run.players.get(id));
        const socketA = sockets[a.userId - 601], socketB = sockets[b.userId - 601];
        await command(socketA, 'drift:roundReady'); await command(socketB, 'drift:roundReady');
        const battle = a.battle;
        const captured = [];
        viewer.onAny((name, data) => captured.push({ name, data }));
        const frame = event(viewer, 'drift:spectator', data => data.active);
        assert.equal((await command(viewer, 'drift:spectate', { matchId: match.id })).success, true);
        const initial = await frame;
        assert.equal(initial.matchId, match.id);
        assert.deepEqual(initial.players.map(p => p.id), match.players);
        assert.deepEqual(Object.keys(initial.players[0].pokemon).sort(), ['currentHp', 'level', 'maxHp', 'name', 'pokemonId', 'status']);
        assert.equal(JSON.stringify(initial).includes(battle.token), false, 'le jeton de tour reste privé');
        assert.equal((await command(viewer, 'actionResponse', { action: 'flee', turnId: battle.token })).success, false);
        assert.equal(battle.pending.size, 0, 'le spectateur ne soumet aucune action au duel');
        assert.equal((await command(socketA, 'drift:spectate', { matchId: match.id })).success, false);
        assert.equal((await command(outsider, 'drift:spectate', { matchId: match.id })).success, false);

        const changed = event(viewer, 'drift:spectator', data => data.active && data.log.includes('Le duel continue.'));
        battle.say('Le duel continue.'); assert.equal((await changed).players.length, 2);
        const stopped = event(viewer, 'drift:spectator', data => !data.active && data.reason === 'stopped');
        await command(viewer, 'drift:stopSpectating'); await stopped;
        await command(viewer, 'drift:spectate', { matchId: match.id });
        const replaced = event(viewer, 'drift:spectator', data => data.reason === 'replaced');
        const replacement = await connect(users[watcher.userId - 601]);
        await command(replacement, 'drift:enter'); await replaced;
        assert.equal((await command(viewer, 'drift:spectate', { matchId: match.id })).success, false);
        await command(replacement, 'drift:spectate', { matchId: match.id });

        const ended = event(replacement, 'drift:spectator', data => data.active === false && data.reason === 'finished');
        // A real submitted forfeit resolves the match and advances the survivor plus the exempt player.
        await command(socketA, 'actionResponse', { action: 'flee', turnId: battle.token });
        await command(socketB, 'actionResponse', { action: 'attack', number: 0, turnId: battle.token });
        const result = await ended;
        assert.equal(result.winnerId, b.userId); assert.equal(result.players.length, 2); assert.ok(result.log.includes('Le duel continue.'));
        assert.equal(watcher.watchingMatchId, null); assert.equal(run.round, 2);
        assert.ok(!captured.some(e => ['requestAction', 'battletrigger', 'endbattle', 'introAnimation'].includes(e.name)), 'le spectateur n’est jamais branché aux événements du combattant');
        const finalMatch = run.matches.find(m => m.round === 2);
        for (const id of finalMatch.players) await command(id === watcher.userId ? replacement : sockets[id - 601], 'drift:roundReady');
        const eliminated = socketA;
        const eliminationView = event(eliminated, 'drift:spectator', data => data.active);
        assert.equal((await command(eliminated, 'drift:spectate', { matchId: finalMatch.id })).success, true, 'un éliminé peut rester spectateur');
        await eliminationView;
        assert.equal((await command(eliminated, 'drift:exit')).success, true);
        assert.equal(a.watchingMatchId, null);
        assert.equal((await command(eliminated, 'drift:spectate', { matchId: finalMatch.id })).success, false, 'quitter retire le droit de suivre la partie');
    } finally {
        sockets.forEach(socket => socket.disconnect()); cleanup(); await new Promise(resolve => io.close(resolve));
    }
});

test('comptage RiftMon : lancement verrouillé, panne sans départ, retry idempotent et règlement conservé jusqu’au succès', async () => {
    let clock = 1000, startCalls = 0, finishCalls = 0, rejectStart, resolveStart;
    const registeredIds = [], settlements = [];
    const accountRepository = {
        recordRunStarted(run) { startCalls++; registeredIds.push(run.id); return new Promise((resolve, reject) => { resolveStart = resolve; rejectStart = reject; }); },
        async recordRunFinished(run) {
            finishCalls++; settlements.push(run);
            if (finishCalls === 1) throw new Error('panne SQL simulée');
            const reward = calculateAccountReward(2, run.explorationMs, run.winnerId !== null);
            return { recorded: true, winnerId: run.winnerId, coinsAwarded: reward.coinsAwarded, reward };
        }
    };
    const store = createLobbyStore({ now: () => clock });
    const runtime = createRunManager({ starterChoiceMs:0, store, namespace: { to: () => ({ emit() {} }) }, now: () => clock, accountRepository });
    const users = [{ id: 1, username: 'Un' }, { id: 2, username: 'Deux' }];
    for (const user of users) store.connect(user, `s${user.id}`);
    const { code } = store.create(users[0], { capacity: 2, durationMinutes: 120 }); store.join(users[1], code);
    for (const user of users) store.ready(user, true);
    const first = runtime.start(users[0]); await Promise.resolve();
    assert.throws(() => runtime.start(users[0]), { code: 'starting' });
    assert.throws(() => store.leave(users[1]), { code: 'starting' });
    assert.throws(() => store.configure(users[0], { capacity: 3, durationMinutes: 20 }), { code: 'starting' });
    assert.equal(store.getLobby(users[0]).run, undefined);
    rejectStart(new Error('indisponible')); await assert.rejects(first, /indisponible/);
    assert.equal(store.getLobby(users[0]).run, undefined);
    const second = runtime.start(users[0]); await Promise.resolve(); clock += 500;
    resolveStart({ recorded: true }); assert.equal((await second).phase, 'exploration');
    assert.equal(startCalls, 2); assert.equal(registeredIds[0], registeredIds[1], 'la tentative SQL utilise un identifiant stable');
    const run = store.getLobby(users[0]).run;
    assert.equal(run.endsAt - clock, 120 * 60000, 'le chrono commence après le comptage');
    users.forEach(user => runtime.enter(user, { id: `s${user.id}` }));
    const warn = console.error; const errors = [];
    console.error = (...args) => errors.push(args.join(' '));
    try {
        clock += 20 * 60000;
        runtime.abandon(run.players.get(2));
        await run.settling;
        assert.equal(run.phase, 'results'); assert.equal(runtime.state(run.players.get(1)).settlement.status, 'pending');
        assert.equal(errors.length, 1);
        runtime.tick(); assert.equal(finishCalls, 1, 'pas de boucle SQL pendant la panne');
        clock += 120001; runtime.tick();
        assert.equal(runtime.runs.has(run.id), true, 'un règlement non confirmé ne disparaît pas après deux minutes');
        await run.settling;
        assert.equal(finishCalls, 2); assert.equal(run.settlement.status, 'complete');
        assert.equal(run.settlement.coinsAwarded, 100); assert.equal(settlements[1].winnerId, 1);
        assert.equal(settlements[0].explorationMs, 20 * 60000);
        assert.equal(settlements[1].explorationMs, settlements[0].explorationMs, 'la panne SQL ne rallonge pas l’exploration rémunérée');
        assert.equal(run.report.accountReward.coinsAwarded, 100);
        assert.deepEqual(runtime.state(run.players.get(1)).settlement.reward, run.report.accountReward);
        assert.deepEqual(settlements[1].players.map(p => p.id), [1, 2]);
        runtime.tick(); assert.equal(runtime.runs.has(run.id), false); assert.equal(finishCalls, 2);
    } finally { console.error = warn; }
});
