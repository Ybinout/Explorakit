const fs = require('fs');
const path = require('path');
const { GAME_DATA_DIR, MAPS_DIR } = require('../../config/paths');

const NEXT_MAP_PATH = path.join(GAME_DATA_DIR, 'nextMap.json');
const MAP_ALIASES_PATH = path.join(GAME_DATA_DIR, 'mapAliases.json');
const mapCache = new Map();
let nextMapConfig = null;
let mapAliases = null;

function loadMapAliases() {
    if (!mapAliases) {
        const config = JSON.parse(fs.readFileSync(MAP_ALIASES_PATH, 'utf8'));
        mapAliases = config?.aliases && typeof config.aliases === 'object' ? config.aliases : {};
    }
    return mapAliases;
}

function resolveMapSourceName(mapName) {
    const safeMapName = path.basename(String(mapName || ''));
    if (!safeMapName) {
        throw new Error('Nom de carte invalide');
    }

    const sourceName = loadMapAliases()[safeMapName] || safeMapName;
    const safeSourceName = path.basename(String(sourceName || ''));
    if (!safeSourceName) {
        throw new Error('Source de carte invalide');
    }
    return safeSourceName;
}

function readMap(mapName) {
    const safeMapName = resolveMapSourceName(mapName);

    if (!mapCache.has(safeMapName)) {
        mapCache.set(
            safeMapName,
            require('./departmentLayout').project(safeMapName, JSON.parse(fs.readFileSync(path.join(MAPS_DIR, `${safeMapName}.json`), 'utf8')))
        );
    }
    return mapCache.get(safeMapName);
}

function buildCollisionData(mapName) {
    const mapData = readMap(mapName);
    let collLayer = mapData.layers.find(layer => layer.name === 'coll');
    let collisionData1D = collLayer ? collLayer.data : [];
    let width = collLayer.width;
    let height = collLayer.height;
    let collisionData2D = [];

    for (let y = 0; y < height; y++) {
        let row = [];
        for (let x = 0; x < width; x++) {
            row.push(collisionData1D[y * width + x]);
        }
        collisionData2D.push(row);
    }
    return collisionData2D;
}


function buildChangeMapData(mapName) {
    const mapData = readMap(mapName);
    let collLayer = mapData.layers.find(layer => layer.name === 'change');
    let collisionData1D = collLayer ? collLayer.data : [];
    let width = collLayer.width;
    let height = collLayer.height;
    let collisionData2D = [];
    for (let y = 0; y < height; y++) {
        let row = [];
        for (let x = 0; x < width; x++) {
            row.push(collisionData1D[y * width + x]);
        }
        collisionData2D.push(row);
    }
    // Explicit logical doors connect already-painted door tiles without editing
    // the author's terrain, collision data or foreground.
    nextMapConfig ||= JSON.parse(fs.readFileSync(NEXT_MAP_PATH, 'utf8'));
    for (const door of nextMapConfig.maps.find(map => map.mapName === mapName)?.mapchange || []) {
        if (door.logicalDoor && Number.isInteger(door.valX) && Number.isInteger(door.valY)
            && collisionData2D[door.valY]?.[door.valX] === 0) collisionData2D[door.valY][door.valX] = 1;
    }
    return collisionData2D;
}


function buildInteractMapData(mapName) {
    try {
        const mapData = readMap(mapName);
        if (!mapData.layers || !Array.isArray(mapData.layers)) {
            // console.error(`Erreur : Pas de layers trouvés dans ${mapName}.json`);
            return [];
        }
        let collLayer = mapData.layers.find(layer => layer.name === 'int');
        if (!collLayer || !collLayer.data || !Array.isArray(collLayer.data) || !collLayer.width || !collLayer.height) {
            // console.warn(`Avertissement : Pas de couche 'int' valide trouvée dans ${mapName}.json`);
            return [];
        }
        let collisionData1D = collLayer.data;
        let width = collLayer.width;
        let height = collLayer.height;
        let InteractMap = [];
        for (let y = 0; y < height; y++) {
            let row = [];
            for (let x = 0; x < width; x++) {
                row.push(collisionData1D[y * width + x] || 0);
            }
            InteractMap.push(row);
        }
        return InteractMap;
    } catch (error) {
        // console.error(`Erreur lors du chargement de la carte ${mapName}:`, error.message);
        return [];
    }
}


