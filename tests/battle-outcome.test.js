const test = require('node:test');
const assert = require('node:assert/strict');
const {
    emitPvpBattleEnd,
    emitSoloBattleEnd
} = require('../server/game/battle/battleOutcome');

function createIoRecorder() {
    const events = [];
    return {
        events,
        to(id) {
            return {
                emit(name, payload) {
                    events.push({ id, name, payload });
                }
            };
        }
    };
}

test('la fin de combat solo produit une raison stable et nettoie les donnees temporaires', () => {
    const io = createIoRecorder();
    const player = { id: 'p1', equipe: { pokemons: [{ __battle: { statStages: { attack: 2 } } }] } };
    const payload = emitSoloBattleEnd(player, io, false, { fled: true }, 'trainer');

    assert.equal(payload.reason, 'fled');
    assert.equal(payload.battleType, 'trainer');
    assert.equal('__battle' in player.equipe.pokemons[0], false);
    assert.equal(io.events[0].name, 'endbattle');
});

test('la fin PVP donne la victoire au bon joueur et conserve le match nul explicite', () => {
    const io = createIoRecorder();
    const playerA = { id: 'a', equipe: { pokemons: [{}] } };
    const playerB = { id: 'b', equipe: { pokemons: [{}] } };
    const [payloadA, payloadB] = emitPvpBattleEnd(io, playerA, playerB, 'b', 'finished');

    assert.equal(payloadA.playerWon, false);
    assert.equal(payloadB.playerWon, true);
    assert.equal(payloadA.draw, false);
    assert.equal(payloadB.reason, 'finished');
});

test('timeout et deconnexion conservent une raison terminale exploitable par le client', () => {
    const io = createIoRecorder();
    const player = { id: 'p1', equipe: { pokemons: [{}] } };
    const timeout = emitSoloBattleEnd(player, io, false, { interrupted: true, reason: 'action_timeout' }, 'wild');
    const disconnect = emitSoloBattleEnd(player, io, false, { interrupted: true, reason: 'player_disconnected' }, 'trainer');
    assert.equal(timeout.reason, 'action_timeout');
    assert.equal(disconnect.reason, 'player_disconnected');
});

test('la fin de combat restaure les echanges temporaires de talent, objet et capacites', () => {
    const io = createIoRecorder();
    const pokemon = {
        heldItem: 'leftovers',
        passiveAbility: 'Simple',
        abilities: ['Toxic'],
        movePp: [1]
    };
    Object.defineProperty(pokemon, '__heldItemBeforeExchange', { value: 'oran_berry', configurable: true });
    Object.defineProperty(pokemon, '__passiveAbilityBeforeBattle', { value: 'Overgrow', configurable: true });
    Object.defineProperty(pokemon, '__moveAndStatOverrides', {
        value: { abilities: ['Pound'], movePp: [35] },
        configurable: true
    });
    const player = { id: 'p1', equipe: { pokemons: [pokemon] } };

    emitSoloBattleEnd(player, io, true, {}, 'trainer');

    assert.equal(pokemon.heldItem, 'oran_berry');
    assert.equal(pokemon.passiveAbility, 'Overgrow');
    assert.deepEqual(pokemon.abilities, ['Pound']);
    assert.deepEqual(pokemon.movePp, [35]);
});
