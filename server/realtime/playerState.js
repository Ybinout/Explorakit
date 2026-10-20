const { loadCollisionData, changeMapData } = require('../game/world/mapRepository');
const { isPnjBlockingTile } = require('../game/world/pnjStore');

const DEFAULT_MAP = 'start';
const DEFAULT_POSITION = Object.freeze({ x: 80, y: 208 });
const TILE_SIZE = 32;
const MAP_CENTER_OFFSET = 16;

function getPlayerDisplayName(player) {
    if (!player) return 'Joueur';
    if (typeof player.username === 'string' && player.username.trim()) return player.username.trim();
    return `Joueur ${player.userId}`;
}

function getPlayerTilePosition(player) {
    if (!player) return { x: -1, y: -1 };
    return { x: Math.floor(player.x / TILE_SIZE), y: Math.floor(player.y / TILE_SIZE) };
}

function getTileDistance(playerA, playerB) {
    const tileA = getPlayerTilePosition(playerA);
    const tileB = getPlayerTilePosition(playerB);
    return Math.abs(tileA.x - tileB.x) + Math.abs(tileA.y - tileB.y);
}

function arePlayersCloseEnough(playerA, playerB) {
    return Boolean(playerA && playerB
        && playerA.currentmap === playerB.currentmap
        && getTileDistance(playerA, playerB) <= 1);
}

function getDirectionFromAction(action) {
    return { move_z: 'up', move_q: 'left', move_s: 'down', move_d: 'right' }[action] || null;
}

function buildPositionSnapshot(player) {
    return {
        x: Math.round(player.x), y: Math.round(player.y), map: player.currentmap,
        centerReturnPoint: player.centerReturnPoint ? { ...player.centerReturnPoint } : null
    };
}

function positionsAreEqual(posA, posB) {
    const a = posA?.centerReturnPoint, b = posB?.centerReturnPoint;
    return Boolean(posA && posB && posA.x === posB.x && posA.y === posB.y && posA.map === posB.map
        && a?.map === b?.map && a?.x === b?.x && a?.y === b?.y);
}

function toPublicPlayer(player) {
    return {
        id: player.id,
        userId: player.userId,
        username: player.username,
        x: player.x,
        y: player.y,
        sprite: player.sprite,
        direction: player.direction,
        isMoving: Boolean(player.isMoving),
        animationFrame: Number(player.animationFrame) || 0,
        currentmap: player.currentmap,
        inbattle: Boolean(player.inbattle)
    };
}

function getPlayersInMap(players, mapName) {
    return Object.fromEntries(
        Object.entries(players)
            .filter(([, player]) => player.currentmap === mapName)
            .map(([id, player]) => [id, toPublicPlayer(player)])
    );
}

function resolveMapName(mapName) {
    if (typeof mapName !== 'string' || !mapName.trim()) return DEFAULT_MAP;
    const trimmedMap = mapName.trim();
    try {
        loadCollisionData(trimmedMap);
        return trimmedMap;
    } catch (error) {
        return DEFAULT_MAP;
    }
}

function findFirstWalkablePosition(collisionData2D, mapName) {
    let changes = [];
    try { changes = changeMapData(mapName); } catch (_) { /* Synthetic callers may have no map metadata. */ }
    for (let y = 0; y < collisionData2D.length; y += 1) {
        for (let x = 0; x < collisionData2D[y].length; x += 1) {
            if (collisionData2D[y][x] === 0 && !changes[y]?.[x] && !isPnjBlockingTile(mapName, x, y)) {
                return { x: x * TILE_SIZE + MAP_CENTER_OFFSET, y: y * TILE_SIZE + MAP_CENTER_OFFSET };
            }
        }
    }
    return { ...DEFAULT_POSITION };
}

function sanitizeSpawnPosition(rawX, rawY, collisionData2D, mapName) {
    const safeFallback = findFirstWalkablePosition(collisionData2D, mapName);
    const parsedX = Number(rawX);
    const parsedY = Number(rawY);
    const numericX = Number.isFinite(parsedX) ? parsedX : DEFAULT_POSITION.x;
    const numericY = Number.isFinite(parsedY) ? parsedY : DEFAULT_POSITION.y;
    const snapToGrid = (value) => Math.round((value - MAP_CENTER_OFFSET) / TILE_SIZE) * TILE_SIZE + MAP_CENTER_OFFSET;
    const maxXIndex = Math.max(0, (collisionData2D[0]?.length || 1) - 1);
    const maxYIndex = Math.max(0, collisionData2D.length - 1);
    let x = Math.min(Math.max(snapToGrid(numericX), MAP_CENTER_OFFSET), maxXIndex * TILE_SIZE + MAP_CENTER_OFFSET);
    let y = Math.min(Math.max(snapToGrid(numericY), MAP_CENTER_OFFSET), maxYIndex * TILE_SIZE + MAP_CENTER_OFFSET);
    const matrixX = Math.floor(x / TILE_SIZE);
    const matrixY = Math.floor(y / TILE_SIZE);
    if (!collisionData2D[matrixY]
        || collisionData2D[matrixY][matrixX] !== 0
        || isPnjBlockingTile(mapName, matrixX, matrixY)) {
        return safeFallback;
    }
    return { x, y };
}

module.exports = {
    DEFAULT_MAP,
    DEFAULT_POSITION,
    TILE_SIZE,
    arePlayersCloseEnough,
    buildPositionSnapshot,
    getDirectionFromAction,
    getPlayerDisplayName,
    getPlayerTilePosition,
    getPlayersInMap,
    getTileDistance,
    positionsAreEqual,
    resolveMapName,
    sanitizeSpawnPosition,
    toPublicPlayer
};
