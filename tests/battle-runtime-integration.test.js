const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const mysql = require('mysql2/promise');

const shouldRun = process.env.RUN_MYSQL_TESTS === '1';
const testDatabaseName = process.env.DB_TEST_NAME || `${process.env.DB_NAME || 'pokemon_game'}_test`;

process.env.NODE_ENV = 'test';
process.env.BATTLE_DELAY_SCALE = '0';

const Pokemon = require('../server/game/models/Pokemon');
const Team = require('../server/game/models/Team');
const startWildBattle = require('../server/game/battle/wildBattle');
const startTrainerBattle = require('../server/game/battle/trainerBattle');
const { startPvpBattle } = require('../server/game/battle/pvpBattle');
const { createUserWithStarter } = require('../server/persistence/userRepository');
const { loadEquipe } = require('../server/persistence/teamRepository');
const { loadUserItems } = require('../server/persistence/itemRepository');

class ScriptedSocket extends EventEmitter {
    constructor(actions = []) {
        super();
        this.actions = [...actions];
        this.outgoing = [];
    }

    emit(eventName, payload) {
        this.outgoing.push({ eventName, payload });
        if (eventName === 'requestAction') {
            if (payload.replacementId) this.lastReplacementId=payload.replacementId;
            else if (this.lastReplacementId) setImmediate(()=>super.emit('actionResponse',{action:'attack',number:0,replacementId:this.lastReplacementId}));
            const action = this.actions.shift() || { action: 'flee' };
            setImmediate(() => super.emit('actionResponse', { ...action, ...(payload.replacementId ? {replacementId:payload.replacementId} : {}) }));
            return true;
        }
        return super.emit(eventName, payload);
    }
}

class RecordingIo {
    constructor(socketsById = {}) {
        this.events = [];
        this.sockets = { sockets: new Map(Object.entries(socketsById)) };
    }

    to(targetId) {
        return {
            emit: (eventName, payload) => {
                this.events.push({ targetId, eventName, payload });
            }
        };
    }

    lastEvent(targetId, eventName) {
        return [...this.events]
            .reverse()
            .find((event) => event.targetId === targetId && event.eventName === eventName);
    }
}

function createTestPool() {
    if (!/test/i.test(testDatabaseName)) {
        throw new Error('DB_TEST_NAME doit contenir « test » pour protéger la base de jeu.');
    }
    return mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: testDatabaseName,
        connectionLimit: 2
    });
}

function createPokemon(id, name, moves = ['Tackle']) {
    const pokemon = new Pokemon(id, name, 5, 64, {
        attack: 20,
        defense: 20,
        hp: 20,
        specialAttack: 20,
        specialDefense: 20,
        speed: 20
    }, 'Bashful', 2);
    for (const move of moves) pokemon.addAbility(move);
    return pokemon;
}

function createTeam(...pokemons) {
    const team = new Team();
    for (const pokemon of pokemons) team.ajouterPokemon(pokemon);
    return team;
}

function withFixedRandom(value, work) {
    const previousRandom = Math.random;
    Math.random = () => value;
    return Promise.resolve()
        .then(work)
        .finally(() => {
            Math.random = previousRandom;
        });
}

