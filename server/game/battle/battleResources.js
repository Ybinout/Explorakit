const fs = require('node:fs');
const path = require('node:path');
const rampage = require('./rampageMoves');

const MOVES_PATH = path.resolve(__dirname, '..', '..', '..', 'data', 'game', 'moves.json');
const ITEMS_PATH = path.resolve(__dirname, '..', '..', '..', 'data', 'game', 'items.json');

let moveByName = null;
let itemByKey = null;

function loadMoveIndex() {
    if (moveByName) return moveByName;
    const parsed = JSON.parse(fs.readFileSync(MOVES_PATH, 'utf8'));
    const moves = Array.isArray(parsed) ? parsed : parsed.moves || [];
    moveByName = new Map(moves.map((move) => [String(move.ename).toLowerCase(), move]));
    return moveByName;
}

function getMoveDefinition(moveName) {
    if (typeof moveName !== 'string' || !moveName.trim()) return null;
    return loadMoveIndex().get(moveName.toLowerCase()) || null;
}

function getItemDefinition(itemKey) {
    if (typeof itemKey !== 'string' || !itemKey) return null;
    if (!itemByKey) {
        const parsed = JSON.parse(fs.readFileSync(ITEMS_PATH, 'utf8'));
        itemByKey = new Map((parsed.items || []).map((item) => [item.key, item]));
    }
    return itemByKey.get(itemKey) || null;
}

function getMaxMovePp(moveName) {
    const value = Number(getMoveDefinition(moveName)?.pp);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

function getPokemonMoveMaxPp(pokemon, moveName) {
    const max = getMaxMovePp(moveName);
    return pokemon?.__battle?.transformed ? Math.min(5, max) : max;
}

function normalizeMovePp(pokemon) {
    if (!pokemon || typeof pokemon !== 'object') return [];
    const moves = Array.isArray(pokemon.abilities) ? pokemon.abilities.slice(0, 4) : [];
    const existing = Array.isArray(pokemon.movePp) ? pokemon.movePp : [];
    pokemon.movePp = moves.map((moveName, index) => {
        const maxPp = getPokemonMoveMaxPp(pokemon, moveName);
        const currentPp = Number(existing[index]);
        return Number.isFinite(currentPp) ? Math.max(0, Math.min(maxPp, Math.floor(currentPp))) : maxPp;
    });
    return pokemon.movePp;
}

function getMoveSlot(pokemon, moveName) {
    if (!Array.isArray(pokemon?.abilities) || typeof moveName !== 'string') return -1;
    return pokemon.abilities.findIndex((candidate) => candidate === moveName);
}

function getMovePp(pokemon, moveName) {
    const slot = getMoveSlot(pokemon, moveName);
    if (slot < 0) return null;
    normalizeMovePp(pokemon);
    return {
        slot,
        current: pokemon.movePp[slot],
        max: getPokemonMoveMaxPp(pokemon, moveName)
    };
}

function consumeMovePp(pokemon, moveName, amount = 1) {
    const state = getMovePp(pokemon, moveName);
    if (!state) return { consumed: false, reason: 'move_not_known', ...state };
    if (state.current <= 0) return { consumed: false, reason: 'empty', ...state };
    const consumed = Math.min(state.current, Math.max(1, Math.floor(Number(amount) || 1)));
    pokemon.movePp[state.slot] -= consumed;
    return { consumed: true, amount: consumed, ...state, current: pokemon.movePp[state.slot] };
}

function reduceMovePp(pokemon, moveName, amount = 1) {
    const state = getMovePp(pokemon, moveName);
    if (!state) return 0;
    const reduction = Math.min(state.current, Math.max(0, Math.floor(Number(amount) || 0)));
    pokemon.movePp[state.slot] -= reduction;
    return reduction;
}

function restoreMovePp(pokemon, moveName = null) {
    normalizeMovePp(pokemon);
    if (!moveName) {
        const moves = Array.isArray(pokemon?.abilities) ? pokemon.abilities : [];
        pokemon.movePp = moves.map((name) => getPokemonMoveMaxPp(pokemon, name));
        return true;
    }
    const slot = getMoveSlot(pokemon, moveName);
    if (slot < 0) return false;
    pokemon.movePp[slot] = getPokemonMoveMaxPp(pokemon, moveName);
    return true;
}

function getUsableMoveIndexes(pokemon, battleState = null) {
    if (!Array.isArray(pokemon?.abilities)) return [];
    normalizeMovePp(pokemon);
    const charging = getForcedMove(pokemon);
    // The release costs no PP, even if preparation used the last PP. Called
    // moves can charge without occupying a normal move slot (index -1).
    if (charging) return [getMoveSlot(pokemon, charging)];
    return pokemon.abilities
        .map((moveName, index) => (moveName && pokemon.movePp[index] > 0 && require('../items/heldItems').allowsMove(pokemon, moveName, battleState) ? index : -1))
        .filter((index) => index >= 0);
}

function isMoveSelectionValid(pokemon, index, battleState = null) {
    if (!Number.isInteger(index)) return false;
    const usable = getUsableMoveIndexes(pokemon, battleState);
    return usable.length ? usable.includes(index) : index === 0;
}

function getChargingMove(pokemon) {
    const data = pokemon?.__battle;
    return Number(pokemon?.currentHp) > 0 && data?.chargeTurns > 0 && getMoveDefinition(data.chargeMove)
        ? data.chargeMove : null;
}

function getForcedMove(pokemon) {
    return getChargingMove(pokemon) || rampage.current(pokemon)?.move || (Number(pokemon?.currentHp) > 0 && pokemon?.__battle?.bideTurns > 0 ? 'Bide' : null) || (Number(pokemon?.currentHp) > 0 && pokemon?.__battle?.rechargeMove
        ? pokemon.__battle.rechargeMove : null);
}

function selectedMoveName(pokemon, index) {
    return getForcedMove(pokemon) || pokemon?.getAtkName?.(index) || pokemon?.abilities?.[index] || 'Struggle';
}

module.exports = {
    consumeMovePp,
    getMaxMovePp,
    getItemDefinition,
    getMoveDefinition,
    getMovePp,
    getMoveSlot,
    getUsableMoveIndexes,
    isMoveSelectionValid,
    getChargingMove,
    getForcedMove,
    selectedMoveName,
    normalizeMovePp,
    reduceMovePp,
    restoreMovePp
};
