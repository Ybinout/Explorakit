const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildBattleSummary,
    createBattleSummaryTracker,
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
    assert.equal(payload.summary.outcome, 'fled');
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
    assert.equal(payloadA.summary.outcome, 'defeat');
    assert.equal(payloadB.summary.outcome, 'victory');
});

test('timeout et deconnexion conservent une raison terminale exploitable par le client', () => {
    const io = createIoRecorder();
    const player = { id: 'p1', equipe: { pokemons: [{}] } };
    const timeout = emitSoloBattleEnd(player, io, false, { interrupted: true, reason: 'action_timeout' }, 'wild');
    const disconnect = emitSoloBattleEnd(player, io, false, { interrupted: true, reason: 'player_disconnected' }, 'trainer');
    assert.equal(timeout.reason, 'action_timeout');
    assert.equal(disconnect.reason, 'player_disconnected');
    assert.equal(timeout.summary.outcome, 'interrupted');
    assert.equal(disconnect.summary.outcome, 'interrupted');
});

test('le bilan distingue capture, fuite, forfait, match nul et interruption sans inventer de récompense', () => {
    const cases = [
        [{ playerWon: true, reason: 'captured' }, 'captured'],
        [{ playerWon: true, reason: 'fled' }, 'victory'],
        [{ playerWon: false, reason: 'fled' }, 'fled'],
        [{ playerWon: false, reason: 'forfeit' }, 'defeat'],
        [{ playerWon: false, reason: 'both_fled', draw: true }, 'draw'],
        [{ playerWon: false, reason: 'draw', draw: true }, 'draw'],
        [{ playerWon: false, reason: 'error', draw: true }, 'interrupted'],
        [{ playerWon: false, reason: 'timer' }, 'interrupted'],
        [{ playerWon: false, reason: 'closed' }, 'interrupted']
    ];
    for (const [payload, expected] of cases) {
        const result = buildBattleSummary(payload);
        assert.equal(result.outcome, expected);
        assert.equal(result.money, 0);
        assert.deepEqual(result.experience, []);
        assert.deepEqual(result.loot, []);
        assert.equal(result.capturedPokemon, null);
    }
});

test('le bilan suit XP et niveaux réels malgré les changements, pertes Drift et purge ultérieure', () => {
    const active = { uuid: 'active', data: { id: 1 }, truename: 'Bulbizarre', level: 5, experience: 100 };
    const reserve = { uuid: 'reserve', data: { id: 4 }, truename: 'Salamèche', level: 5, experience: 100 };
    const tracker = createBattleSummaryTracker([active, reserve], 'drift');
    active.experience += 25;
    active.level = 6;
    reserve.experience += 8;
    tracker.money = 40;
    tracker.loot.push('Poké Ball');
    const captured = { uuid: 'caught', data: { id: 19 }, truename: 'Rattata', level: 3, experience: 60 };
    const summary = tracker.snapshot([reserve, captured], captured);
    assert.deepEqual(summary.experience.map(p => [p.uuid, p.xpGained, p.previousLevel, p.level]), [
        ['active', 25, 5, 6], ['reserve', 8, 5, 5]
    ]);
    assert.equal(summary.capturedPokemon.pokemonId, 19);
    assert.equal(summary.lostPokemon[0].uuid, 'active');
    assert.equal(summary.money, 40);
    active.experience = 0;
    tracker.loot.length = 0;
    assert.equal(summary.experience[0].xpGained, 25);
    assert.deepEqual(summary.loot, ['Poké Ball']);
    const adventure = createBattleSummaryTracker([active]).snapshot([]);
    assert.deepEqual(adventure.lostPokemon, [], 'Les K.O. Aventure ne sont pas des pertes définitives');
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
