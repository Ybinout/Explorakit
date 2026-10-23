const testAppearanceRepository = { async loadUserSprite(){return 'sprite.png';}, async saveUserSprite(){} };
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { Server } = require('socket.io');
const { io: client } = require('../vue-explorakit/node_modules/socket.io-client');
const { signAccessToken } = require('../server/config/auth');
const { registerDriftLobbies } = require('../server/realtime/driftLobbyHandler');

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

test('Socket Drift réel : authentification, groupe synchronisé, confidentialité, reprise et isolation Aventure', { timeout: 15000 }, async () => {
    const server = http.createServer();
    const io = new Server(server);
    const cleanup = registerDriftLobbies(io, { appearanceRepository:testAppearanceRepository, runtimeOptions:{starterChoiceMs:0}, sweepMs: 60000 });
    let adventureConnections = 0;
    io.on('connection', () => adventureConnections++);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const url = `http://127.0.0.1:${server.address().port}/drift`;
    const sockets = [];
    const make = token => {
        const socket = client(url, { auth: { token }, autoConnect: false, transports: ['websocket'], reconnection: false, forceNew: true });
        sockets.push(socket);
        return socket;
    };
    try {
        const forbidden = make('invalid-token');
        const rejected = event(forbidden, 'connect_error');
        forbidden.connect();
        assert.match((await rejected).message, /Session invalide/);
        const a = make(signAccessToken({ id: 71, username: 'Alice' }));
        const b = make(signAccessToken({ id: 72, username: 'Bob' }));
        const c = make(signAccessToken({ id: 73, username: 'Chloé' }));
        for (const socket of [a, b, c]) {
            const ready = event(socket, 'drift:bootstrap');
            socket.connect();
            assert.equal((await ready).catalogue.definitions.length, 59);
        }
        const privateState = event(c, 'drift:lobby');
        const created = await command(a, 'drift:create', { capacity: 2, durationMinutes: 20, userId: 999 });
        assert.equal(created.ok, true);
        assert.equal(created.lobby.hostId, 71, 'identité issue du jeton');
        assert.equal(await privateState, null, 'le tiers ne reçoit pas le salon privé');
        const joined = event(a, 'drift:lobby', lobby => lobby?.players.length === 2);
        assert.equal((await command(b, 'drift:join', { code: created.lobby.code })).ok, true);
        assert.equal((await joined).players[1].username, 'Bob');
        assert.equal((await command(c, 'drift:join', { code: created.lobby.code })).code, 'lobby_full');
        assert.equal((await command(b, 'drift:configure', { capacity: 16, durationMinutes: 60 })).code, 'host_only');
        const ready = event(a, 'drift:lobby', lobby => lobby?.players.find(player => player.id === 72)?.ready);
        await command(b, 'drift:ready', { ready: true });
        await ready;
        const absent = event(a, 'drift:lobby', lobby => lobby?.players.some(player => !player.connected));
        b.disconnect();
        await absent;
        const resumed = event(b, 'drift:lobby', lobby => lobby?.players.length === 2);
        b.connect();
        assert.equal((await resumed).code, created.lobby.code);
        assert.equal((await command(a, 'drift:start')).code, 'not_ready');
        assert.equal((await command(a, 'drift:leave')).ok, true);
        const transferred = await command(b, 'drift:configure', { capacity: 4, durationMinutes: 60 });
        assert.equal(transferred.lobby.hostId, 72);
        assert.equal(adventureConnections, 0, 'aucun chargement du monde ou de la sauvegarde Aventure');
    } finally {
        sockets.forEach(socket => socket.disconnect());
        cleanup();
        await new Promise(resolve => io.close(resolve));
    }
});

