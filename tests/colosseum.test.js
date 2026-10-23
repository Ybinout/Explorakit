const testAppearanceRepository = { async loadUserSprite(){return 'sprite.png';}, async saveUserSprite(){} };
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
    const runtime = createRunManager({ starterChoiceMs:0, store, namespace: { to: () => ({ emit() {} }) }, now: () => time, random: () => .1, paceMs: 0, ...options });
    store.connect(user, socket.id);
    return { store, runtime, user, socket, now: () => time, advance(ms) { time += ms; runtime.tick(); },
        async start() { await runtime.startColosseum(user);runtime.enter(user,socket);return runtime.playerFor(user); } };
}
function defeatEnemies(battle) {
    for (const p of battle.b.equipe.pokemons) p.currentHp = 0;
    battle.prune(); battle.checkEnd();
}

for (const durationMinutes of [30, 60]) test(`Colosseum ${durationMinutes}min: result keeps all six companions at their peak across evolution, losses and recovery`, async () => {
    const f = setup();
    await f.runtime.startColosseum(f.user, { durationMinutes });
    f.runtime.enter(f.user, f.socket);
    const p = f.runtime.playerFor(f.user);
    p.equipe.pokemons = [1, 4, 7, 25, 133, 16].map(id => factory.create(id, 20));
    f.advance(durationMinutes * 60000);
    const entry = structuredClone(p.runReport.tournamentTeam);
    f.runtime.ready(p);
    p.equipe.pokemons[0].level=36;p.equipe.pokemons[0].updatePokemon(3);
    p.equipe.pokemons[0].abilities=['Solar Beam','Sleep Powder'];
    for (const pokemon of p.equipe.pokemons.slice(0, 5)) pokemon.currentHp = 0;
    defeatEnemies(p.battle);
    assert.equal(p.equipe.pokemons.length, 1);
    const saved = decode(encode({ savedAt:f.now(), lobbies:f.store.exportLobbies(), runs:f.runtime.runs }));
    const restored = setup();
    restored.store.restoreLobbies(saved.lobbies); restored.runtime.restore(saved.runs, saved.savedAt);
    restored.store.connect(f.user, 'restored'); restored.runtime.enter(f.user, { id:'restored' });
    const q = restored.runtime.playerFor(f.user);
    restored.runtime.ready(q);
    q.equipe.pokemons[0].level=40;q.equipe.pokemons[0].updatePokemon(18);
    const enemyTeam=structuredClone(q.runReport.lastBattle.team);
    q.battle.round=7;
    q.battle.b.equipe.pokemons[0].heldItem=null; // A consumed item remains visible in the initial loadout.
    q.equipe.pokemons[0].currentHp = 0;
    q.battle.prune(); q.battle.checkEnd();
    assert.equal(q.run.phase, 'results');
    assert.equal(q.run.report.colosseum.lastTeam.length, 1);
    const peak=colosseum.recordTeam(q.run.report);
    assert.deepEqual(peak.map(p=>p.uuid),entry.map(p=>p.uuid));
    assert.equal(peak[0].pokemonId,3);assert.equal(peak[0].level,36);
    assert.deepEqual(peak[0].moves,['Solar Beam','Sleep Powder']);
    assert.equal(peak[5].pokemonId,18);assert.equal(peak[5].level,40);
    assert(peak.every(p=>p.currentHp===0&&p.lostAt!==null));
    assert.deepEqual(restored.runtime.state(q).colosseum.resultTeam,peak);
    const defeat=colosseum.recordDefeat(q.run.report);
    assert.equal(defeat.wave,2);assert.equal(defeat.turns,7);assert.equal(defeat.outcome,'defeat');
    assert.deepEqual(defeat.team.map(p=>p.pokemonId),enemyTeam.map(p=>p.pokemonId));
    assert.deepEqual(defeat.team.map(p=>p.heldItem),enemyTeam.map(p=>p.heldItem));
    assert(defeat.team.every(p=>!('uuid' in p)&&!('ivs' in p)));
    assert.deepEqual(restored.runtime.state(q).report.players[0].tournamentTeam, entry);
    assert(entry.every(pokemon => pokemon.currentHp > 0 && pokemon.level === 20));
});

