// A secondary type must also be unlocked: an early dual type cannot bypass progression.
const dex = require('../../../data/game/pokedex.json');
const { isLegendary } = require('./legendaryEncounters');
const TYPE_STAGES = Object.freeze([
  Object.freeze(['Normal', 'Grass', 'Bug', 'Poison', 'Flying', 'Fighting', 'Water']),
  Object.freeze(['Fire', 'Electric', 'Ground', 'Rock', 'Psychic']),
  Object.freeze(['Ice', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy'])
]);
const SPECIES = Object.freeze(dex.filter(p => p.id <= 493 && !isLegendary(p.id)));
const TYPES = TYPE_STAGES.map((_, column) => new Set(TYPE_STAGES.slice(0, column + 1).flat()));
const eligible = column => SPECIES.filter(p => p.type.every(type => TYPES[column].has(type)));
const LAND = Object.freeze(TYPES.map((_, column) => Object.freeze(eligible(column).filter(p => !p.type.includes('Water')).map(p => p.id))));
const WATER = Object.freeze(TYPES.map((_, column) => Object.freeze(eligible(column).filter(p => p.type.includes('Water')).map(p => p.id))));
function landPool(map) {
  const n = Number(String(map).slice(6)) - 1, column = n % 3, row = Math.floor(n / 3);
  if (!/^jungle[1-9]$/.test(String(map))) return [];
  // The eastern column opens the whole catalogue; earlier rows keep different habitats.
  return column === 2 ? [...LAND[column]] : LAND[column].filter((_, index) => index % 3 !== row);
}
module.exports = { TYPE_STAGES, SPECIES, LAND, WATER, landPool };