function buildBattleMapData(mapName) {
    const mapData = readMap(mapName);
    let collLayer = mapData.layers.find(layer => layer.name === 'battle');
    let collisionData1D = collLayer ? collLayer.data : [];
    let width = collLayer.width;
    let height = collLayer.height;
    let collisionData2D = [];
    for (let y = 0; y < height; y++) {
        let row = [];
        for (let x = 0; x < width; x++) {
            row.push(collisionData1D[y * width + x]);
        }
        collisionData2D.push(row);
    }
    return collisionData2D;
}



function getSourceNextMap(currentMap, posX, posY) {
    // Lire le fichier
    // console.log('test next map poxX', posX, posY);
    if (!nextMapConfig) {
        nextMapConfig = JSON.parse(fs.readFileSync(NEXT_MAP_PATH, 'utf8'));
    }
    const mapData = nextMapConfig;

    // Chercher la carte actuelle dans les données
    for (let map of mapData.maps) {
        if (map.mapName === currentMap) {
            for (let change of map.mapchange) {
                const hasX = Number.isInteger(change.valX);
                const hasY = Number.isInteger(change.valY);
                const matchesX = !hasX || change.valX === posX;
                const matchesY = !hasY || change.valY === posY;
                if ((hasX || hasY) && matchesX && matchesY) {
                    // Si valX est défini et correspond à posX
                    return {
                        nextMap: change.goto,
                        ...(change.staircase===true ? {staircase:true,triggerOnExit:change.triggerOnExit} : {}),
                        ...(change.blockedMessage ? { blockedMessage: change.blockedMessage } : {}),
                        ...(change.requiresStoryFlag ? { requiresStoryFlag: change.requiresStoryFlag, lockedMessage: change.lockedMessage } : {}),
                        nextX: Number.isFinite(change.nexX) ? change.nexX + 16 : posX * 32 + 16,
                        nextY: Number.isFinite(change.nexY) ? change.nexY - 16 : posY * 32 + 16
                    };
                } else if (!hasX && hasY && change.valY === posY) {
                    // Si valY est défini et correspond à posY
                    // console.log(posX, 'la pos x');
                    return {
                        nextMap: change.goto,
                        nextX: change.nexX + 16 || posX * 16 * 2 + 16,
                        nextY: change.nexY - 16 || posY - 16
                    };
                }
            }
        }
    }
    return null;
}


function getNextMap(currentMap,posX,posY) {
    const layout=require('./departmentLayout');
    const link=getSourceNextMap(currentMap,layout.sourceTile(currentMap,posX),posY);
    if(!link)return null;
    const x=Math.floor(link.nextX/32);
    return {...link,nextX:layout.compactTile(link.nextMap,x)*32+(link.nextX%32)};
}

// Tiled files are already immutable for the lifetime of this process. Cache
// the derived grids too: expeditions read three layers on every walking step.
// Each logical name gets its own transition grid, including alias-specific doors.
function cachedLayer(build) {
    const grids = new Map();
    return mapName => {
        if (!grids.has(mapName)) {
            const grid = build(mapName);
            grids.set(mapName, Object.freeze(grid.map(row => Object.freeze(row))));
        }
        return grids.get(mapName);
    };
}
const loadCollisionData = cachedLayer(buildCollisionData);
const changeMapData = cachedLayer(buildChangeMapData);
const InteractMapData = cachedLayer(buildInteractMapData);
const battleMapData = cachedLayer(buildBattleMapData);

module.exports = {
    readMap,
    loadCollisionData,
    changeMapData,
    getNextMap,
    battleMapData,
    InteractMapData,
    resolveMapSourceName
};
