const test = require('node:test');
const assert = require('node:assert/strict');
const { createLobbyStore } = require('../server/game/drift/lobbyStore');
const { createRunManager } = require('../server/game/drift/runManager');
const { encode, decode } = require('../server/game/drift/checkpointCodec');
const colosseum = require('../server/game/drift/colosseum');
const factory = require('../server/game/drift/pokemonFactory');
const economy = require('../server/game/drift/economy');
const { getMaxMovePp } = require('../server/game/battle/battleResources');

function setup(options = {}) {
    let time = 100000;
    const user = { id: 1, username: 'Solo' }, socket = { id: 'solo' };
    const store = createLobbyStore({ now: () => time });
    const runtime = createRunManager({ store, namespace: { to: () => ({ emit() {} }) }, now: () => time, random: () => .1, paceMs: 0, ...options });
    store.connect(user, socket.id);
    return { store, runtime, user, socket, now: () => time, advance(ms) { time += ms; runtime.tick(); },
        async start() { await runtime.startColosseum(user);runtime.enter(user,socket);return runtime.playerFor(user); } };
}
function defeatEnemies(battle) {
    for (const p of battle.b.equipe.pokemons) p.currentHp = 0;
    battle.prune(); battle.checkEnd();
}

test('solo rules are immutable; starter, duration and repeat start cannot be tampered with', async () => {
    const f = setup({ durationMs: 10 }), p = await f.start();
    assert.equal(p.run.endsAt - p.run.startedAt, 3600000);
    assert.equal(p.run.players.size, 1);
    assert.equal(p.equipe.pokemons.length, 1);
    assert(factory.STARTERS.includes(p.equipe.pokemons[0].data.id));
    assert(!factory.legendary.has(p.equipe.pokemons[0].data.id));
    const uuid = p.equipe.pokemons[0].uuid, end = p.run.endsAt;
    await f.runtime.startColosseum(f.user);
    assert.equal(f.runtime.playerFor(f.user).equipe.pokemons[0].uuid,uuid);
    assert.equal(p.run.endsAt,end);
    assert.throws(() => f.store.configure(f.user,{capacity:16,durationMinutes:300}), /règles sont fixes/);
    assert.throws(() => f.store.join({id:2},f.store.snapshot(f.user).code), /déjà commencé/);
    assert.deepEqual(f.store.listOpen({id:2}),[]);
    assert.throws(() => f.runtime.ready(p), /Aucun défi/);
});
test('ordinary Rift cannot be converted or overwritten by a solo start', () => {
    const f = setup();f.store.create(f.user,{capacity:2,durationMinutes:20});
    assert.throws(() => f.runtime.startColosseum(f.user), /Quitte ton salon/);
    assert.throws(() => f.store.configure(f.user,{mode:'colosseum'}), /règles sont fixes/);
    assert.equal(f.store.snapshot(f.user).capacity,2);
});
test('one player survives exploration victories and receives capture loot', async () => {
    const f=setup(),p=await f.start();
    const enemy={npc:true,equipe:{pokemons:[factory.create(19,2)]},drifts:[],equipped:[]};
    const b=f.runtime.battle(p,enemy,'wild');defeatEnemies(b);
    assert.equal(p.alive,true);assert.equal(p.run.phase,'exploration');
    assert(p.drifts.length>0);economy.equip(p,p.drifts[0].uuid,true);
    assert.equal(p.equipped.length,1);
    assert.equal(p.run.colosseum.score,0);
});
test('exact hour interrupts battle once and moves surviving team to arena without resurrection', async () => {
    const f=setup(),p=await f.start();
    f.advance(3599999);assert.equal(p.run.phase,'exploration');
    const lost=p.equipe.pokemons[0],survivor=factory.create(7,20);
    p.equipe.pokemons.push(survivor);
    const b=f.runtime.battle(p,{npc:true,equipe:{pokemons:[factory.create(19,5)]},drifts:[],equipped:[]},'wild');
    lost.currentHp=0;b.prune();survivor.currentHp=1;survivor.status='poison';survivor.movePp=survivor.abilities.map(()=>0);
    f.advance(1);assert.equal(b.finished,true);assert.equal(p.run.phase,'colosseum_ready');
    assert.equal(p.currentmap,'ville1_arene');assert.equal(p.equipe.pokemons.length,1);
    assert.equal(p.equipe.pokemons[0].uuid,survivor.uuid);assert.equal(survivor.currentHp,survivor.maxHp);
    assert.equal(survivor.status,'normal');assert.deepEqual(survivor.movePp,survivor.abilities.map(getMaxMovePp));
    assert.equal(p.run.colosseum.wins,0);assert.equal(p.run.colosseum.score,0);
    f.runtime.beginTournament(p.run);assert.equal(p.run.phase,'colosseum_ready');
});
test('arena wins grant points once, heal only survivors and advance difficulty; flee ends attempt', async () => {
    const f=setup(),p=await f.start();
    p.equipe.pokemons.push(factory.create(9,40));f.advance(3600000);
    f.runtime.ready(p);const b=p.battle,lost=p.equipe.pokemons[0];
    assert.equal(p.run.phase,'colosseum_battle');
    assert.throws(()=>f.runtime.ready(p),/Aucun défi/);
    lost.currentHp=0;b.prune();p.equipe.pokemons[0].currentHp=1;
    defeatEnemies(b);b.finish(p,'finished');
    assert.equal(p.run.colosseum.score,300);assert.equal(p.run.colosseum.wins,1);
    assert.equal(p.equipe.pokemons.length,1);assert.equal(p.equipe.pokemons[0].currentHp,p.equipe.pokemons[0].maxHp);
    assert.equal(p.run.colosseum.next.level,13);assert.equal(p.run.colosseum.next.wave,2);
    assert(p.run.colosseum.lastTeam.some(p=>p.uuid===lost.uuid&&p.currentHp===0));
    f.runtime.ready(p);const second=p.battle;
    second.action(p,{action:'flee',turnId:second.token});
    assert.equal(p.run.phase,'results');assert.equal(p.eliminationReason,'forfeit');
    assert.equal(p.run.report.colosseum.score,300);assert.equal(p.run.report.colosseum.wins,1);
    assert.equal(p.equipe.pokemons.length,0);assert.equal(p.run.report.colosseum.lastTeam.length,1);
    assert.equal(p.run.report.accountReward,undefined);
});
test('total KO and double KO both end solo attempt without award or revival', async () => {
    for (const arena of [false,true]) {
        const f=setup(),p=await f.start();
        if(arena){f.advance(3600000);f.runtime.ready(p);}else f.runtime.battle(p,{npc:true,equipe:{pokemons:[factory.create(19,5)]},drifts:[],equipped:[]},'wild');
        const b=p.battle;p.equipe.pokemons[0].currentHp=0;
        if(arena)for(const enemy of b.b.equipe.pokemons)enemy.currentHp=0;
        b.prune();b.checkEnd();assert.equal(p.run.phase,'results');assert.equal(p.alive,false);
        assert.equal(p.run.colosseum.score,0);assert.equal(p.equipe.pokemons.length,0);
        assert.throws(()=>f.runtime.ready(p),/Aucun défi/);
    }
});
test('disconnect keeps clock; checkpoint restores arena battle, losses and score', async () => {
    const f=setup(),p=await f.start();const ends=p.run.endsAt;
    f.runtime.disconnect(f.user,f.socket);f.advance(30000);f.runtime.enter(f.user,{id:'new'});
    assert.equal(p.run.endsAt,ends);assert.equal(p.alive,true);
    f.advance(3570000);f.runtime.ready(p);defeatEnemies(p.battle);f.runtime.ready(p);
    const bytes=encode({savedAt:f.now(),lobbies:f.store.exportLobbies(),runs:f.runtime.runs});
    const saved=decode(bytes), restored=setup();
    restored.store.restoreLobbies(saved.lobbies);restored.runtime.restore(saved.runs,saved.savedAt);
    restored.store.connect(f.user,'restored');restored.runtime.enter(f.user,{id:'restored'});restored.runtime.tick();
    const q=restored.runtime.playerFor(f.user);
    assert.equal(q.run.colosseum.score,300);assert.equal(q.battle.a,q);assert.equal(q.run.phase,'colosseum_battle');
    defeatEnemies(q.battle);assert.equal(q.run.colosseum.wins,2);assert.equal(q.run.colosseum.score,760);
});
test('90-second absence settles the solo attempt; account stats stay untouched', async () => {
    const calls=[],account={recordRunStarted(){throw Error('Wrong ledger');},recordRunFinished(){throw Error('Wrong ledger');}};
    const repository={async recordRunStarted(run){calls.push(['start',run]);},async recordRunFinished(run){calls.push(['finish',run]);return{};}};
    const f=setup({accountRepository:account,colosseumRepository:repository}),p=await f.start();
    f.runtime.disconnect(f.user,f.socket);f.advance(90000);await p.run.settling;
    assert.equal(p.run.phase,'results');assert.equal(p.eliminationReason,'disconnected');
    assert.equal(p.run.settlement.status,'complete');assert.deepEqual(calls.map(c=>c[0]),['start','finish']);
});
test('wave progression remains stronger past level 100 and has legal nonlegendary teams', () => {
    let previous=0;
    for(const wave of [1,2,5,7,13,19,25,31,32,40]) {
        const info=colosseum.waveInfo(wave),enemy=colosseum.opponent(wave);
        assert(info.points>previous);previous=info.points;
        assert(enemy.equipe.pokemons.length>=2&&enemy.equipe.pokemons.length<=6);
        for(const pokemon of enemy.equipe.pokemons){assert(!factory.legendary.has(pokemon.data.id));assert(pokemon.currentHp>0);assert(pokemon.abilities.length>0);}
    }
    assert(colosseum.opponent(40).equipe.pokemons[0].maxHp>colosseum.opponent(34).equipe.pokemons[0].maxHp);
});