test('Socket : lancement, monde existant, horloge, équipement limité et tournoi jouable avec purge finale', { timeout: 20000 }, async () => {
    let clock=1000;
    const { createLobbyStore }=require('../server/game/drift/lobbyStore');
    const factory=require('../server/game/drift/pokemonFactory');
    const store=createLobbyStore({now:()=>clock});
    const server=http.createServer(),io=new Server(server);
    const cleanup=registerDriftLobbies(io, { appearanceRepository:testAppearanceRepository,store,runtimeOptions:{starterChoiceMs:0,now:()=>clock,random:()=>.1,paceMs:0}});
    server.listen(0,'127.0.0.1');await once(server,'listening');
    const url=`http://127.0.0.1:${server.address().port}/drift`,sockets=[];
    const users=[{id:91,username:'Anna'},{id:92,username:'Bruno'}];
    try {
        for(const user of users){const socket=client(url,{auth:{token:signAccessToken(user)},autoConnect:false,transports:['websocket'],forceNew:true});sockets.push(socket);const ready=event(socket,'drift:bootstrap');socket.connect();await ready;}
        const [a,b]=sockets;
        const created=await command(a,'drift:create',{capacity:2,durationMinutes:20});
        await command(b,'drift:join',{code:created.lobby.code});
        await command(a,'drift:ready',{ready:true});await command(b,'drift:ready',{ready:true});
        assert.equal((await command(b,'drift:start')).code,'host_only');
        assert.equal((await command(a,'drift:start')).lobby.phase,'exploration');
        for(const socket of sockets){const entered=await command(socket,'drift:enter');assert.equal(entered.success,true);assert.equal(entered.state.team.length,1);assert.equal(entered.state.slotLimit,5);}
        const run=store.getLobby(users[0]).run,pa=run.players.get(91),pb=run.players.get(92);
        assert.equal((await command(a,'drift:reorder',{orderedUuids:['alien']})).success,false);
        const world=event(a,'playerMoved',payload=>payload.id===a.id);
        clock+=200;await command(a,'playerAction','move_d');assert.equal((await world).player.currentmap,'start');
        // Runtime-only fixture, never a public cheat endpoint.
        pa.drifts=Array.from({length:6},(_,i)=>({uuid:`fixture-${i}`,definitionId:`DRF-${String(i+1).padStart(3,'0')}`,rarity:'common',element:'Normal'}));
        for(let i=0;i<5;i++)assert.equal((await command(a,'drift:equip',{uuid:`fixture-${i}`,enabled:true})).success,true);
        assert.equal((await command(a,'drift:equip',{uuid:'fixture-5',enabled:true})).success,false);
        assert.equal((await command(b,'drift:equip',{uuid:'fixture-1',enabled:true})).success,false);
        const preparation=event(a,'drift:state',s=>s.phase==='preparation');clock=run.endsAt;cleanup.runtime.tick();
        assert.equal((await preparation).matches.length,1);assert.equal(pa.currentmap,'ville1_arene');
        pa.equipe.pokemons=[factory.create(1,80)];pb.equipe.pokemons=[factory.create(19,5)];
        for(const socket of sockets) socket.on('requestAction',data=>socket.emit('actionResponse',{action:'attack',number:0,turnId:data.turnId}));
        const result=event(a,'drift:state',s=>s.phase==='results');
        await command(a,'drift:roundReady');await command(b,'drift:roundReady');
        const ending=await result;assert.equal(ending.winnerId,91);assert.equal(ending.team.length,0);assert.equal(ending.drifts.length,0);assert.equal(ending.money,0);
        assert.equal((await command(a,'drift:exit')).success,true);
        const newLobby=await command(a,'drift:create',{capacity:4,durationMinutes:30});assert.equal(newLobby.ok,true);
        clock+=120001;cleanup.runtime.tick();assert.equal(store.snapshot(users[0]).code,newLobby.lobby.code,'la purge ne supprime pas le nouveau salon');
    } finally {sockets.forEach(s=>s.disconnect());cleanup();await new Promise(resolve=>io.close(resolve));}
});

