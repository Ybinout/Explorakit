const { maps } = require('../../../data/game/nextMap.json');
const waters = require('../../../data/game/fishing_waters.json').maps;
const { rollLegendary } = require('./legendaryEncounters');
const profiles = {
    start: [[129,24],[60,16],[118,14],[194,10],[270,7],[54,8],[258,5],[418,8],[422,7],[349,1]],
    ville1: [[129,14],[118,12],[60,10],[223,10],[339,10],[456,8],[72,6],[79,6],[98,6],[116,6],[120,5],[170,6],[349,1]],
    route3: [[129,14],[341,14],[339,13],[194,12],[223,10],[118,8],[90,8],[211,6],[318,7],[278,7],[349,1]],
    ville_safe1: [[129,10],[341,12],[340,12],[118,9],[61,9],[224,8],[130,5],[222,8],[320,8],[366,10],[370,8],[349,1]],
    gen_ville5: [[129,12],[342,14],[119,14],[194,10],[340,10],[457,9],[130,6],[86,12],[458,12],[349,1]],
    ville3: [[129,10],[119,14],[61,14],[224,12],[457,12],[342,10],[130,7],[131,10],[369,10],[349,1]]
};
function fishingEncounter(mapName, random = Math.random) {
    if (!Object.hasOwn(waters,mapName)) return null;
    const pool=profiles[mapName], zone=maps.find(m=>m.mapName===mapName)?.level || {min:5,max:7};
    let id=rollLegendary(random);
    if(id===null){
        let roll=random()*100;id=pool[pool.length-1][0];
        for (const [species,weight] of pool) { roll-=weight; if (roll<0) { id=species;break; } }
    }
    return { id, level:Math.min(zone.max,zone.min+Math.floor(random()*(zone.max-zone.min+1))) };
}
module.exports = { fishingEncounter, profiles };
