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

function battleMapData(mapName) {
    console.log("toto ?");
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
    console.log('test next map poxX', posX, posY);
    const mapDataRaw = fs.readFileSync('./nextMap.json', 'utf8');
    const mapData = JSON.parse(mapDataRaw);

    // Chercher la carte actuelle dans les données
    for (let map of mapData.maps) {
        if (map.mapName === currentMap) {
            for (let change of map.mapchange) {
                if (change.valX !== null && change.valX === posX) {
                    // Si valX est défini et correspond à posX
                    return {
                        nextMap: change.goto,
                        nextX: change.nexX || posX,
                        nextY: change.nexY || posY * 16 * 2
                    };
                } else if (change.valY !== null && change.valY === posY) {
                    // Si valY est défini et correspond à posY
                    console.log(posX);
                    return {
                        nextMap: change.goto,
                        nextX: change.nexX || posX * 16 * 2,
                        nextY: change.nexY || posY
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
    battleMapData
};