test('Socket Colosseum ignores forged mode settings, points, user identity and early wave requests', {timeout:15000}, async()=>{
    const http=require('node:http'),{once}=require('node:events'),{Server}=require('socket.io');
    const {io:client}=require('../vue-explorakit/node_modules/socket.io-client');
    const {signAccessToken}=require('../server/config/auth');
    const {registerDriftLobbies}=require('../server/realtime/driftLobbyHandler');
    const server=http.createServer(),io=new Server(server),cleanup=registerDriftLobbies(io);
    server.listen(0,'127.0.0.1');await once(server,'listening');
    const sockets=[];
    const command=(s,n,p={})=>new Promise((resolve,reject)=>s.timeout(3000).emit(n,p,(e,r)=>e?reject(e):resolve(r)));
    try{
        for(const id of [91,92]){
            const s=client(`http://127.0.0.1:${server.address().port}/drift`,{autoConnect:false,auth:{token:signAccessToken({id,username:'Solo'+id})},transports:['websocket']});
            sockets.push(s);const ready=once(s,'drift:bootstrap');s.connect();await ready;
        }
        const [a,b]=sockets;
        const started=await command(a,'colosseum:start',{userId:92,durationMinutes:0,capacity:16,score:99999});
        assert.equal(started.lobby.hostId,91);assert.equal(started.lobby.durationMinutes,60);assert.equal(started.lobby.capacity,1);
        const entered=await command(a,'drift:enter');assert.equal(entered.state.colosseum.score,0);
        assert.equal((await command(a,'drift:roundReady',{score:99999})).success,false);
        assert.equal((await command(b,'drift:enter',{userId:91})).success,false);
        assert.equal((await command(b,'drift:join',{code:started.lobby.code})).ok,false);
        assert.deepEqual((await command(b,'drift:list')).lobbies,[]);
        const again=await command(a,'colosseum:start');assert.equal(again.lobby.code,started.lobby.code);
        assert.equal((await command(a,'drift:refresh')).success,true);
        await command(a,'drift:abandon');assert.equal(cleanup.runtime.playerFor({id:91}).run.phase,'results');
    }finally{sockets.forEach(s=>s.disconnect());cleanup();await new Promise(resolve=>io.close(resolve));}
});
