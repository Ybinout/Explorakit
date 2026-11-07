// A secondary type must also be unlocked: an early dual type cannot bypass progression.
const dex = require('../../../data/game/pokedex.json');
const { isLegendary } = require('./legendaryEncounters');
const TYPE_STAGES = Object.freeze([
  Object.freeze(['Normal', 'Grass', 'Bug', 'Poison', 'Flying', 'Fighting', 'Water']),
  Object.freeze(['Fire', 'Electric', 'Ground', 'Rock', 'Psychic']),
  Object.freeze(['Ice', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy'])
]);
// Use the game's real evolution chains, including stones, trades and solo adaptations.
// A Dark encounter must have evolved already and have no further supported evolution.
const evolutionRules = [
  ...require('../../../data/game/evolutions.json').rules,
  ...require('../../../data/game/stone_evolutions.json').rules
];
const evolving = new Set(evolutionRules.map(rule => rule.from));
const evolved = new Set(evolutionRules.map(rule => rule.to));
const SPECIES = Object.freeze(dex.filter(p => p.id <= 493 && !isLegendary(p.id) && evolved.has(p.id) && !evolving.has(p.id)));
const TYPES = TYPE_STAGES.map((_, column) => new Set(TYPE_STAGES.slice(0, column + 1).flat()));
const eligible = column => SPECIES.filter(p => p.type.every(type => TYPES[column].has(type)));
const LAND = Object.freeze(TYPES.map((_, column) => Object.freeze(eligible(column).filter(p => !p.type.includes('Water')).map(p => p.id))));
const WATER = Object.freeze(TYPES.map((_, column) => Object.freeze(eligible(column).filter(p => p.type.includes('Water')).map(p => p.id))));
const JUNGLE4_GHOST_SHARE = .20;
// A haunted pocket in Jungle 4; the rest of the western column keeps its unlocks.
const JUNGLE4_GHOSTS = Object.freeze(SPECIES.filter(p => p.type.includes('Ghost')
  && p.type.every(type => type === 'Ghost' || TYPES[0].has(type))).map(p => p.id));
function encounterRates(map) {
  return map === 'jungle4' ? Object.fromEntries(JUNGLE4_GHOSTS.map(id => [id, 100 * JUNGLE4_GHOST_SHARE / JUNGLE4_GHOSTS.length])) : null;
}
function landPool(map) {
  const n = Number(String(map).slice(6)) - 1, column = n % 3, row = Math.floor(n / 3);
  if (!/^jungle[1-9]$/.test(String(map))) return [];
  // The eastern column opens the whole catalogue; earlier rows keep different habitats.
  const ordinary = column === 2 ? [...LAND[column]] : LAND[column].filter((_, index) => index % 3 !== row);
  return map === 'jungle4' ? [...ordinary, ...JUNGLE4_GHOSTS] : ordinary;
}
module.exports = { TYPE_STAGES, SPECIES, LAND, WATER, landPool, encounterRates, JUNGLE4_GHOSTS, JUNGLE4_GHOST_SHARE };
