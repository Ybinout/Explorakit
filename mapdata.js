// mapManager.js

const fs = require('fs');

function loadCollisionData(mapName) {
    let rawData = fs.readFileSync(`./map/${mapName}.json`);
    let mapData = JSON.parse(rawData);
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


function changeMapData(mapName) {
    let rawData = fs.readFileSync(`./map/${mapName}.json`);
    let mapData = JSON.parse(rawData);
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
    return collisionData2D;
}


function InteractMapData(mapName) {
    try {
        let rawData = fs.readFileSync(`./map/${mapName}.json`);
        let mapData = JSON.parse(rawData);
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


function battleMapData(mapName) {
    let rawData = fs.readFileSync(`./map/${mapName}.json`);
    let mapData = JSON.parse(rawData);
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



function getNextMap(currentMap, posX, posY) {
    // Lire le fichier
    const mapDataRaw = fs.readFileSync('./source_Json/nextMap.json', 'utf8');
    const mapData = JSON.parse(mapDataRaw);

    // Chercher la carte actuelle dans les données
    for (let map of mapData.maps) {
        if (map.mapName === currentMap) {
            for (let change of map.mapchange) {
                if (change.valX !== null && change.valX === posX) {
                    // Si valX est défini et correspond à posX
                    return {
                        nextMap: change.goto,
                        nextX: change.nexX + 16 || posX + 16,
                        nextY: change.nexY - 16 || posY * 16 * 2 - 16
                    };
                } else if (change.valY !== null && change.valY === posY) {
                    // Si valY est défini et correspond à posY
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


module.exports = {
    loadCollisionData,
    changeMapData,
    getNextMap,
    battleMapData,
    InteractMapData
};
