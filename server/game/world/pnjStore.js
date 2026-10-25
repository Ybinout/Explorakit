const fs = require('fs');
const path = require('node:path');

const PNJ_PATH = path.resolve(__dirname, '..', '..', '..', 'data', 'game', 'pnjs.jsonc');

function toInt(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    return Math.floor(parsed);
}

function normalizePnjEntry(entry) {
    if (!entry || typeof entry !== 'object') return null;

    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    const map = typeof entry.map === 'string' ? entry.map.trim() : '';
    const x = toInt(entry.x);
    const y = toInt(entry.y);

    if (!name || !map || x === null || y === null) {
        return null;
    }

    return {
        name,
        interactionName: typeof entry.interactionName === 'string' && entry.interactionName.trim()
            ? entry.interactionName.trim()
            : name,
        map,
        x,
        y,
        anchorX: x,
        anchorY: y,
        roamRadius: Math.min(2, Math.max(0, toInt(entry.roamRadius) || 0)),
        spriteFrame: entry.spriteFrame || null,
        sprite: typeof entry.sprite === 'string' && entry.sprite.trim()
            ? entry.sprite.trim()
            : 'perso1.png',
        ...(Number.isInteger(entry.challengeLevel) ? { challengeLevel: entry.challengeLevel } : {}),
        blockingWidth: Math.min(2, Math.max(1, toInt(entry.blockingWidth) || 1)),
        block: entry.block !== false
    };
}

function loadPnjConfig() {
    try {
        const rawData = fs.readFileSync(PNJ_PATH, 'utf8');
        const parsed = JSON.parse(rawData);
        const rawPnjs = Array.isArray(parsed?.pnjs) ? parsed.pnjs : [];

        return rawPnjs
            .map(normalizePnjEntry)
            .filter(Boolean);
    } catch (error) {
        console.error('Error reading pnjs.jsonc:', error);
        return [];
    }
}

function getOccupiedTileKeysForPnj(pnj) {
    const keys = [];
    for (let dx = 0; dx < (pnj.blockingWidth || 1); dx++) {
        keys.push(`${pnj.x + dx}:${pnj.y}`);
        if (pnj.y > 0) keys.push(`${pnj.x + dx}:${pnj.y - 1}`);
    }

    return keys;
}

function createPnjStore(extraEntries = []) {
    const allPnjs = [...loadPnjConfig(), ...extraEntries.map(normalizePnjEntry).filter(Boolean)];
    const pnjByMap = new Map();
    const pnjTileIndex = new Map();

    for (const pnj of allPnjs) {
        const currentList = pnjByMap.get(pnj.map) || [];
        currentList.push(pnj);
        pnjByMap.set(pnj.map, currentList);

        const tileMap = pnjTileIndex.get(pnj.map) || new Map();
        const occupiedTileKeys = getOccupiedTileKeysForPnj(pnj);

        occupiedTileKeys.forEach((tileKey) => {
            const tilePnjs = tileMap.get(tileKey) || [];
            tilePnjs.push(pnj);
            tileMap.set(tileKey, tilePnjs);
        });

        pnjTileIndex.set(pnj.map, tileMap);
    }

    function getPnjsForMap(mapName) {
        const pnjs = pnjByMap.get(mapName) || [];
        return pnjs.map((pnj) => ({ ...pnj }));
    }

    function getPnjAtTile(mapName, x, y) {
        const tileMap = pnjTileIndex.get(mapName);
        if (!tileMap) return null;

        const pnjsOnTile = tileMap.get(`${x}:${y}`);
        if (!Array.isArray(pnjsOnTile) || pnjsOnTile.length === 0) return null;

        return pnjsOnTile[0];
    }

    function isPnjBlockingTile(mapName, x, y) {
        const tileMap = pnjTileIndex.get(mapName);
        if (!tileMap) return false;

        const pnjsOnTile = tileMap.get(`${x}:${y}`);
        if (!Array.isArray(pnjsOnTile) || pnjsOnTile.length === 0) return false;

        return pnjsOnTile.some((pnj) => pnj.block !== false);
    }

    function movePnj(name, mapName, x, y) {
        const pnj = (pnjByMap.get(mapName) || []).find(entry => entry.name === name);
        if (!pnj) return false;
        const tileMap = pnjTileIndex.get(mapName);
        for (const key of getOccupiedTileKeysForPnj(pnj)) {
            tileMap.set(key, (tileMap.get(key) || []).filter(entry => entry !== pnj));
        }
        pnj.x = x;
        pnj.y = y;
        for (const key of getOccupiedTileKeysForPnj(pnj)) {
            tileMap.set(key, [...(tileMap.get(key) || []), pnj]);
        }
        return true;
    }

    return {
        getPnjsForMap,
        getPnjAtTile,
        movePnj,
        isPnjBlockingTile
    };

}

module.exports = { ...createPnjStore(), createPnjStore };
