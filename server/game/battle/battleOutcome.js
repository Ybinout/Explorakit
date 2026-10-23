const { growthSnapshot, levelGrowth } = require('../models/levelGrowth');
function clearBattleTransientState(team) {
    if (!Array.isArray(team)) return;
    for (const pokemon of team) {
        if (pokemon && typeof pokemon === 'object') {
            require('../abilities/abilityForms').clear(pokemon);
            if (Object.prototype.hasOwnProperty.call(pokemon, '__heldItemBeforeExchange')) {
                pokemon.heldItem = pokemon.__heldItemBeforeExchange;
                delete pokemon.__heldItemBeforeExchange;
            }
            if (Object.prototype.hasOwnProperty.call(pokemon, '__passiveAbilityBeforeBattle')) {
                pokemon.passiveAbility = pokemon.__passiveAbilityBeforeBattle;
                delete pokemon.__passiveAbilityBeforeBattle;
            }
            if (Object.prototype.hasOwnProperty.call(pokemon, '__moveAndStatOverrides')) {
                Object.assign(pokemon, pokemon.__moveAndStatOverrides);
                delete pokemon.__moveAndStatOverrides;
            }
            delete pokemon.__heldItemOrigin;
            delete pokemon.__consumedHeldItemOrigin;
            delete pokemon.__battle;
            pokemon.resetCombatStats?.();
        }
    }
}

function resolveSoloReason(playerWon, extra = {}) {
    if (typeof extra.reason === 'string' && extra.reason.trim()) return extra.reason.trim();
    if (extra.captured) return 'captured';
    if (extra.fled) return 'fled';
    if (extra.interrupted) return 'interrupted';
    return playerWon ? 'victory' : 'defeat';
}

function describePokemon(pokemon) {
    if (!pokemon) return null;
    return {
        uuid: pokemon.uuid || null,
        pokemonId: Number(pokemon.data?.id) || null,
        name: pokemon.truename || pokemon.name || 'Pokémon',
        level: Number(pokemon.level) || 1
    };
}

function resolveOutcome(payload) {
    const reason = payload.reason;
    if (payload.captured || reason === 'captured') return 'captured';
    if (payload.interrupted || ['timer', 'closed', 'error', 'interrupted', 'action_timeout', 'timeout',
        'socket_missing', 'player_disconnected', 'disconnect', 'both_disconnected',
        'invalid_team', 'invalid_players'].includes(reason)) return 'interrupted';
    if (payload.playerWon) return 'victory';
    if (payload.draw || reason === 'draw' || reason === 'both_fled') return 'draw';
    if (payload.fled || reason === 'fled') return 'fled';
    return 'defeat';
}

function buildBattleSummary(payload, details = {}) {
    return {
        outcome: resolveOutcome(payload),
        mode: details.mode === 'drift' ? 'drift' : 'adventure',
        experience: details.experience || [],
        money: Number(details.money) || 0,
        loot: details.loot || [],
        capturedPokemon: details.capturedPokemon || null,
        lostPokemon: details.lostPokemon || []
    };
}

// Keep references to the starting team: switches must not duplicate XP, and
// Drift removes defeated Pokémon before the result is sent to the client.
class BattleSummaryTracker {
    constructor(team = [], mode = 'adventure') {
    this.mode=mode; this.team=team; this.initial = team.map(pokemon => ({
        pokemon,
        growth: growthSnapshot(pokemon),
        experience: Number(pokemon.experience) || 0,
        level: Number(pokemon.level) || 1
    }));
    this.money=0; this.loot=[];
    }
    snapshot(currentTeam = this.team, capturedPokemon = null) {
            return {
                mode: this.mode,
                experience: this.initial.flatMap(({ pokemon, experience, level, growth }) => {
                    const xpGained = Math.max(0, (Number(pokemon.experience) || 0) - experience);
                    return xpGained ? [{ ...describePokemon(pokemon), xpGained, previousLevel: level, levelGrowth:levelGrowth(pokemon,growth) }] : [];
                }),
                money: this.money,
                loot: [...this.loot],
                capturedPokemon: describePokemon(capturedPokemon),
                lostPokemon: this.mode === 'drift'
                    ? this.initial.filter(({ pokemon }) => !currentTeam.includes(pokemon)).map(({ pokemon }) => describePokemon(pokemon))
                    : []
            };
    }
}
function createBattleSummaryTracker(team,mode) { return new BattleSummaryTracker(team,mode); }

function emitSoloBattleEnd(player, io, playerWon = false, extra = {}, battleType = 'wild') {
    clearBattleTransientState(player?.equipe?.pokemons);
    const payload = {
        message: 'Fin du combat',
        playerWon: Boolean(playerWon),
        battleType,
        reason: resolveSoloReason(playerWon, extra),
        ...extra
    };
    payload.summary = buildBattleSummary(payload, extra.summary);
    io.to(player.id).emit('endbattle', payload);
    return payload;
}

function emitPvpBattleEnd(io, playerA, playerB, winnerId = null, reason = 'finished') {
    clearBattleTransientState(playerA?.equipe?.pokemons);
    clearBattleTransientState(playerB?.equipe?.pokemons);
    const draw = !winnerId;
    const payloadA = {
        message: 'Fin du combat',
        playerWon: !draw && winnerId === playerA.id,
        battleType: 'pvp',
        reason,
        draw
    };
    const payloadB = {
        ...payloadA,
        playerWon: !draw && winnerId === playerB.id
    };
    payloadA.summary = buildBattleSummary(payloadA);
    payloadB.summary = buildBattleSummary(payloadB);
    io.to(playerA.id).emit('endbattle', payloadA);
    io.to(playerB.id).emit('endbattle', payloadB);
    return [payloadA, payloadB];
}

module.exports = {
    BattleSummaryTracker,
    clearBattleTransientState,
    buildBattleSummary,
    createBattleSummaryTracker,
    emitPvpBattleEnd,
    emitSoloBattleEnd,
    resolveSoloReason
};
