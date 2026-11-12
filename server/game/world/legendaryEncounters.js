const config = require('../../../data/game/legendary_encounters.json');
const species = Object.freeze([...config.species]);
const ids = new Set(species);
function rollLegendary(random = Math.random,bonuses=null) {
    // First roll the category, then the species. Ordinary pool weights and
    // expedition rarity bonuses must never multiply the legendary chance.
    if (random() >= (bonuses?.legendary===2?2:1) / config.oneIn) return null;
    if(Object.keys(bonuses?.capture||{}).length){const pool=require('../talents/effects').weights(species.map(id=>[id,1]),bonuses);let roll=random()*pool.reduce((s,[,w])=>s+w,0);for(const[id,w]of pool){roll-=w;if(roll<0)return id;}return pool.at(-1)[0];}
    return species[Math.min(species.length - 1, Math.floor(random() * species.length))];
}
module.exports = { rollLegendary, species, oneIn:config.oneIn, isLegendary:id => ids.has(Number(id)) };
