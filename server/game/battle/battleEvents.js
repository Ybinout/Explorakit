function serializeFieldState(battleState = {}) {
    return {
        turn: Number(battleState.turn) || 1,
        weather: {
            kind: battleState.weather?.kind || null,
            turns: Math.max(0, Number(battleState.weather?.turns) || 0),
            ...(battleState.weather?.persistent ? { persistent: true, source: 'map' } : {})
        },
        terrain: {
            kind: battleState.terrain?.kind || null,
            turns: Math.max(0, Number(battleState.terrain?.turns) || 0)
        }
    };
}

function serializeMoveResult(actor, result = {}) {
    const effectiveness = Number(result.effectiveness);
    return {
        actor: actor === 'opponent' ? 'opponent' : 'player',
        moveName: result.moveName || result.move?.ename || null,
        ...(result.phase ? { phase: result.phase } : {}),
        success: Boolean(result.success),
        damage: Math.max(0, Number(result.damage) || 0),
        hits: Math.max(0, Math.min(10, Math.floor(Number(result.hits) || 0))),
        missed: Boolean(result.missed),
        blocked: Boolean(result.blocked),
        immune: Number.isFinite(effectiveness) && effectiveness === 0,
        critical: Boolean(result.critical),
        effectiveness: Number.isFinite(effectiveness) ? effectiveness : 1
    };
}

function emitFieldState(io, socketIds, battleState) {
    const ids = Array.isArray(socketIds) ? socketIds : [socketIds];
    const payload = serializeFieldState(battleState);
    for (const socketId of new Set(ids.filter(Boolean))) {
        io.to(socketId).emit('battleFieldState', payload);
    }
    return payload;
}

function emitSoloMoveResult(io, player, attacker, result, battleState) {
    if (!player?.id) return null;
    const actor = attacker === player?.equipe?.pokemons?.[0] ? 'player' : 'opponent';
    const payload = serializeMoveResult(actor, result);
    io.to(player.id).emit('battleMoveResult', payload);
    emitFieldState(io, player.id, battleState);
    return payload;
}

function emitPvpMoveResult(io, attackerPlayer, defenderPlayer, result, battleState) {
    if (attackerPlayer?.id) {
        io.to(attackerPlayer.id).emit('battleMoveResult', serializeMoveResult('player', result));
    }
    if (defenderPlayer?.id) {
        io.to(defenderPlayer.id).emit('battleMoveResult', serializeMoveResult('opponent', result));
    }
    emitFieldState(io, [attackerPlayer?.id, defenderPlayer?.id], battleState);
}

module.exports = {
    emitFieldState,
    emitPvpMoveResult,
    emitSoloMoveResult,
    serializeFieldState,
    serializeMoveResult
};