async function createPlayer(starterId = 1) {
    const username = `battle_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const user = await createUserWithStarter(username, 'mot-de-passe-test', { starterId });
    return {
        user,
        player: {
            id: `socket-${user.id}`,
            userId: user.id,
            username,
            equipe: await loadEquipe(user.id)
        }
    };
}

test.after(async () => {
    if (!shouldRun) return;
    const { dbPool } = require('../server/config/database');
    await dbPool.end();
});

test('combat sauvage réel : capture, objet consommé et équipe persistée', { skip: !shouldRun }, async () => {
    const pool = createTestPool();
    let userId = null;
    try {
        const fixture = await createPlayer(1);
        userId = fixture.user.id;
        const { player } = fixture;
        player.currentmap = 'start';
        const beforeEv = { ...player.equipe.pokemons[0].ev };
        const wildPokemon = createPokemon(19, 'Rattata');
        wildPokemon.maxHp = 100;
        wildPokemon.currentHp = 1;

        const socket = new ScriptedSocket([{ action: 'bag', itemKey: 'hyperball' }]);
        const io = new RecordingIo({ [player.id]: socket });
        const result = await withFixedRandom(0, () => startWildBattle(player, wildPokemon, io, userId));

        assert.equal(io.events.find(e => e.eventName === 'battleFieldState').payload.weather.kind, 'rain');
        assert.equal(result, true);
        assert.equal(io.lastEvent(player.id, 'captureAnimation')?.payload.success, true);
        assert.equal(io.lastEvent(player.id, 'endbattle')?.payload.reason, 'captured');
        const summary = io.lastEvent(player.id, 'endbattle').payload.summary;
        assert.equal(summary.outcome, 'captured');
        assert.equal(summary.mode, 'adventure');
        assert.equal(summary.capturedPokemon.uuid, wildPokemon.uuid);
        assert.equal(summary.capturedPokemon.pokemonId, 19);
        assert.equal(summary.money, Math.floor((20 + wildPokemon.level * 2) * 1.5));
        const [[wallet]] = await pool.execute('SELECT money FROM users WHERE id=?',[userId]);
        assert.equal(wallet.money, summary.money);
        assert.deepEqual(summary.experience, []);
        const saved=await loadEquipe(userId);
        assert.equal(saved.pokemons.length, 2);
        assert.equal(saved.pokemons[0].ev.speed,beforeEv.speed+1);
        assert.equal(saved.pokemons[1].ev.speed,0);
        assert.deepEqual(io.events.find(e=>e.eventName==='introAnimation').payload.effortYield,{speed:1});
        const hyperBall = (await loadUserItems(userId)).find((item) => item.key === 'hyperball');
        assert.equal(hyperBall.quantity, 1);
    } finally {
        if (userId) await pool.execute('DELETE FROM users WHERE id = ?', [userId]);
        await pool.end();
    }
});

test('combat sauvage réel : attaque, victoire, expérience et PP persistés', { skip: !shouldRun }, async () => {
    const pool = createTestPool();
    let userId = null;
    try {
        const fixture = await createPlayer(1);
        userId = fixture.user.id;
        const { player } = fixture;
        const activePokemon = player.equipe.pokemons[0];
        activePokemon.currentAttack = 999;
        activePokemon.currentSpeed = 999;
        const initialExperience = activePokemon.experience;
        const initialPp = activePokemon.movePp[0];
        const wildPokemon = createPokemon(19, 'Rattata');
        wildPokemon.currentHp = 1;
        const socket = new ScriptedSocket([{ action: 'attack', number: 0 }]);
        const io = new RecordingIo({ [player.id]: socket });

        const result = await withFixedRandom(0.5, () => startWildBattle(player, wildPokemon, io, userId));
        const persistedPokemon = (await loadEquipe(userId)).pokemons[0];

        assert.equal(result, true);
        assert.equal(io.lastEvent(player.id, 'endbattle')?.payload.reason, 'victory');
        assert.ok(io.events.some((event) => event.eventName === 'battleMoveAnimation'));
        assert.ok(persistedPokemon.experience > initialExperience);
        assert.equal(persistedPokemon.movePp[0], initialPp - 1);
        const summary = io.lastEvent(player.id, 'endbattle').payload.summary;
        assert.equal(summary.outcome, 'victory');
        assert.equal(summary.experience[0].xpGained, persistedPokemon.experience - initialExperience);
        assert.equal(summary.money, Math.floor((20 + wildPokemon.level * 2) * 1.5));
        const [[wallet]] = await pool.execute('SELECT money FROM users WHERE id=?',[userId]);
        assert.equal(wallet.money, summary.money);
    } finally {
        if (userId) await pool.execute('DELETE FROM users WHERE id = ?', [userId]);
        await pool.end();
    }
});

test('combat sauvage réel : K.O., changement forcé puis fuite', { skip: !shouldRun }, async () => {
    const pool = createTestPool();
    let userId = null;
    try {
        const fixture = await createPlayer(4);
        userId = fixture.user.id;
        const { player } = fixture;
        const firstPokemon = player.equipe.pokemons[0];
        firstPokemon.currentHp = 1;
        firstPokemon.currentDefense = 1;
        firstPokemon.currentSpeed = 1;
        const replacement = createPokemon(7, 'Remplaçant', ['Water Gun']);
        replacement.currentHp = replacement.maxHp;
        player.equipe.ajouterPokemon(createPokemon(25, 'Autre choix'));
        player.equipe.ajouterPokemon(replacement);

        const wildPokemon = createPokemon(19, 'Rattata');
        wildPokemon.currentAttack = 999;
        wildPokemon.currentSpeed = 999;
        const socket = new ScriptedSocket([
            { action: 'attack', number: 0 },
            { action: 'change', number: 2 },
            { action: 'flee' }
        ]);
        const io = new RecordingIo({ [player.id]: socket });
        const result = await withFixedRandom(0.5, () => startWildBattle(player, wildPokemon, io, userId));

        assert.equal(socket.outgoing.filter(e=>e.eventName==='requestAction'&&e.payload.replacement).length,1);
        assert.equal(result, true);
        assert.equal(firstPokemon.currentHp, 0);
        assert.equal(player.equipe.pokemons[0].uuid, replacement.uuid);
        assert.equal(io.lastEvent(player.id, 'endbattle')?.payload.reason, 'fled');
        assert.equal((await loadEquipe(userId)).pokemons[0].uuid, replacement.uuid);
        const summary = io.lastEvent(player.id, 'endbattle').payload.summary;
        assert.equal(summary.outcome, 'fled');
        assert.deepEqual(summary.lostPokemon, [], 'Le K.O. Aventure reste temporaire');
        assert.deepEqual(summary.experience, []);
    } finally {
        if (userId) await pool.execute('DELETE FROM users WHERE id = ?', [userId]);
        await pool.end();
    }
});

test('combat sauvage réel : défaite terminale persistée', { skip: !shouldRun }, async () => {
    const pool = createTestPool();
    let userId = null;
    try {
        const fixture = await createPlayer(7);
        userId = fixture.user.id;
        const { player } = fixture;
        const activePokemon = player.equipe.pokemons[0];
        activePokemon.currentHp = 1;
        activePokemon.currentDefense = 1;
        activePokemon.currentSpeed = 1;
        const wildPokemon = createPokemon(19, 'Rattata');
        wildPokemon.currentAttack = 999;
        wildPokemon.currentSpeed = 999;
        const socket = new ScriptedSocket([{ action: 'attack', number: 0 }]);
        const io = new RecordingIo({ [player.id]: socket });

        const result = await withFixedRandom(0.5, () => startWildBattle(player, wildPokemon, io, userId));

        assert.equal(result, false);
        assert.equal(io.lastEvent(player.id, 'endbattle')?.payload.reason, 'defeat');
        assert.equal((await loadEquipe(userId)).pokemons[0].currentHp, 0);
        const summary = io.lastEvent(player.id, 'endbattle').payload.summary;
        assert.equal(summary.outcome, 'defeat');
        assert.deepEqual(summary.lostPokemon, []);
        assert.deepEqual(summary.loot, []);
        assert.equal(summary.money, 0);
    } finally {
        if (userId) await pool.execute('DELETE FROM users WHERE id = ?', [userId]);
        await pool.end();
    }
});

test('combat dresseur réel : victoire, récompense et sauvegarde', { skip: !shouldRun }, async () => {
    const pool = createTestPool();
    let userId = null;
    try {
        const fixture = await createPlayer(1);
        userId = fixture.user.id;
        const { player } = fixture;
        player.currentmap = 'start';
        player.equipe.pokemons[0].currentAttack = 999;
        player.equipe.pokemons[0].currentSpeed = 999;
        const enemy = createPokemon(19, 'Adversaire');
        enemy.currentHp = 1;
        const enemyTeam = createTeam(enemy);
        const socket = new ScriptedSocket([{ action: 'attack', number: 0 }]);
        const io = new RecordingIo({ [player.id]: socket });

        const result = await withFixedRandom(0.5, () => startTrainerBattle(player, enemyTeam, io, userId));
        assert.equal(io.events.find(e => e.eventName === 'battleFieldState').payload.weather.kind, 'rain');
        const [[userRow]] = await pool.execute('SELECT money FROM users WHERE id = ?', [userId]);

        assert.equal(result, true);
        assert.equal(io.lastEvent(player.id, 'endbattle')?.payload.reason, 'victory');
        assert.ok(Number(userRow.money) > 0);
        assert.equal((await loadEquipe(userId)).pokemons.length, 1);
    } finally {
        if (userId) await pool.execute('DELETE FROM users WHERE id = ?', [userId]);
        await pool.end();
    }
});

test('combat dresseur réel : changement manuel puis fuite', { skip: !shouldRun }, async () => {
    const pool = createTestPool();
    let userId = null;
    try {
        const fixture = await createPlayer(4);
        userId = fixture.user.id;
        const { player } = fixture;
        const replacement = createPokemon(7, 'Relève', ['Water Gun']);
        replacement.currentHp = replacement.maxHp;
        player.equipe.ajouterPokemon(replacement);
        const enemy = createPokemon(19, 'Adversaire');
        enemy.currentAttack = 1;
        const socket = new ScriptedSocket([
            { action: 'change', number: 1 },
            { action: 'flee' }
        ]);
        const io = new RecordingIo({ [player.id]: socket });

        const result = await withFixedRandom(0.5, () => startTrainerBattle(player, createTeam(enemy), io, userId));

        assert.equal(result, true);
        assert.equal(player.equipe.pokemons[0].uuid, replacement.uuid);
        assert.equal(io.lastEvent(player.id, 'endbattle')?.payload.reason, 'fled');
    } finally {
        if (userId) await pool.execute('DELETE FROM users WHERE id = ?', [userId]);
        await pool.end();
    }
});

test('combat PVP réel : attaques synchronisées et victoire du bon joueur', { skip: !shouldRun }, async () => {
    const pokemonA = createPokemon(1, 'A');
    pokemonA.currentAttack = 999;
    pokemonA.currentSpeed = 999;
    const pokemonB = createPokemon(19, 'B');
    pokemonB.currentHp = 1;
    const playerA = { id: 'pvp-a', currentmap: 'start', username: 'Alice', equipe: createTeam(pokemonA) };
    const playerB = { id: 'pvp-b', currentmap: 'start', username: 'Bob', equipe: createTeam(pokemonB) };
    const io = new RecordingIo({
        [playerA.id]: new ScriptedSocket([{ action: 'attack', number: 0 }]),
        [playerB.id]: new ScriptedSocket([{ action: 'attack', number: 0 }])
    });

    const result = await withFixedRandom(0.5, () => startPvpBattle(playerA, playerB, io));

    assert.equal(io.events.find(e => e.targetId === playerA.id && e.eventName === 'battleFieldState').payload.weather.kind, 'rain');
    assert.equal(io.events.find(e => e.targetId === playerB.id && e.eventName === 'battleFieldState').payload.weather.kind, 'rain');
    assert.deepEqual(result, { winnerId: playerA.id, reason: 'finished' });
    assert.equal(io.lastEvent(playerA.id, 'endbattle')?.payload.playerWon, true);
    assert.equal(io.lastEvent(playerB.id, 'endbattle')?.payload.playerWon, false);
    assert.ok(io.events.some((event) => event.eventName === 'battleMoveAnimation'));
});

test('combat PVP réel : abandon simultané produit un match nul explicite', { skip: !shouldRun }, async () => {
    const playerA = { id: 'pvp-flee-a', username: 'Alice', equipe: createTeam(createPokemon(1, 'A')) };
    const playerB = { id: 'pvp-flee-b', username: 'Bob', equipe: createTeam(createPokemon(4, 'B')) };
    const io = new RecordingIo({
        [playerA.id]: new ScriptedSocket([{ action: 'flee' }]),
        [playerB.id]: new ScriptedSocket([{ action: 'flee' }])
    });

    const result = await startPvpBattle(playerA, playerB, io);

    assert.deepEqual(result, { winnerId: null, reason: 'both_fled' });
    assert.equal(io.lastEvent(playerA.id, 'endbattle')?.payload.draw, true);
    assert.equal(io.lastEvent(playerB.id, 'endbattle')?.payload.draw, true);
});



test('dresseur : le dernier Pokémon rapporte son XP, une seule fois et jusque dans la sauvegarde', { skip: !shouldRun }, async () => {
    const pool = createTestPool();
    let userId;
    try {
        const { user, player } = await createPlayer(1);
        userId = user.id;
        const active = player.equipe.pokemons[0];
        active.currentAttack = 999;
        active.currentSpeed = 999;
        const before = active.experience;
        const enemy = createPokemon(19, 'Rattata');
        enemy.currentHp = 1;
        enemy.passiveAbility = 'Run Away';
        const { calculateBattleExperience, BATTLE_EXPERIENCE_MULTIPLIERS } = require('../server/game/models/progression');
        const expectedXp = calculateBattleExperience(enemy, BATTLE_EXPERIENCE_MULTIPLIERS.trainer, active);
        const socket = new ScriptedSocket([{ action: 'attack', number: 0 }]);
        const io = new RecordingIo({ [player.id]: socket });
        await withFixedRandom(0.5, () => startTrainerBattle(player, createTeam(enemy), io, userId));
        const saved = (await loadEquipe(userId)).pokemons[0];
        assert.ok(saved.experience > before, 'La dernière victoire de dresseur doit donner de l’XP');
        assert.equal(saved.experience, active.experience);
        assert.equal(saved.experience - before, expectedXp);
        assert.equal(saved.ev.speed, 1, 'Rattata rapporte un EV vitesse');
        const updates = io.events.filter(event => event.eventName === 'battleExperience');
        assert.equal(updates.length, 1);
        assert.equal(updates[0].targetId, player.id);
        assert.equal(updates[0].payload.xpGained, expectedXp);
        assert.equal(updates[0].payload.pokemon.uuid, saved.uuid);
        const summary = io.lastEvent(player.id, 'endbattle').payload.summary;
        assert.equal(summary.outcome, 'victory');
        assert.equal(summary.experience[0].xpGained, expectedXp);
        assert.equal(summary.experience[0].uuid, saved.uuid);
        assert.equal(summary.money, enemy.level * 30);
    } finally {
        if (userId) await pool.execute('DELETE FROM users WHERE id = ?', [userId]);
        await pool.end();
    }
});


test('arène : tous les K.O. donnent le bonus prévu, fuite sans K.O. sans XP', { skip: !shouldRun }, async () => {
    const pool = createTestPool();
    let userId;
    try {
        const { user, player } = await createPlayer(7);
        userId = user.id;
        const active = player.equipe.pokemons[0];
        active.experience = active.getNextLevelExpForLevel(100);
        active.level = 100;
        active.recalculateStats();
        const before = active.experience;
        const first = createPokemon(19, 'Premier');
        const last = createPokemon(16, 'Dernier');
        for (const enemy of [first, last]) { enemy.currentHp = 1; enemy.passiveAbility = null; }
        const { calculateBattleExperience, BATTLE_EXPERIENCE_MULTIPLIERS } = require('../server/game/models/progression');
        const expected = [first, last].reduce((sum, enemy) => sum + calculateBattleExperience(enemy, BATTLE_EXPERIENCE_MULTIPLIERS.arena, active), 0);
        const socket = new ScriptedSocket([{ action: 'attack', number: 0 }, { action: 'attack', number: 0 }]);
        await withFixedRandom(0.5, () => startTrainerBattle(player, createTeam(first, last), new RecordingIo({ [player.id]: socket }), userId, { experienceKind: 'arena' }));
        assert.equal((await loadEquipe(userId)).pokemons[0].experience, before + expected);
        const fleeSocket = new ScriptedSocket([{ action: 'flee' }]);
        await withFixedRandom(0.5, () => startTrainerBattle(player, createTeam(createPokemon(19, 'Intact')), new RecordingIo({ [player.id]: fleeSocket }), userId, { experienceKind: 'arena' }));
        assert.equal((await loadEquipe(userId)).pokemons[0].experience, before + expected);
    } finally {
        if (userId) await pool.execute('DELETE FROM users WHERE id = ?', [userId]);
        await pool.end();
    }
});

test('wild failed capture gives no money; successful capture with six companions goes to the PC and rewards normally', {skip:!shouldRun},async()=>{
 const pool=createTestPool();let userId;
 try{
  const {user,player}=await createPlayer(1);userId=user.id;
  const run=async(random,temporary=false)=>{
   const target=createPokemon(19,'Rattata',['Growl']);target.currentHp=target.maxHp;const originalAbility=target.passiveAbility;
   if(temporary){target.__passiveAbilityBeforeBattle=originalAbility;target.passiveAbility='Pressure';target.__heldItemBeforeExchange=null;target.heldItem='leftovers';target.__moveAndStatOverrides={abilities:['Growl'],movePp:[40]};target.abilities=['Thunderbolt'];target.movePp=[15];}
   const io=new RecordingIo({[player.id]:new ScriptedSocket([{action:'bag',itemKey:'pokeball'},{action:'flee'}])});
   io.originalAbility=originalAbility;await withFixedRandom(random,()=>startWildBattle(player,target,io,userId));return io;
  };
  let io=await run(.99);assert.equal(io.lastEvent(player.id,'endbattle').payload.summary.money,0);
  let [[wallet]]=await pool.execute('SELECT money FROM users WHERE id=?',[userId]);assert.equal(wallet.money,0);
  io=await run(.17);assert.equal(io.lastEvent(player.id,'endbattle').payload.summary.outcome,'captured');assert.equal(io.lastEvent(player.id,'endbattle').payload.summary.money,45);
  while(player.equipe.pokemons.length<6)player.equipe.pokemons.push(createPokemon(7,'Full team'));
  io=await run(0,true);assert.equal(io.lastEvent(player.id,'endbattle').payload.summary.money,45);
  assert.equal(player.equipe.pokemons.length,6);const stored=await require('../server/persistence/pokemonStorageRepository').loadEntries(userId);assert.equal(stored.length,1);assert.equal(stored[0].pokemon.data.id,19);assert.equal(stored[0].pokemon.passiveAbility,io.originalAbility);assert.equal(stored[0].pokemon.heldItem,null);assert.deepEqual(stored[0].pokemon.abilities,['Growl']);
  [[wallet]]=await pool.execute('SELECT money FROM users WHERE id=?',[userId]);assert.equal(wallet.money,90);
 }finally{if(userId)await pool.execute('DELETE FROM users WHERE id=?',[userId]);await pool.end();}
});

for (const mode of ['wild','trainer']) test(`${mode}: pivot publishes the right entrant before the opponent attacks`, {skip:!shouldRun}, async()=>{
    const pool=createTestPool();let userId;
    try {
        const fixture=await createPlayer(1);userId=fixture.user.id;const {player}=fixture;
        const first=player.equipe.pokemons[0],replacement=createPokemon(7,'Relay');
        first.abilities=['U-turn'];first.movePp=[20];first.currentSpeed=999;first.passiveAbility=null;
        replacement.passiveAbility=null;replacement.maxHp=replacement.currentHp=500;player.equipe.ajouterPokemon(replacement);
        const enemy=createPokemon(19,'Opponent');enemy.passiveAbility=null;enemy.currentSpeed=1;enemy.maxHp=enemy.currentHp=500;
        const socket=new ScriptedSocket([{action:'attack',number:0},{action:'flee'}]);
        const io=new RecordingIo({[player.id]:socket});io.to=targetId=>({emit:(eventName,payload)=>io.events.push({targetId,eventName,payload:JSON.parse(JSON.stringify(payload))})});
        await withFixedRandom(.5,()=>mode==='wild'?startWildBattle(player,enemy,io,userId):startTrainerBattle(player,createTeam(enemy),io,userId));
        const attack=io.events.findIndex(e=>e.eventName==='battleMoveAnimation'&&e.payload.actor==='opponent');assert(attack>0);
        const before=io.events.slice(0,attack).filter(e=>e.eventName==='introAnimation');
        assert.equal(before.at(-1).payload.player.equipe.pokemons[0].uuid,replacement.uuid);
        assert(before.some(e=>e.payload.transitions.some(t=>t.kind==='enter'&&t.uuid===replacement.uuid)));
        assert(before.every(e=>e.payload.wildPokemon.uuid===enemy.uuid),'Player must never appear on the enemy side');
        assert(replacement.currentHp<500,'Enemy attacks the entrant, not the outgoing Pokémon');
    } finally {if(userId)await pool.execute('DELETE FROM users WHERE id=?',[userId]);await pool.end();}
});
test('Adventure trainer voluntary switch consumes its action instead of granting an extra attack', {skip:!shouldRun}, async()=>{
    const pool=createTestPool();let userId;
    try {
        const fixture=await createPlayer(1);userId=fixture.user.id;const {player}=fixture;
        const lead=player.equipe.pokemons[0];lead.passiveAbility=null;lead.maxHp=lead.currentHp=500;lead.abilities=['Growl'];lead.movePp=[40];
        const enemy=createPokemon(7,'Water'),replacement=createPokemon(4,'Fire');enemy.passiveAbility=replacement.passiveAbility=null;
        const socket=new ScriptedSocket([{action:'attack',number:0},{action:'flee'}]);const io=new RecordingIo({[player.id]:socket});
        await withFixedRandom(.5,()=>startTrainerBattle(player,createTeam(enemy,replacement),io,userId));
        assert(io.events.some(e=>e.eventName==='introAnimation'&&e.payload.transitions.some(t=>t.kind==='recall'&&t.side==='opponent')));
        const attacks=io.events.filter(e=>e.eventName==='battleMoveAnimation');assert.deepEqual(attacks.map(e=>e.payload.actor),['player']);
        assert.equal(lead.currentHp,500);assert.equal(replacement.movePp[0],35);
    } finally {if(userId)await pool.execute('DELETE FROM users WHERE id=?',[userId]);await pool.end();}
});


test('combat dresseur réel : K.O. puis choix de la deuxième réserve sans subir un tour supplémentaire', { skip: !shouldRun }, async () => {
    const pool=createTestPool();let userId;
    try {
        const fixture=await createPlayer(4),{player}=fixture;userId=fixture.user.id;
        const lead=player.equipe.pokemons[0];lead.passiveAbility=null;lead.currentHp=1;lead.currentSpeed=1;lead.currentDefense=1;
        const skipped=createPokemon(25,'Premier choix'),chosen=createPokemon(7,'Choix voulu');
        skipped.passiveAbility=chosen.passiveAbility=null;player.equipe.ajouterPokemon(skipped);player.equipe.ajouterPokemon(chosen);
        const enemy=createPokemon(19,'Rival');enemy.passiveAbility=null;enemy.currentAttack=999;enemy.currentSpeed=999;
        const socket=new ScriptedSocket([{action:'attack',number:0},{action:'change',number:2},{action:'flee'}]);
        const io=new RecordingIo({[player.id]:socket}),hp=chosen.currentHp;
        assert.equal(await withFixedRandom(.5,()=>startTrainerBattle(player,createTeam(enemy),io,userId)),true);
        assert.equal(lead.currentHp,0);assert.equal(player.equipe.pokemons[0].uuid,chosen.uuid);assert.equal(chosen.currentHp,hp);
        assert.equal(chosen.movePp[0],35);assert.equal(socket.outgoing.filter(e=>e.eventName==='requestAction'&&e.payload.replacement).length,1);
        assert.equal((await loadEquipe(userId)).pokemons[0].uuid,chosen.uuid);
    } finally { if(userId)await pool.execute('DELETE FROM users WHERE id=?',[userId]);await pool.end(); }
});

test('combat PVP réel : le choix après K.O. ne consomme pas une action adverse', { skip: !shouldRun }, async () => {
    const lead=createPokemon(4,'Premier'),reserve=createPokemon(25,'Réserve'),chosen=createPokemon(7,'Choisi'),enemy=createPokemon(19,'Adversaire');
    for(const p of [lead,reserve,chosen,enemy])p.passiveAbility=null;
    lead.currentHp=1;lead.currentDefense=1;lead.currentSpeed=1;enemy.currentSpeed=999;enemy.currentAttack=999;
    const a={id:'choice-a',equipe:createTeam(lead,reserve,chosen)},b={id:'choice-b',equipe:createTeam(enemy)};
    const sa=new ScriptedSocket([{action:'attack',number:0},{action:'change',number:2},{action:'flee'}]);
    const sb=new ScriptedSocket([{action:'attack',number:0},{action:'flee'}]),io=new RecordingIo({[a.id]:sa,[b.id]:sb}),hp=chosen.currentHp;
    await withFixedRandom(.5,()=>startPvpBattle(a,b,io));
    assert.equal(lead.currentHp,0);assert.equal(a.equipe.pokemons[0].uuid,chosen.uuid);assert.equal(chosen.currentHp,hp);
    assert.equal(sa.outgoing.filter(e=>e.eventName==='requestAction'&&e.payload.replacement).length,1);
    assert.equal(sb.outgoing.filter(e=>e.eventName==='requestAction').length,2);
    assert.equal(io.events.filter(e=>e.targetId===a.id&&e.eventName==='battleMoveAnimation').length,1);
});


for(const kind of ['wild','trainer','pvp'])test(`Morphéo réseau ${kind} : météo immédiate, Ball’Météo Eau et retour normal sauvegardé`,{skip:!shouldRun},async()=>{
    const pool=createTestPool();let userId;
    try{
        const fixture=await createPlayer(7),{player}=fixture;userId=fixture.user.id;player.currentmap='start';
        const cast=require('../server/game/drift/pokemonFactory').create(351,40,true);cast.passiveAbility='Forecast';cast.abilities=['Rain Dance','Weather Ball'];cast.movePp=[5,10];player.equipe=createTeam(cast);
        const enemy=createPokemon(143,'Météorologue',['Splash']);enemy.passiveAbility='Drought';enemy.maxHp=enemy.currentHp=10000;
        const socket=new ScriptedSocket([{action:'attack',number:0},{action:'attack',number:1},{action:'flee'}]);
        const other={id:'weather-opponent',equipe:createTeam(enemy)},otherSocket=new ScriptedSocket([{action:'attack',number:0},{action:'attack',number:0},{action:'flee'}]);
        const io=new RecordingIo({[player.id]:socket,[other.id]:otherSocket});
        const battle=()=>kind==='wild'?startWildBattle(player,enemy,io,userId):kind==='trainer'?startTrainerBattle(player,other.equipe,io,userId):startPvpBattle(player,other,io);
        await withFixedRandom(.5,battle);
        const views=io.events.filter(e=>e.targetId===player.id&&e.eventName==='introAnimation').map(e=>e.payload);
        assert(views.some(v=>v.player.equipe.pokemons[0].__battle?.formSpriteId===10013)||io.events.some(e=>e.eventName==='battleText'&&e.payload.message.includes('Solaire')));
        assert(views.some(v=>v.moveTypes?.[1]==='Water'));
        const ball=io.events.find(e=>e.targetId===player.id&&e.eventName==='battleMoveAnimation'&&e.payload.moveName==='Weather Ball');assert.equal(ball.payload.moveType,'Water');
        const saved=(await loadEquipe(userId)).pokemons[0];assert.equal(saved.data.id,351);assert.equal(saved.type1,'Normal');assert.equal(saved.passiveAbility,'Forecast');assert(!saved.__battle);
    }finally{if(userId)await pool.execute('DELETE FROM users WHERE id=?',[userId]);await pool.end();}
});

test('Mounir Aventure : équipe réelle sous la pluie, Morphéo réservé et transformé, une réplique à l’entrée et récompenses sauvegardées', {skip:!shouldRun}, async()=>{
    const pool=createTestPool(); let userId;
    try {
        const {user,player}=await createPlayer(7); userId=user.id; player.currentmap='ville1_arene';
        const lead=player.equipe.pokemons[0]; lead.experience=lead.getNextLevelExpForLevel(100); lead.level=100; lead.recalculateStats(); lead.currentAttack=999; lead.currentSpeed=999;
        const team=require('../server/game/world/pnjTeamFactory').getPnjTeam('moonpunch');
        const socket=new ScriptedSocket(Array.from({length:10},()=>({action:'attack',number:0})));
        const io=new RecordingIo({[player.id]:socket}), snapshots=[];
        const to=io.to.bind(io);io.to=id=>({emit:(event,payload)=>{if(event==='introAnimation')snapshots.push(JSON.parse(JSON.stringify(payload)));to(id).emit(event,payload);}});
        await withFixedRandom(.5,()=>startTrainerBattle(player,team,io,userId,{experienceKind:'arena'}));
        assert.equal(io.lastEvent(player.id,'endbattle').payload.playerWon,true);
        assert.equal(io.events.find(e=>e.eventName==='battleFieldState').payload.weather.kind,'rain');
        const entries=snapshots.flatMap(s=>s.transitions).filter(e=>e.kind==='enter'&&e.side==='opponent');
        assert.equal(entries.at(-1).uuid,team.__trainerPlan.aceUuid);assert.equal(entries.filter(e=>e.trainerSpeech).length,1);
        assert(snapshots.some(s=>s.wildPokemon.data.id===351&&s.wildPokemon.__battle?.formSpriteId===10014));
        const [[row]]=await pool.execute('SELECT money FROM users WHERE id=?',[userId]);assert(Number(row.money)>0);
        assert.equal((await loadEquipe(userId)).pokemons[0].uuid,lead.uuid);
    } finally {if(userId)await pool.execute('DELETE FROM users WHERE id=?',[userId]);await pool.end();}
});
