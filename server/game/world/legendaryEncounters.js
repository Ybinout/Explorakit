const config = require('../../../data/game/legendary_encounters.json');
const species = Object.freeze([...config.species]);
const ids = new Set(species);
function rollLegendary(random = Math.random) {
    // First roll the category, then the species. Ordinary pool weights and
    // expedition rarity bonuses must never multiply the legendary chance.
    if (random() >= 1 / config.oneIn) return null;
    return species[Math.min(species.length - 1, Math.floor(random() * species.length))];
}
module.exports = { rollLegendary, species, oneIn:config.oneIn, isLegendary:id => ids.has(Number(id)) };
