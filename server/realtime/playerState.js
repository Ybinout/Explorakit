const { loadCollisionData } = require('../game/world/mapRepository');
const {worldRoom,sameWorld}=require('./worldRooms');

const { remainingRepel } = require('../game/items/repel');

const DEFAULT_MAP = 'start';
const DEFAULT_POSITION = Object.freeze({ x: 80, y: 208 });
const TILE_SIZE = 32;

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
        && sameWorld(playerA,playerB)
        && getTileDistance(playerA, playerB) <= 1);
}

function getDirectionFromAction(action) {
    return { move_z: 'up', move_q: 'left', move_s: 'down', move_d: 'right' }[action] || null;
}

function buildPositionSnapshot(player) {
    return {
        x: Math.round(player.x), y: Math.round(player.y), map: player.currentmap,
        repelSteps: remainingRepel(player),
        centerReturnPoint: player.centerReturnPoint ? { ...player.centerReturnPoint } : null
    };
}

function positionsAreEqual(posA, posB) {
    const a = posA?.centerReturnPoint, b = posB?.centerReturnPoint;
    return Boolean(posA && posB && posA.x === posB.x && posA.y === posB.y && posA.map === posB.map
        && remainingRepel(posA) === remainingRepel(posB)
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
        spritePalette: require('../game/world/trainerPalette').normalizeTrainerPalette(player.spritePalette),
        direction: player.direction,
        isMoving: Boolean(player.isMoving),
        animationFrame: Number(player.animationFrame) || 0,
        currentmap: player.currentmap,
        regionLocation: require('../game/world/regionMap').regionLocation(player.housingEntryMap || player.currentmap, player.centerReturnPoint),
        ...(player.housingOwnerId ? {housingOwnerId:player.housingOwnerId,housingFloor:player.housingFloor} : {}),
        speedModuleActive: Boolean(player.speedModuleActive),
        ...(player.housingPose ? {housingPose:player.housingPose} : {}),
        inbattle: Boolean(player.inbattle)
    };
}

function getPlayersInMap(players, mapName, viewer) {
    return Object.fromEntries(
        Object.entries(players)
            .filter(([, player]) => player.currentmap === mapName
                && (mapName!=='super_tournament_room'&&!require('../game/housing/rules').isMap(mapName)||Boolean(viewer)&&worldRoom(mapName,player)===worldRoom(mapName,viewer)))
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

function sanitizeSpawnPosition(rawX, rawY, collisionData2D, mapName, options) {
    return require('../game/world/safePosition').nearestSafePosition(rawX, rawY, collisionData2D, mapName, options);
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
