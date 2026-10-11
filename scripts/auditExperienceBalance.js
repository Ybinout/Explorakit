const balance = require('../data/game/experience_balance.json');
const maps = require('../data/game/nextMap.json').maps;
const catalog = require('../data/game/progression.json');
const dialogues = require('../data/game/interact.json');
const { battleMapData } = require('../server/game/world/mapRepository');
const { getPnjTeam } = require('../server/game/world/pnjTeamFactory');
const { calculateBattleExperience, getTotalExperienceForLevel } = require('../server/game/models/progression');

const zones = balance.chapterPath
    .map((name) => maps.find((entry) => entry.mapName === name))
    .filter((entry) => battleMapData(entry.mapName).flat().some(Boolean))
    .map((entry) => ({
        map: entry.mapName,
        levels: [entry.level.min, entry.level.max],
        xpAtSameLevelK1: [entry.level.min, entry.level.max].map((level) =>
            calculateBattleExperience({ level, k: 1 }, balance.multipliers.wild, { level }))
    }));
const arenas = Object.entries(catalog.npcBattles)
    .filter(([, definition]) => definition.experienceKind === 'arena')
    .map(([name]) => {
        const teamName = dialogues.find((entry) => entry.name === name).team;
        const team = getPnjTeam(teamName).pokemons;
        const referenceLevel = Math.max(...team.map((pokemon) => pokemon.level));
        return {
            battle: name,
            levels: team.map((pokemon) => pokemon.level),
            recipientLevel: referenceLevel,
            totalXpBeforeLevelUps: team.reduce((sum, pokemon) => sum
                + calculateBattleExperience(pokemon, balance.multipliers.arena, { level: referenceLevel }), 0)
        };
    });
console.log(JSON.stringify({
    multipliers: balance.multipliers,
    recipientLevelScaling: balance.levelScaling,
    wildZonesInTravelOrder: zones,
    arenas,
    pacingAtLevel40: {
        standardGrowthLevelCost: getTotalExperienceForLevel(41) - getTotalExperienceForLevel(40),
        xpPerWildK1: calculateBattleExperience({ level: 40, k: 1 }, balance.multipliers.wild, { level: 40 }),
        xpPerTrainerK1: calculateBattleExperience({ level: 40, k: 1 }, balance.multipliers.trainer, { level: 40 }),
        xpPerArenaK1: calculateBattleExperience({ level: 40, k: 1 }, balance.multipliers.arena, { level: 40 })
    }
}, null, 2));