for (const durationMinutes of [30, 60]) test(`Colosseum ${durationMinutes}min: boosted XP and reserve learning persist without duplicate rewards`, async () => {
    const f = setup();
    await f.runtime.startColosseum(f.user, { durationMinutes });
    f.runtime.enter(f.user, f.socket);
    const p = f.runtime.playerFor(f.user);
    const active = factory.create(1, 5), reserve = factory.create(25, 5), lost = factory.create(4, 5);
    p.equipe.pokemons = [active, reserve, lost];
    const before = [active.experience, reserve.experience, lost.experience];
    const enemy = factory.create(19, 14);
    enemy.k = 1;
    const sharingBase = Math.floor(6 * require('../server/game/models/progression').calculateBattleExperience(enemy, 1.1, active) * 4 / 5);
    const battle = f.runtime.battle(p, { npc:true, equipe:{ pokemons:[enemy] }, drifts:[], equipped:[] }, 'wild');
    lost.currentHp = 0;
    defeatEnemies(battle);
    assert.equal(active.experience - before[0], Math.floor(Math.floor(sharingBase * 9 / 10)*4/5));
    assert.equal(reserve.experience - before[1], Math.floor(sharingBase * 40 / 100));
    assert.equal(lost.experience, before[2]);
    assert(!p.equipe.pokemons.includes(lost));
    assert(reserve.level > 5);
    assert(reserve.pendingMoves.length > 0, 'Reserve levels must offer new moves too');
    // Exercise the durable battle guard and Pokémon prototypes, not just JSON values.
    const saved = decode(encode({ savedAt:f.now(), lobbies:f.store.exportLobbies(), runs:f.runtime.runs, battle }));
    const restored = setup();
    restored.store.restoreLobbies(saved.lobbies); restored.runtime.restore(saved.runs, saved.savedAt);
    const q = restored.runtime.playerFor(f.user);
    saved.battle.reward(saved.battle.originals.find(poke => poke.uuid === enemy.uuid));
    assert.deepEqual(q.equipe.pokemons.map(poke => poke.experience), [active.experience, reserve.experience]);
    assert.deepEqual(q.equipe.pokemons[1].pendingMoves, reserve.pendingMoves);
    assert.equal(q.equipe.pokemons[1].gainExperience, reserve.gainExperience);
    assert.equal(q.run.lobby.rules.durationMinutes, durationMinutes);
});

test('six guardians have deterministic, honest previews and shipped sprites; scoring stays stable', () => {
    const fs = require('node:fs'), names = new Set();
    for (let wave = 1; wave <= 120; wave++) {
        const info = colosseum.waveInfo(wave), team = colosseum.opponent(wave).equipe.pokemons;
        assert.deepEqual(info.preview.map(p => p.id), team.map(p => p.data.id));
        assert.equal(info.points, colosseum.waveInfo(wave, 1).points);
        assert.equal(Boolean(info.guardian), wave % 5 === 0);
        assert.equal(info.nextGuardian.wave, Math.ceil(wave / 5) * 5);
        if (info.guardian) {
            names.add(info.guardian.name);
            for (const p of team) {
                assert(!factory.legendary.has(p.data.id));
                for (const folder of ['dp2', 'back']) assert(fs.existsSync(require('node:path').join(__dirname, `../vue-explorakit/src/assets/${folder}/${p.data.id}.png`)), `Missing ${folder}/${p.data.id}`);
            }
        }
    }
    assert.equal(names.size, 6);
});

test('guardian reward is one authoritative choice, cannot be forged, replayed or auto-equipped', async () => {
    const f = setup(), p = await f.start();
    assert.throws(() => colosseum.chooseReward(p, {}), /plus disponible/);
    p.run.colosseum.wins = 4; f.advance(3600000); f.runtime.ready(p);
    assert.equal(p.battle.b.username, 'Le Rempart · 5');
    const battle = p.battle; defeatEnemies(battle);
    const offer = p.run.colosseum.reward, before = p.drifts.length;
    assert.equal(offer.wave, 5); assert.equal(offer.options.length, 3);
    assert(offer.options.every(o => o.rarity === 'epic'));
    assert.throws(() => f.runtime.ready(p), /récompense de palier/);
    assert.throws(() => colosseum.chooseReward(p, { offerId: 'forged', definitionId: offer.options[0].definitionId }), /plus disponible/);
    assert.throws(() => colosseum.chooseReward(p, { offerId: offer.id, definitionId: 'DRF-059' }), /trois Drifts/);
    const choice = { offerId: offer.id, definitionId: offer.options[0].definitionId, rarity: 'mythic', score: 999999 };
    const score = p.run.colosseum.score;
    colosseum.chooseReward(p, choice);
    assert.equal(p.drifts.length, before + 1); assert.equal(p.drifts.at(-1).rarity, 'epic');
    assert.equal(p.equipped.length, 0); assert.equal(p.run.colosseum.score, score);
    assert.throws(() => colosseum.chooseReward(p, choice), /plus disponible/);
    battle.finish(p, 'finished'); assert.equal(p.run.colosseum.reward, null);
    f.runtime.ready(p); assert.equal(p.run.colosseum.wave, 6);
});

