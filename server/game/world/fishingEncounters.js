const { maps } = require('../../../data/game/nextMap.json');
const waters = require('../../../data/game/fishing_waters.json').maps;
const profiles = {
    start: [[129,36],[60,22],[118,20],[194,13],[270,8],[349,1]],
    ville1: [[129,22],[118,22],[60,18],[223,16],[339,13],[456,8],[349,1]],
    route3: [[129,20],[341,22],[339,20],[194,16],[223,12],[118,9],[349,1]],
    ville_safe1: [[129,16],[341,18],[340,18],[118,14],[61,14],[224,10],[130,9],[349,1]],
    gen_ville5: [[129,16],[342,18],[119,18],[194,14],[340,14],[457,10],[130,9],[349,1]],
    ville3: [[129,12],[119,18],[61,18],[224,16],[457,14],[342,12],[130,9],[349,1]]
};
function fishingEncounter(mapName, random = Math.random) {
    if (!Object.hasOwn(waters,mapName)) return null;
    const pool=profiles[mapName], zone=maps.find(m=>m.mapName===mapName)?.level || {min:5,max:7};
    let roll=random()*100, id=pool[pool.length-1][0];
    for (const [species,weight] of pool) { roll-=weight; if (roll<0) { id=species;break; } }
    return { id, level:Math.min(zone.max,zone.min+Math.floor(random()*(zone.max-zone.min+1))) };
}
module.exports = { fishingEncounter, profiles };
