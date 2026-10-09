const fs = require('fs').promises;
const path = require('node:path');
const Pokemon = require('../models/Pokemon');

const GAME_DATA_DIR = path.resolve(__dirname, '..', '..', '..', 'data', 'game');
const MAP_CONFIG_PATH = path.join(GAME_DATA_DIR, 'nextMap.json');
const MOVES_PATH = path.join(GAME_DATA_DIR, 'moves.json');
const POKEMON_MOVE_POOL_PATH = path.join(GAME_DATA_DIR, 'pokemonData.json');

const LEGACY_WILD_EXPERIENCE = 505000;
const DEFAULT_FALLBACK_MOVE = 'Pound';

const MOVE_SLUG_ALIASES = {
    'vice-grip': 'vise-grip',
    'hi-jump-kick': 'high-jump-kick',
    'smelling-salts': 'smelling-salt'
};

let moveResourcesPromise = null;

function chooseRandomItem(items) {
    if (!Array.isArray(items) || items.length === 0) {
        return null;
    }
    const randomIndex = Math.floor(Math.random() * items.length);
    return items[randomIndex];
}

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

function chooseLevelForZone(mapConfig) {
    if (!mapConfig || typeof mapConfig !== 'object') {
        return null;
    }

    const configuredLevel = mapConfig.level ?? mapConfig.wildLevel ?? null;
    const levelRange = normalizeLevelRange(configuredLevel);
    if (!levelRange) return null;
    if (levelRange.min === levelRange.max) return levelRange.min;
    return Math.floor(Math.random() * (levelRange.max - levelRange.min + 1)) + levelRange.min;
}

