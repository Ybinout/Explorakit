function clearBattleTransientState(team) {
    if (!Array.isArray(team)) return;
    for (const pokemon of team) {
        if (pokemon && typeof pokemon === 'object') {
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
            delete pokemon.__battle;
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

function emitSoloBattleEnd(player, io, playerWon = false, extra = {}, battleType = 'wild') {
    clearBattleTransientState(player?.equipe?.pokemons);
    const payload = {
        message: 'Fin du combat',
        playerWon: Boolean(playerWon),
        battleType,
        reason: resolveSoloReason(playerWon, extra),
        ...extra
    };
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
    io.to(playerA.id).emit('endbattle', payloadA);
    io.to(playerB.id).emit('endbattle', payloadB);
    return [payloadA, payloadB];
}

module.exports = {
    clearBattleTransientState,
    emitPvpBattleEnd,
    emitSoloBattleEnd,
    resolveSoloReason
};