test('Socket Drift : passage salon/monde, changement de carte et reconnexion conservent le sac et le chrono ; fin expliquée après absence', { timeout: 15000 }, async () => {
    let clock = 1000;
    const { createLobbyStore, RECONNECT_MS } = require('../server/game/drift/lobbyStore');
    const store = createLobbyStore({ now: () => clock });
    const server = http.createServer(), io = new Server(server);
    const cleanup = registerDriftLobbies(io, { appearanceRepository:testAppearanceRepository, store, runtimeOptions: { starterChoiceMs:0, now: () => clock, random: () => .5 } });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const url = `http://127.0.0.1:${server.address().port}/drift`;
    const users = [{ id: 111, username: 'Alice' }, { id: 112, username: 'Bob' }];
    const sockets = [];
    async function connect(user) {
        const socket = client(url, { auth: { token: signAccessToken(user) }, autoConnect: false, transports: ['websocket'], forceNew: true, reconnection: false });
        sockets.push(socket);
        const bootstrap = event(socket, 'drift:bootstrap');
        socket.connect();
        await bootstrap;
        return socket;
    }
    try {
        const lobbyA = await connect(users[0]), lobbyB = await connect(users[1]);
        const created = await command(lobbyA, 'drift:create', { capacity: 2, durationMinutes: 20 });
        await command(lobbyB, 'drift:join', { code: created.lobby.code });
        await command(lobbyA, 'drift:ready', { ready: true });
        await command(lobbyB, 'drift:ready', { ready: true });
        assert.equal((await command(lobbyA, 'drift:start')).ok, true);

        // The lobby component disconnects before UserMap creates its own namespace socket.
        lobbyA.disconnect();
        lobbyB.disconnect();
        const a = await connect(users[0]), b = await connect(users[1]);
        const enteredA = await command(a, 'drift:enter');
        const enteredB = await command(b, 'drift:enter');
        assert.equal(enteredA.success, true);
        assert.equal(enteredB.success, true);
        const original = enteredA.state, originalCompanion = original.team[0].uuid;
        const run = store.getLobby(users[0]).run;
        assert.equal(original.items.find(item => item.key === 'pokeball').quantity, 10);
        assert.equal(original.items.find(item => item.key === 'drift_potion').quantity, 3);

        // Cross an existing door from the real spawn, then walk back through its exit.
        const house = event(a, 'newmap', payload => payload.mapname === 'maison');
        assert.equal((await command(a, 'playerAction', 'move_q')).success, true);
        const inside = await house;
        assert.equal(inside.playersList[a.id].currentmap, 'maison');
        assert.equal(inside.playersList[a.id].x, 272);
        assert.equal(inside.playersList[a.id].y, 464);
        clock += 200;
        const village = event(a, 'newmap', payload => payload.mapname === 'start');
        assert.equal((await command(a, 'playerAction', 'move_s')).success, true);
        const outside = await village;
        assert.equal(outside.playersList[a.id].currentmap, 'start');
        assert.equal(outside.playersList[a.id].x, 48);
        assert.equal(outside.playersList[a.id].y, 208);
        const after = cleanup.runtime.state(run.players.get(users[0].id));
        assert.equal(after.phase, 'exploration');
        assert.equal(after.alive, true);
        assert.equal(after.endsAt, original.endsAt);
        assert.deepEqual(after.items, original.items);
        assert.equal(after.team[0].uuid, originalCompanion);

        const oldSocketId = b.id;
        const absent = event(a, 'playersList', players => !players[oldSocketId]);
        b.disconnect();
        await absent;
        clock += RECONNECT_MS - 1;
        cleanup.runtime.tick();
        assert.equal(run.phase, 'exploration', 'la grâce de reconnexion ne termine pas la partie prématurément');
        const bootstrap = event(b, 'drift:bootstrap');
        b.connect();
        await bootstrap;
        const resumed = await command(b, 'drift:enter');
        assert.equal(resumed.state.alive, true);
        assert.equal(resumed.state.team[0].uuid, enteredB.state.team[0].uuid);
        assert.deepEqual(resumed.state.items, enteredB.state.items);
        clock += 1000;
        cleanup.runtime.tick();
        assert.equal(run.phase, 'exploration');

        const reconnectedId = b.id;
        const absentAgain = event(a, 'playersList', players => !players[reconnectedId]);
        b.disconnect();
        await absentAgain;
        const ending = event(a, 'drift:state', state => state.phase === 'results');
        clock += RECONNECT_MS;
        cleanup.runtime.tick();
        const result = await ending;
        assert.equal(result.winnerId, users[0].id);
        assert.equal(result.reason, 'winner');
        assert.equal(result.players.find(player => player.id === users[1].id).reason, 'disconnected');
        assert.deepEqual(result.items, [], 'le sac disparaît à la fin de la session éphémère, jamais au passage de porte');
        assert.equal((await command(a, 'drift:exit')).success, true);
    } finally {
        sockets.forEach(socket => socket.disconnect());
        cleanup();
        await new Promise(resolve => io.close(resolve));
    }
});
