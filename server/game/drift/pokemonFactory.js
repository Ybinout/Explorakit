const { generationStandard } = require('../battle/twoTurnMoves');
const Pokemon = require('../models/Pokemon');
const dex = require('../../../data/game/pokedex.json');
const moves = require('../../../data/game/moves.json');
const pools = require('../../../data/game/pokemonData.json');
const { getExperienceRate, getTotalExperienceForLevel } = require('../models/progression');
const { maps } = require('../../../data/game/nextMap.json');
const { value } = require('./driftEffects');
const encounterRarity = require('../../../data/game/drift_encounters.json');
// Explicit base species with both front and back sprites shipped by this client.
const STARTERS = [1,4,7,10,13,16,19,32,43,60,66,69,74,92,152,155,158,161,163,165,167,179,187,191,252,255,258,261,263,265,270,273,276,280,283,285,287,293,304,387,390,393,396,399,401,403,406,418,420];
const legendary = new Set([144,145,146,150,151,243,244,245,249,250,251,377,378,379,380,381,382,383,384,385,386,480,481,482,483,484,485,486,487,488,489,490,491,492,493,494,638,639,640,641,642,643,644,645,646,647,648,649,716,717,718,719,720,721,772,773,785,786,787,788,789,790,791,792,793,794,795,796,797,798,799,800,801,802,803,804,805,806,807,808,809]);
function create(id, level = 5, balanced = false, random = Math.random, minimumIv = 0) {
    const species = dex.find(p => p.id === id);
    // Trainer fixtures keep their calibrated baseline; player starters roll once.
    const traits = balanced ? { iv: { attack: 15, defense: 15, hp: 15, specialAttack: 15, specialDefense: 15, speed: 15 }, nature: 'Bashful', k: 2 } : Pokemon.randomTraits(random, minimumIv);
    const p = new Pokemon(id, species.name.french || species.name.english, level, getTotalExperienceForLevel(level, getExperienceRate(species.exp)),
        traits.iv, traits.nature, traits.k);
    p.stoneEvolutions = true;
    p.gender = require('../items/stoneEvolution').gender(p);
    const slugs = new Set(pools[id] || []);
    const possible = moves.filter(m => slugs.has(m.ename.toLowerCase().replace(/[^a-z0-9]+/g, '-')) && m.power > 0 && m.power <= Math.min(100, 45 + level) && generationStandard(m));
    possible.sort((a,b) => Number(species.type.includes(b.type)) - Number(species.type.includes(a.type)) || b.power - a.power);
    const chosen = possible.slice(0, 3).map(m => m.ename);
    if (!chosen.length) chosen.push('Tackle');
    for (const name of chosen) p.addAbility(name);
    p.addAbility('Growl');
    return p;
}
function starterChoices(random = Math.random, minimumIv = 0) {
    const pool=[...STARTERS], choices=[];
    for(let i=0;i<3;i++) { const index=Math.min(pool.length-1,Math.floor(random()*pool.length)); choices.push(create(pool.splice(index,1)[0],5,false,random,minimumIv)); }
    return choices;
}
function starter(random = Math.random, minimumIv = 0) { return create(STARTERS[Math.min(STARTERS.length-1,Math.floor(random() * STARTERS.length))], 5, false, random, minimumIv); }
function wild(map, player, random = Math.random) {
    const zone = maps.find(m => m.mapName === map);
    const ids = zone?.wildpokemon?.filter(id => !legendary.has(id) && dex.some(p => p.id === id));
    if (!ids?.length) return null;
    const weights = ids.map(id => encounterRarity.rareSpecies.includes(id)
        ? encounterRarity.rareWeight * (1 + value(player, 54) / 100) : encounterRarity.commonWeight);
    let draw = random() * weights.reduce((s,n)=>s+n,0), index = 0;
    for (; index < weights.length - 1; index++) { draw -= weights[index]; if (draw < 0) break; }
    const opening = require('./openingBalance');
    const bounds = opening.levels[map] || zone.level;
    const min = bounds?.min || 5, max = bounds?.max || min;
    return opening.tuneWildMoves(create(ids[index], min + Math.floor(random() * (max - min + 1))));
}
module.exports = { STARTERS, legendary, create, starter, starterChoices, wild };