test('pending guardian reward and claimed choice survive checkpoints without a second grant', async () => {
    const f = setup(), p = await f.start();
    p.run.colosseum.wins = 14; f.advance(3600000); f.runtime.ready(p); defeatEnemies(p.battle);
    const offer = p.run.colosseum.reward;
    assert(offer.options.every(o => o.rarity === 'legendary'));
    const saved = decode(encode({ savedAt: f.now(), lobbies: f.store.exportLobbies(), runs: f.runtime.runs }));
    const restored = setup(); restored.store.restoreLobbies(saved.lobbies); restored.runtime.restore(saved.runs, saved.savedAt);
    const q = restored.runtime.playerFor(f.user);
    assert.deepEqual(q.run.colosseum.reward, offer);
    const choice = { offerId: offer.id, definitionId: offer.options[1].definitionId };
    colosseum.chooseReward(q, choice);
    const again = decode(encode({ lobbies: restored.store.exportLobbies(), runs: restored.runtime.runs }));
    const same = [...again.runs.values()][0].players.get(f.user.id);
    assert.equal(same.run.colosseum.reward, null);
    assert.equal(same.drifts.filter(d => d.uuid === q.drifts.at(-1).uuid).length, 1);
    assert.throws(() => colosseum.chooseReward(same, choice), /plus disponible/);
});

test('legacy expeditions keep original opponents and no new rewards; a lost guardian grants nothing', async () => {
    const legacy = setup(), p = await legacy.start(); delete p.run.colosseum.version;
    p.run.colosseum.wins = 9; legacy.advance(3600000); legacy.runtime.ready(p);
    assert.deepEqual(p.battle.b.equipe.pokemons.map(p => p.data.id), colosseum.opponent(10, 1).equipe.pokemons.map(p => p.data.id));
    defeatEnemies(p.battle); assert.equal(p.run.colosseum.reward, null);
    const f = setup(), q = await f.start(); q.run.colosseum.wins = 9;
    f.advance(3600000); f.runtime.ready(q); const battle = q.battle;
    q.equipe.pokemons[0].currentHp = 0; battle.prune(); battle.checkEnd();
    assert.equal(q.run.phase, 'results'); assert.equal(q.run.colosseum.reward, null);
});