function moveNameToSlug(moveName) {
    return String(moveName || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function resolveMoveFromSlug(moveSlug, moveBySlug) {
    const normalizedSlug = moveNameToSlug(moveSlug);
    if (!normalizedSlug) return null;

    const directMove = moveBySlug.get(normalizedSlug);
    if (directMove) return directMove;

    const aliasedSlug = MOVE_SLUG_ALIASES[normalizedSlug];
    if (!aliasedSlug) return null;
    return moveBySlug.get(aliasedSlug) || null;
}

async function loadMoveResources() {
    if (!moveResourcesPromise) {
        moveResourcesPromise = Promise.all([
            fs.readFile(MOVES_PATH, 'utf8'),
            fs.readFile(POKEMON_MOVE_POOL_PATH, 'utf8')
        ])
            .then(([movesRaw, movePoolRaw]) => {
                const movesData = JSON.parse(movesRaw);
                const pokemonMovePools = JSON.parse(movePoolRaw);
                const moveBySlug = new Map();

                for (const move of movesData) {
                    if (!move || typeof move.ename !== 'string') continue;
                    const moveSlug = moveNameToSlug(move.ename);
                    if (!moveSlug || moveBySlug.has(moveSlug)) continue;
                    moveBySlug.set(moveSlug, move);
                }

                return { moveBySlug, pokemonMovePools };
            })
            .catch((error) => {
                moveResourcesPromise = null;
                throw error;
            });
    }

    return moveResourcesPromise;
}

function isDamagingMove(move) {
    if (!move || typeof move !== 'object') return false;
    const power = Number(move.power) || 0;
    const damageClass = move?.combat?.damage_class
        || (move.category === 'phy' ? 'physical' : move.category === 'spe' ? 'special' : 'status');
    return power > 0 && (damageClass === 'physical' || damageClass === 'special');
}

function getPowerCapForLevel(level) {
    const safeLevel = sanitizeLevel(level) || 1;
    return Math.max(40, Math.floor(35 + safeLevel * 1.5));
}

function scoreMoveForLevel(move, pokemonTypes, powerCap) {
    const power = Number(move.power) || 0;
    const accuracy = Number(move.accuracy);
    const priority = Number(move?.combat?.priority || 0);
    const stabBonus = pokemonTypes.has(move.type) ? 22 : 0;
    const accuracyBonus = Number.isFinite(accuracy) && accuracy > 0 ? accuracy / 18 : 3;
    const priorityBonus = priority * 6;
    const overCapPenalty = power > powerCap ? (power - powerCap) * 1.4 : 0;

    return power + stabBonus + accuracyBonus + priorityBonus - overCapPenalty;
}

function pickAutomaticMoveNames(pokemon, movePool) {
    const pokemonTypes = new Set(Array.isArray(pokemon?.data?.type)
        ? pokemon.data.type.filter(Boolean)
        : [pokemon?.type1, pokemon?.type2].filter(Boolean));
    const powerCap = getPowerCapForLevel(pokemon?.level);
    const damagingMoves = movePool.filter(isDamagingMove);

    let candidateMoves = damagingMoves.filter((move) => (Number(move.power) || 0) <= powerCap);

    if (candidateMoves.length < 4) {
        const expandedCap = powerCap + 35;
        const expandedCandidates = damagingMoves.filter((move) => (Number(move.power) || 0) <= expandedCap);
        if (expandedCandidates.length > candidateMoves.length) {
            candidateMoves = expandedCandidates;
        }
    }

    if (candidateMoves.length === 0) {
        candidateMoves = damagingMoves;
    }

    const scoredCandidates = candidateMoves
        .map((move) => ({
            move,
            score: scoreMoveForLevel(move, pokemonTypes, powerCap)
        }))
        .sort((left, right) => right.score - left.score);

    const selectedMoves = [];

    const addMove = (move) => {
        if (!move || typeof move.ename !== 'string') return;
        if (selectedMoves.includes(move.ename)) return;
        selectedMoves.push(move.ename);
    };

    addMove(scoredCandidates.find(({ move }) => pokemonTypes.has(move.type))?.move);

    for (const { move } of scoredCandidates) {
        if (selectedMoves.length >= 4) break;
        addMove(move);
    }

    if (selectedMoves.length < 4) {
        const statusMoves = movePool
            .filter((move) => !isDamagingMove(move))
            .sort((left, right) => {
                const leftAccuracy = Number(left?.accuracy);
                const rightAccuracy = Number(right?.accuracy);
                const normalizedLeftAccuracy = Number.isFinite(leftAccuracy) ? leftAccuracy : 100;
                const normalizedRightAccuracy = Number.isFinite(rightAccuracy) ? rightAccuracy : 100;
                const leftStab = pokemonTypes.has(left?.type) ? 1 : 0;
                const rightStab = pokemonTypes.has(right?.type) ? 1 : 0;
                if (rightStab !== leftStab) return rightStab - leftStab;
                return normalizedRightAccuracy - normalizedLeftAccuracy;
            });

        for (const move of statusMoves) {
            if (selectedMoves.length >= 4) break;
            addMove(move);
        }
    }

    if (selectedMoves.length === 0) {
        selectedMoves.push(DEFAULT_FALLBACK_MOVE);
    }

    while (selectedMoves.length < 4) {
        selectedMoves.push(selectedMoves[selectedMoves.length - 1] || DEFAULT_FALLBACK_MOVE);
    }

    return selectedMoves.slice(0, 4);
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
    const { moveBySlug, pokemonMovePools } = await loadMoveResources();
    const pokemonMoveSlugs = Array.isArray(pokemonMovePools?.[String(pokemon.data.id)])
        ? pokemonMovePools[String(pokemon.data.id)]
        : [];

    const movePool = [];
    const seenMoveNames = new Set();

    for (const moveSlug of pokemonMoveSlugs) {
        const resolvedMove = resolveMoveFromSlug(moveSlug, moveBySlug);
        if (!resolvedMove || seenMoveNames.has(resolvedMove.ename)) continue;
        seenMoveNames.add(resolvedMove.ename);
        movePool.push(resolvedMove);
    }

    const automaticMoveNames = pickAutomaticMoveNames(pokemon, movePool);
    pokemon.abilities = [];
    automaticMoveNames.forEach((moveName) => pokemon.addAbility(moveName));
}

function chooseWildPokemonForMap(mapName, mapData) {
    const mapConfig = mapData.maps.find((map) => map.mapName === mapName);
    if (!mapConfig) {
        console.error(`La carte ${mapName} n'existe pas.`);
        return null;
    }

    const pokemonId = chooseRandomItem(mapConfig.wildpokemon);
    if (pokemonId === null) {
        return null;
    }

    return {
        pokemonId,
        mapConfig
    };
}

async function CreatePokemon(mapName) {
    try {
        const rawMapData = await fs.readFile(MAP_CONFIG_PATH, 'utf8');
        const mapData = JSON.parse(rawMapData);
        const wildSelection = chooseWildPokemonForMap(mapName, mapData);

        if (!wildSelection) {
            return null;
        }

        const poke = new Pokemon(wildSelection.pokemonId, 'test', 0, 0, null, 'Timid', null);
        const zoneLevel = chooseLevelForZone(wildSelection.mapConfig);

        if (zoneLevel !== null) {
            applyTargetLevel(poke, zoneLevel);
        } else {
            applyLegacyLevelCurve(poke);
        }

        await assignAutomaticMoves(poke);
        return poke;
    } catch (error) {
        console.error(error);
        throw error;
    }
}

module.exports = CreatePokemon;
