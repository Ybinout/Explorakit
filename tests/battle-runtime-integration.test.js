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
            const action = this.actions.shift() || { action: 'flee' };
            setImmediate(() => super.emit('actionResponse', action));
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
        const wildPokemon = createPokemon(19, 'Rattata');
        wildPokemon.maxHp = 100;
        wildPokemon.currentHp = 1;

        const socket = new ScriptedSocket([{ action: 'bag', itemKey: 'hyperball' }]);
        const io = new RecordingIo({ [player.id]: socket });
        const result = await withFixedRandom(0, () => startWildBattle(player, wildPokemon, io, userId));

        assert.equal(result, true);
        assert.equal(io.lastEvent(player.id, 'captureAnimation')?.payload.success, true);
        assert.equal(io.lastEvent(player.id, 'endbattle')?.payload.reason, 'captured');
        assert.equal((await loadEquipe(userId)).pokemons.length, 2);
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
        player.equipe.ajouterPokemon(replacement);

        const wildPokemon = createPokemon(19, 'Rattata');
        wildPokemon.currentAttack = 999;
        wildPokemon.currentSpeed = 999;
        const socket = new ScriptedSocket([
            { action: 'attack', number: 0 },
            { action: 'flee' }
        ]);
        const io = new RecordingIo({ [player.id]: socket });
        const result = await withFixedRandom(0.5, () => startWildBattle(player, wildPokemon, io, userId));

        assert.equal(result, true);
        assert.equal(firstPokemon.currentHp, 0);
        assert.equal(player.equipe.pokemons[0].uuid, replacement.uuid);
        assert.equal(io.lastEvent(player.id, 'endbattle')?.payload.reason, 'fled');
        assert.equal((await loadEquipe(userId)).pokemons[0].uuid, replacement.uuid);
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
        player.equipe.pokemons[0].currentAttack = 999;
        player.equipe.pokemons[0].currentSpeed = 999;
        const enemy = createPokemon(19, 'Adversaire');
        enemy.currentHp = 1;
        const enemyTeam = createTeam(enemy);
        const socket = new ScriptedSocket([{ action: 'attack', number: 0 }]);
        const io = new RecordingIo({ [player.id]: socket });

        const result = await withFixedRandom(0.5, () => startTrainerBattle(player, enemyTeam, io, userId));
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
    const playerA = { id: 'pvp-a', username: 'Alice', equipe: createTeam(pokemonA) };
    const playerB = { id: 'pvp-b', username: 'Bob', equipe: createTeam(pokemonB) };
    const io = new RecordingIo({
        [playerA.id]: new ScriptedSocket([{ action: 'attack', number: 0 }]),
        [playerB.id]: new ScriptedSocket([{ action: 'attack', number: 0 }])
    });

    const result = await withFixedRandom(0.5, () => startPvpBattle(playerA, playerB, io));

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

