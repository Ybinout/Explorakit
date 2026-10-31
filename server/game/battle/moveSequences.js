// Bounded, battle-local history. Power queries are read-only, including AI previews.
const ROLLING = new Set(['Rollout', 'Ice Ball']);
function rolling(pokemon) {
    const data = pokemon?.__battle;
    return pokemon?.currentHp > 0 && ROLLING.has(data?.rollingMove)
        && Number.isInteger(data.rollingHits) && data.rollingHits > 0 && data.rollingHits < 5
        ? { move: data.rollingMove, hits: data.rollingHits } : null;
}
function clearRolling(pokemon) {
    if (!pokemon?.__battle) return;
    delete pokemon.__battle.rollingMove;
    delete pokemon.__battle.rollingHits;
}
function echoCount(state) {
    const echo = state?.echoedVoice;
    if (!echo || !Number.isInteger(echo.turn) || !Number.isInteger(echo.count)) return 1;
    if (echo.turn === state.turn) return Math.min(5, Math.max(1, echo.count));
    return echo.turn === state.turn - 1 ? Math.min(5, echo.count + 1) : 1;
}
function begin(move, state) {
    if (move.ename === 'Echoed Voice' && state) state.echoedVoice = { turn: state.turn, count: echoCount(state) };
}
function power(move, attacker, context = {}) {
    const data = attacker?.__battle || {}, state = context.battleState, base = Number(move.power) || 0;
    if (ROLLING.has(move.ename)) return base * 2 ** (rolling(attacker)?.move === move.ename ? data.rollingHits : 0) * (data.defenseCurl ? 2 : 1);
    if (move.ename === 'Fury Cutter') return base * 2 ** (data.furyCutterTurn === state?.turn - 1 ? Math.min(2, data.furyCutterHits || 0) : 0);
    if (move.ename === 'Echoed Voice') return base * echoCount(state);
    if (move.ename === 'Retaliate') return base * ([context.attackerSide?.lastFaintTurn,context.attackerSide?.previousFaintTurn].includes(state?.turn - 1) ? 2 : 1);
    if (move.ename === 'Fusion Bolt' || move.ename === 'Fusion Flare') {
        const other = move.ename === 'Fusion Bolt' ? 'Fusion Flare' : 'Fusion Bolt';
        return base * (state?.lastSuccessfulMove?.turn === state?.turn && state.lastSuccessfulMove.name === other ? 2 : 1);
    }
    return null;
}
function finish(pokemon, result, state, { called = false } = {}) {
    if (!pokemon || result.calledMoveResolved) return;
    const data = pokemon.__battle ||= {}, name = result.moveName;
    const hit = result.success && result.hits > 0 && result.effectiveness > 0 && !result.missed && !result.blocked && !result.actionPrevented;
    if (ROLLING.has(name)) {
        const next = (rolling(pokemon)?.move === name ? data.rollingHits : 0) + 1;
        if (hit && pokemon.currentHp > 0 && pokemon.status !== 'sleep' && !called && next < 5) {
            data.rollingMove = name; data.rollingHits = next;
        } else clearRolling(pokemon);
    } else if (!called) clearRolling(pokemon);
    if (name === 'Fury Cutter' && hit) {
        data.furyCutterHits = Math.min(2, (data.furyCutterTurn === state.turn - 1 ? data.furyCutterHits || 0 : 0) + 1);
        data.furyCutterTurn = state.turn;
    } else {
        delete data.furyCutterHits; delete data.furyCutterTurn;
    }
    if (name === 'Defense Curl' && result.success && pokemon.currentHp > 0) data.defenseCurl = true;
    if (result.success && !result.blocked && !result.missed && (hit || result.move?.combat?.damage_class === 'status')) {
        state.lastSuccessfulMove = { turn: state.turn, name };
    }
}
function recordFaint(pokemon, side, state) {
    if (!pokemon || !side || !state) return;
    const data = pokemon.__battle ||= {};
    if (pokemon.currentHp > 0) { delete data.faintRecorded; return; }
    if (!data.faintRecorded) {
        if (side.lastFaintTurn !== state.turn) side.previousFaintTurn = side.lastFaintTurn;
        side.lastFaintTurn = state.turn; data.faintRecorded = true;
    }
}
module.exports = { ROLLING, rolling, clearRolling, begin, power, finish, echoCount, recordFaint };
