const fs = require('fs');
const path = require('path');

const MOVES_PATH = path.resolve(__dirname, '..', '..', '..', 'data', 'game', 'moves.json');
let movesCache = null;
let moveByNameCache = null;

function loadMovesData() {
    if (Array.isArray(movesCache) && moveByNameCache instanceof Map) return movesCache;

    movesCache = JSON.parse(fs.readFileSync(MOVES_PATH, 'utf8'));
    moveByNameCache = new Map();
    for (const move of movesCache) {
        if (move && typeof move.ename === 'string') {
            moveByNameCache.set(move.ename.toLowerCase(), move);
        }
    }
    return movesCache;
}

function getMoveByName(moveName) {
    if (!moveName || typeof moveName !== 'string') return null;
    loadMovesData();
    return moveByNameCache.get(moveName.toLowerCase()) || null;
}

module.exports = { getMoveByName, loadMovesData, MOVES_PATH };
