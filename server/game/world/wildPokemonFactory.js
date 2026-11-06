const Pokemon = require('../models/Pokemon');
const { rollLegendary } = require('./legendaryEncounters');
const { chooseOrdinarySpecies } = require('./wildEncounterPool');
const darkEncounters=require('./darkEncounters'),darkContinent=require('./darkContinent');

const mapData = require('../../../data/game/nextMap.json');
const LEGACY_WILD_EXPERIENCE = 505000;

function sanitizeLevel(rawLevel) {
    const parsedLevel = Number(rawLevel);
    if (!Number.isFinite(parsedLevel)) return null;
    const normalizedLevel = Math.floor(parsedLevel);
    if (normalizedLevel < 1) return 1;
    return normalizedLevel;
}

function normalizeLevelRange(rawLevel) {
    if (rawLevel === null || rawLevel === undefined) {
        return null;
    }

    if (typeof rawLevel === 'number' || typeof rawLevel === 'string') {
        const fixedLevel = sanitizeLevel(rawLevel);
        if (fixedLevel === null) return null;
        return { min: fixedLevel, max: fixedLevel };
    }

    if (Array.isArray(rawLevel) && rawLevel.length >= 2) {
        const minLevel = sanitizeLevel(rawLevel[0]);
        const maxLevel = sanitizeLevel(rawLevel[1]);
        if (minLevel === null || maxLevel === null) return null;
        return minLevel <= maxLevel
            ? { min: minLevel, max: maxLevel }
            : { min: maxLevel, max: minLevel };
    }

    if (typeof rawLevel === 'object') {
        const minRaw = rawLevel.min ?? rawLevel.from ?? rawLevel.start ?? rawLevel.level;
        const maxRaw = rawLevel.max ?? rawLevel.to ?? rawLevel.end ?? rawLevel.level;
        const minLevel = sanitizeLevel(minRaw);
        const maxLevel = sanitizeLevel(maxRaw);
        if (minLevel === null || maxLevel === null) return null;
        return minLevel <= maxLevel
            ? { min: minLevel, max: maxLevel }
            : { min: maxLevel, max: minLevel };
    }

    return null;
}

function chooseLevelForZone(mapConfig, random = Math.random) {
    if (!mapConfig || typeof mapConfig !== 'object') {
        return null;
    }

    const configuredLevel = mapConfig.level ?? mapConfig.wildLevel ?? null;
    const levelRange = normalizeLevelRange(configuredLevel);
    if (!levelRange) return null;
    if (levelRange.min === levelRange.max) return levelRange.min;
    return Math.floor(random() * (levelRange.max - levelRange.min + 1)) + levelRange.min;
}

function getMinExperienceForLevel(pokemon, level) {
    const safeLevel = sanitizeLevel(level) || 1;
    if (safeLevel <= 1) return 0;
    return pokemon.getNextLevelExpForLevel(safeLevel);
}

function applyTargetLevel(pokemon, targetLevel) {
    pokemon.experience = getMinExperienceForLevel(pokemon, targetLevel);
    pokemon.level = pokemon.calculateLevelFromExperience(pokemon.experience);
    pokemon.recalculateStats();
}

function applyLegacyLevelCurve(pokemon) {
    pokemon.experience = LEGACY_WILD_EXPERIENCE;
    pokemon.level = pokemon.calculateLevelFromExperience(pokemon.experience);
    pokemon.recalculateStats();
}

async function assignAutomaticMoves(pokemon) {
    require('../models/moveLearning').assignNaturalMoves(pokemon);
}

function chooseWildPokemonForMap(mapName, mapData, random = Math.random) {
    const mapConfig = mapData.maps.find((map) => map.mapName === mapName);
    if (!mapConfig) {
        console.error(`La carte ${mapName} n'existe pas.`);
        return null;
    }

    if (!Array.isArray(mapConfig.wildpokemon) || !mapConfig.wildpokemon.length) return null;
    const safari=require('./safari');
    const pokemonId = safari.isMap(mapName)?safari.encounter(mapName,'grass',random):(require('./darkContinent').isMap(mapName)?null:rollLegendary(random)) ?? chooseOrdinarySpecies(mapConfig, random);
    if (pokemonId === null) {
        return null;
    }

    return {
        pokemonId,
        mapConfig
    };
}

async function CreatePokemon(mapName, random = Math.random, { experienceModuleActive = false } = {}) {
    try {
        const wildSelection = chooseWildPokemonForMap(mapName, mapData, random);

        if (!wildSelection) {
            return null;
        }

        const poke = new Pokemon(wildSelection.pokemonId, 'test', 0, 0, null, Pokemon.randomNature(), null);
        const zoneLevel = chooseLevelForZone(wildSelection.mapConfig, random);
        const darkBonus=darkEncounters.prepare(poke,mapName,random);

        if (zoneLevel !== null) {
            applyTargetLevel(poke, Math.min(darkContinent.isMap(mapName)?300:Infinity,require('../items/experienceModule').encounterLevel(zoneLevel,experienceModuleActive&&!darkContinent.isMap(mapName))+darkBonus));
        } else {
            applyLegacyLevelCurve(poke);
            if(experienceModuleActive===true)applyTargetLevel(poke,require('../items/experienceModule').encounterLevel(poke.level,true));
        }

        await assignAutomaticMoves(poke);
        return require('../models/shiny').rollWildShiny(poke);
    } catch (error) {
        console.error(error);
        throw error;
    }
}

CreatePokemon.createAtLevel = async function(id, level, {experienceModuleActive=false,mapName=null,random=Math.random}={}) {
    const dark=darkContinent.isMap(mapName);
    if (!Number.isInteger(id) || !Number.isInteger(level) || level < 1 || level > (dark?Math.max(200,darkContinent.levels(mapName)[1]):100)) throw new Error('Rencontre invalide.');
    const poke = new Pokemon(id, 'test', 0, 0, null, Pokemon.randomNature(), null);
    const darkBonus=darkEncounters.prepare(poke,mapName,random);
    applyTargetLevel(poke, Math.min(dark?300:Infinity,require('../items/experienceModule').encounterLevel(level,experienceModuleActive&&!dark)+darkBonus));
    await assignAutomaticMoves(poke);
    return require('../models/shiny').rollWildShiny(poke);
};
module.exports = CreatePokemon;
