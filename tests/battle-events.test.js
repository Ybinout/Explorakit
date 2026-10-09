const test = require('node:test');
const assert = require('node:assert/strict');
const {
    emitFieldState,
    emitPvpMoveResult,
    emitSoloMoveResult,
    serializeMoveResult
} = require('../server/game/battle/battleEvents');

function createIoRecorder() {
    const events = [];
    return {
        events,
        to(socketId) {
            return {
                emit(event, payload) {
                    events.push({ socketId, event, payload });
                }
            };
        }
    };
}

test('serializeMoveResult expose les evenements visuels importants', () => {
    assert.deepEqual(serializeMoveResult('opponent', {
        moveName: 'Thunderbolt',
        success: true,
        damage: 42,
        critical: true,
        effectiveness: 2
    }), {
        actor: 'opponent',
        moveName: 'Thunderbolt',
        success: true,
        damage: 42,
        missed: false,
        blocked: false,
        immune: false,
        critical: true,
        effectiveness: 2
    });

    assert.equal(serializeMoveResult('player', { effectiveness: 0 }).immune, true);
    assert.equal(serializeMoveResult('player', { missed: true }).missed, true);
});

test('emitFieldState ne duplique pas un destinataire', () => {
    const io = createIoRecorder();
    emitFieldState(io, ['socket-a', 'socket-a'], {
        turn: 3,
        weather: { kind: 'rain', turns: 4 },
        terrain: { kind: 'electric_terrain', turns: 2 }
    });

    assert.equal(io.events.length, 1);
    assert.deepEqual(io.events[0].payload.weather, { kind: 'rain', turns: 4 });
});

test('les resultats solo et PVP respectent la perspective du joueur', () => {
    const io = createIoRecorder();
    const activePokemon = { name: 'Hero' };
    const player = { id: 'solo', equipe: { pokemons: [activePokemon] } };
    emitSoloMoveResult(io, player, activePokemon, { success: true, damage: 10 }, {});
    assert.equal(io.events[0].payload.actor, 'player');

    io.events.length = 0;
    emitPvpMoveResult(io, { id: 'a' }, { id: 'b' }, { missed: true }, {});
    const resultEvents = io.events.filter((entry) => entry.event === 'battleMoveResult');
    assert.equal(resultEvents.length, 2);
    assert.equal(resultEvents[0].payload.actor, 'player');
    assert.equal(resultEvents[1].payload.actor, 'opponent');
});
