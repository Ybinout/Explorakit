const { maps } = require('../../../data/game/nextMap.json');
const { loadCollisionData, changeMapData, getNextMap } = require('./mapRepository');

const entranceMaps = new Set(maps.filter(map => map.mapchange.some(change => change.goto === 'centre')).map(map => map.mapName));
const neighbors = [[0, 1], [-1, 0], [1, 0], [0, -1]];

function isCenterDoor(map, x, y) {
    return Boolean(changeMapData(map)[y]?.[x]) && getNextMap(map, x, y)?.nextMap === 'centre';
}

function normalizeCenterReturnPoint(point) {
    if (!point || !entranceMaps.has(point.map)) return null;
    const { map } = point;
    const x = Number(point.x), y = Number(point.y);
    if (!Number.isInteger(x) || !Number.isInteger(y) || x % 32 !== 16 || y % 32 !== 16) return null;
    const tileX = Math.floor(x / 32), tileY = Math.floor(y / 32);
    if (loadCollisionData(map)[tileY]?.[tileX] !== 0 || changeMapData(map)[tileY]?.[tileX]) return null;
    if (!neighbors.some(([dx, dy]) => isCenterDoor(map, tileX + dx, tileY + dy))) return null;
    return { map, x, y };
}

function getPokemonCenterEntryReturn(map, doorX, doorY, previous) {
    if (!entranceMaps.has(map) || !isCenterDoor(map, doorX, doorY)) return null;
    const candidates = [previous, ...neighbors.map(([dx, dy]) => ({ x: (doorX + dx) * 32 + 16, y: (doorY + dy) * 32 + 16 }))];
    for (const candidate of candidates) {
        const point = normalizeCenterReturnPoint({ ...candidate, map });
        if (point && Math.abs(point.x / 32 - doorX - 0.5) + Math.abs(point.y / 32 - doorY - 0.5) === 1) return point;
    }
    return null;
}

function getPokemonCenterExit(savedPoint) {
    // Legacy saves have no provenance; retain their historical city, on its safe doorstep.
    return normalizeCenterReturnPoint(savedPoint) || { map: 'ville1', x: 496, y: 304 };
}

module.exports = { getPokemonCenterEntryReturn, getPokemonCenterExit, normalizeCenterReturnPoint };