test('version 2 checkpoints retain ten-combat guardians, novice AI and old sets after restart',async()=>{
    const f=setup(),p=await f.start();p.run.colosseum.version=2;p.run.colosseum.wins=4;
    const saved=decode(encode({savedAt:f.now(),lobbies:f.store.exportLobbies(),runs:f.runtime.runs}));
    const restored=setup();restored.store.restoreLobbies(saved.lobbies);restored.runtime.restore(saved.runs,saved.savedAt);
    const q=restored.runtime.playerFor(f.user);restored.store.connect(f.user,f.socket.id);restored.runtime.enter(f.user,f.socket);restored.runtime.tick();restored.advance(3600000);restored.runtime.ready(q);
    assert.equal(q.battle.b.colosseumVersion,2);assert.equal(q.battle.b.colosseumWave,5);
    assert(q.battle.b.equipe.pokemons.every(p=>!p.heldItem));
    defeatEnemies(q.battle);assert.equal(q.run.colosseum.reward,null);
    assert.equal(q.run.colosseum.next.nextGuardian.wave,10);assert.equal(q.run.colosseum.next.difficulty.label,'Novice');
    q.run.colosseum.wins=9;q.run.colosseum.next=colosseum.waveInfo(10,2);restored.runtime.ready(q);defeatEnemies(q.battle);
    assert.equal(q.run.colosseum.reward.wave,10);assert(q.run.colosseum.reward.options.every(o=>o.rarity==='epic'));
});

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
    lost.currentHp=0;b.prune();b.request();assert(b.action(p,{action:'change',number:1,turnId:b.token}));p.equipe.pokemons[0].currentHp=1;
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
    const server=http.createServer(),io=new Server(server),cleanup=registerDriftLobbies(io, { appearanceRepository:testAppearanceRepository,runtimeOptions:{starterChoiceMs:0}});
    server.listen(0,'127.0.0.1');await once(server,'listening');
    const sockets=[];
    const command=(s,n,p={})=>new Promise((resolve,reject)=>s.timeout(3000).emit(n,p,(e,r)=>e?reject(e):resolve(r)));
    try{
        for(const id of [91,92]){
            const s=client(`http://127.0.0.1:${server.address().port}/drift`,{autoConnect:false,auth:{token:signAccessToken({id,username:'Solo'+id})},transports:['websocket']});
            sockets.push(s);const ready=once(s,'drift:bootstrap');s.connect();await ready;
        }
        const [a,b]=sockets;
        assert.equal((await command(a,'colosseum:start',{durationMinutes:0})).ok,false);
        const started=await command(a,'colosseum:start',{userId:92,durationMinutes:30,capacity:16,score:99999});
        assert.equal(started.lobby.hostId,91);assert.equal(started.lobby.durationMinutes,30);assert.equal(started.lobby.capacity,1);
        const entered=await command(a,'drift:enter');assert.equal(entered.state.colosseum.score,0);
        assert.equal((await command(a,'drift:roundReady',{score:99999})).success,false);
        assert.equal((await command(b,'drift:enter',{userId:91})).success,false);
        assert.equal((await command(b,'colosseum:reward',{userId:91,offerId:'fake',definitionId:'DRF-059'})).success,false);
        assert.equal((await command(a,'colosseum:reward',{offerId:'fake',definitionId:'DRF-059'})).success,false);
        assert.equal((await command(b,'drift:join',{code:started.lobby.code})).ok,false);
        assert.deepEqual((await command(b,'drift:list')).lobbies,[]);
        const again=await command(a,'colosseum:start');assert.equal(again.lobby.code,started.lobby.code);
        assert.equal((await command(a,'drift:refresh')).success,true);
        await command(a,'drift:abandon');assert.equal(cleanup.runtime.playerFor({id:91}).run.phase,'results');
    }finally{sockets.forEach(s=>s.disconnect());cleanup();await new Promise(resolve=>io.close(resolve));}
});

test('30-minute format is exact, immutable on resume and durable in checkpoints', async () => {
    const f=setup({durationMs:1});
    await f.runtime.startColosseum(f.user,{durationMinutes:30});f.runtime.enter(f.user,f.socket);
    const p=f.runtime.playerFor(f.user),end=p.run.endsAt;
    assert.equal(end-p.run.startedAt,1800000);
    assert.equal(f.runtime.enter(f.user,f.socket).durationMinutes,30);
    await f.runtime.startColosseum(f.user,{durationMinutes:60});assert.equal(p.run.endsAt,end);
    const saved=decode(encode({savedAt:f.now(),lobbies:f.store.exportLobbies(),runs:f.runtime.runs}));
    assert.equal([...saved.runs.values()][0].lobby.rules.durationMinutes,30);
    f.advance(1799999);assert.equal(p.run.phase,'exploration');f.advance(1);assert.equal(p.run.phase,'colosseum_ready');
});
test('only 30 and 60 are valid Colosseum durations; legacy start defaults to 60', () => {
    for(const value of [0,20,90,1800000,'30',null,{},NaN]){
        const f=setup();assert.throws(()=>f.runtime.startColosseum(f.user,{durationMinutes:value}),/30 minutes ou 1 heure/);
        assert.equal(f.store.getLobby(f.user),undefined);
    }
});

 test('legacy Panthéon records fall back safely and an abandonment is not a defeat',()=>{
 const entry=[{uuid:'a',level:30,pokemonId:3},{uuid:'b',level:20,pokemonId:7}];
 const legacy={players:[{tournamentTeam:entry}]};assert.deepEqual(colosseum.recordTeam(legacy),entry);assert.equal(colosseum.recordDefeat(legacy),null);
 legacy.players[0].pokemon=[{uuid:'a',level:29,pokemonId:1}];assert.deepEqual(colosseum.recordTeam(legacy),entry);
 legacy.players[0].reason='forfeit';legacy.players[0].lastBattle={outcome:'defeat',team:[]};assert.equal(colosseum.recordDefeat(legacy),null);
 });
