const moveFlagData = require('../../../data/game/move_ability_flags.gen7.json');

const MOLD_BREAKER_ABILITIES = new Set(['Mold Breaker', 'Teravolt', 'Turboblaze']);
const STAT_DROP_IMMUNITIES = new Set(['Clear Body', 'Full Metal Body', 'White Smoke']);
const CRITICAL_IMMUNITIES = new Set(['Battle Armor', 'Shell Armor']);
const WEATHER_SUPPRESSORS = new Set(['Air Lock', 'Cloud Nine']);
const UNBREAKABLE_ABILITIES = new Set(['Full Metal Body', 'Prism Armor', 'Shadow Shield']);

const FAMILY_ABILITIES = Object.freeze({
    immunity_absorption: Object.freeze([
        'Battle Armor', 'Big Pecks', 'Bulletproof', 'Clear Body', 'Comatose', 'Damp', 'Dazzling',
        'Dry Skin', 'Flash Fire', 'Flower Veil', 'Full Metal Body', 'Hyper Cutter',
        'Immunity', 'Insomnia', 'Keen Eye', 'Leaf Guard', 'Levitate', 'Lightning Rod',
        'Limber', 'Magic Guard', 'Magma Armor', 'Motor Drive', 'Oblivious', 'Overcoat',
        'Own Tempo', 'Queenly Majesty', 'Rock Head', 'Sap Sipper', 'Shell Armor',
        'Soundproof', 'Storm Drain', 'Sturdy', 'Suction Cups', 'Sweet Veil', 'Telepathy',
        'Vital Spirit', 'Volt Absorb', 'Water Absorb', 'Water Bubble', 'Water Veil',
        'White Smoke', 'Wonder Guard'
    ]),
    switch_entry: Object.freeze([
        'Anticipation', 'Download', 'Drizzle', 'Drought', 'Electric Surge', 'Forewarn',
        'Frisk', 'Grassy Surge', 'Imposter', 'Intimidate', 'Misty Surge', 'Natural Cure',
        'Psychic Surge', 'Regenerator', 'Sand Stream', 'Snow Warning', 'Trace'
    ]),
    damage_stats: Object.freeze([
        'Adaptability', 'Analytic', 'Battle Armor', 'Blaze', 'Compound Eyes', 'Defeatist',
        'Filter', 'Flare Boost', 'Fluffy', 'Fur Coat', 'Gale Wings', 'Guts', 'Heatproof',
        'Huge Power', 'Hustle', 'Iron Fist', 'Marvel Scale', 'Mega Launcher', 'Merciless',
        'Liquid Voice', 'Mold Breaker', 'Multiscale', 'No Guard', 'Normalize', 'Overgrow', 'Pixilate',
        'Prankster', 'Prism Armor', 'Protean', 'Pure Power', 'Reckless', 'Refrigerate',
        'Rock Head', 'Sand Force', 'Shadow Shield', 'Sheer Force', 'Shell Armor', 'Sniper',
        'Solid Rock', 'Steelworker', 'Strong Jaw', 'Super Luck', 'Swarm', 'Technician',
        'Teravolt', 'Thick Fat', 'Tinted Lens', 'Torrent', 'Tough Claws', 'Toxic Boost',
        'Triage', 'Turboblaze', 'Victory Star', 'Water Bubble', 'Wonder Skin'
    ]),
    weather_terrain: Object.freeze([
        'Air Lock', 'Chlorophyll', 'Cloud Nine', 'Drizzle', 'Drought', 'Dry Skin',
        'Electric Surge', 'Flower Gift', 'Forecast', 'Grass Pelt', 'Grassy Surge',
        'Hydration', 'Ice Body', 'Leaf Guard', 'Misty Surge', 'Psychic Surge', 'Rain Dish',
        'Sand Force', 'Sand Rush', 'Sand Stream', 'Sand Veil', 'Slush Rush', 'Snow Cloak',
        'Snow Warning', 'Solar Power', 'Swift Swim'
    ])
});

const SUPPORTED_ABILITIES = new Set(Object.values(FAMILY_ABILITIES).flat());

const TYPE_ABSORPTIONS = Object.freeze({
    'Dry Skin': { type: 'Water', healFraction: 0.25 },
    'Flash Fire': { type: 'Fire', flag: 'flashFireBoost' },
    'Lightning Rod': { type: 'Electric', stat: 'specialAttack', stages: 1 },
    'Motor Drive': { type: 'Electric', stat: 'speed', stages: 1 },
    'Sap Sipper': { type: 'Grass', stat: 'attack', stages: 1 },
    'Storm Drain': { type: 'Water', stat: 'specialAttack', stages: 1 },
    'Volt Absorb': { type: 'Electric', healFraction: 0.25 },
    'Water Absorb': { type: 'Water', healFraction: 0.25 }
});

const SOUND_MOVES = new Set(Object.entries(moveFlagData.moves)
    .filter(([, flags]) => flags.sound)
    .map(([name]) => name));
const BULLET_MOVES = new Set(Object.entries(moveFlagData.moves)
    .filter(([, flags]) => flags.bullet)
    .map(([name]) => name));
const EXPLOSIVE_MOVES = new Set(['Explosion', 'Mind Blown', 'Self-Destruct']);

function safeNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function getAbilityName(pokemon) {
    if (!pokemon || pokemon.__battle?.abilitySuppressed) return null;
    return typeof pokemon.passiveAbility === 'string' && pokemon.passiveAbility.trim()
        ? pokemon.passiveAbility.trim()
        : null;
}

function hasAbility(pokemon, abilityName) {
    return String(getAbilityName(pokemon) || '').toLowerCase() === String(abilityName || '').toLowerCase();
}

function ignoresDefenderAbility(attacker, defender = null) {
    if (defender && UNBREAKABLE_ABILITIES.has(getAbilityName(defender))) return false;
    return MOLD_BREAKER_ABILITIES.has(getAbilityName(attacker));
}

function getMoveFlags(move) {
    return moveFlagData.moves[move?.ename] || {};
}

function isWeatherSuppressed(...pokemons) {
    return pokemons.some((pokemon) => pokemon?.currentHp > 0 && WEATHER_SUPPRESSORS.has(getAbilityName(pokemon)));
}

function canAbilityBlockStatus(target, status, battleState) {
    const ability = getAbilityName(target);
    if (!ability) return false;
    if (ability === 'Comatose') return true;
    if (status === 'sleep' && ['Insomnia', 'Vital Spirit', 'Sweet Veil'].includes(ability)) return true;
    if (status === 'paralyze' && ability === 'Limber') return true;
    if (['poison', 'badly_poison'].includes(status) && ability === 'Immunity') return true;
    if (status === 'burn' && ['Water Veil', 'Water Bubble'].includes(ability)) return true;
    if (status === 'freeze' && ability === 'Magma Armor') return true;
    if (status === 'confusion' && ability === 'Own Tempo') return true;
    if (status === 'infatuation' && ability === 'Oblivious') return true;
    if (status === 'infatuation' && ability === 'Aroma Veil') return true;
    if (ability === 'Leaf Guard' && battleState?.weather?.kind === 'sun') return true;
    if (ability === 'Flower Veil' && [target.type1, target.type2].includes('Grass')) return true;
    return false;
}

function blocksStatDrop(target, stat, stages, source = null) {
    if (safeNumber(stages, 0) >= 0 || target === source) return false;
    const ability = getAbilityName(target);
    if (STAT_DROP_IMMUNITIES.has(ability)) return true;
    if (ability === 'Hyper Cutter' && stat === 'attack') return true;
    if (ability === 'Big Pecks' && stat === 'defense') return true;
    if (ability === 'Keen Eye' && stat === 'accuracy') return true;
    if (ability === 'Flower Veil' && [target.type1, target.type2].includes('Grass')) return true;
    return false;
}

function blocksForcedSwitch(target, attacker) {
    return !ignoresDefenderAbility(attacker, target) && hasAbility(target, 'Suction Cups');
}

function transformMoveForAbility(attacker, move) {
    const ability = getAbilityName(attacker);
    const flags = getMoveFlags(move);
    let resolvedMove = move;
    let powerMultiplier = 1;

    if (ability === 'Normalize') {
        resolvedMove = { ...resolvedMove, type: 'Normal' };
        powerMultiplier *= 1.2;
    } else if (ability === 'Pixilate' && resolvedMove.type === 'Normal') {
        resolvedMove = { ...resolvedMove, type: 'Fairy' };
        powerMultiplier *= 1.2;
    } else if (ability === 'Refrigerate' && resolvedMove.type === 'Normal') {
        resolvedMove = { ...resolvedMove, type: 'Ice' };
        powerMultiplier *= 1.2;
    } else if (ability === 'Liquid Voice' && flags.sound) {
        resolvedMove = { ...resolvedMove, type: 'Water' };
    }

    if (ability === 'Protean' && resolvedMove.type) {
        if (!attacker.__battle) attacker.__battle = {};
        attacker.__battle.tempTypes = [resolvedMove.type];
    }

    return { move: resolvedMove, powerMultiplier };
}

function resolveMoveAbilityImmunity(context) {
    const {
        attacker, defender, move, battleState, movePriority = 0,
        effectiveness = 1, isAllyHit = false, heal, changeStage, messages = []
    } = context;
    if (!defender) return false;

    const ability = ignoresDefenderAbility(attacker,defender) ? null : getAbilityName(defender);
    const flags = getMoveFlags(move);
    let reason = null;

    if (ability === 'Levitate' && move.type === 'Ground' && !(battleState?.field?.gravityTurns > 0)
        && !(defender.__battle?.ingrain || defender.__battle?.grounded)) reason = 'Levitate';
    if (ability === 'Soundproof' && SOUND_MOVES.has(move.ename)) reason = 'Soundproof';
    if (ability === 'Bulletproof' && BULLET_MOVES.has(move.ename)) reason = 'Bulletproof';
    if ((ability === 'Damp' || hasAbility(attacker, 'Damp')) && EXPLOSIVE_MOVES.has(move.ename)) reason = 'Damp';
    if (ability === 'Overcoat' && flags.powder) reason = 'Overcoat';
    if (['Dazzling', 'Queenly Majesty'].includes(ability) && movePriority > 0) reason = ability;
    if (ability === 'Telepathy' && isAllyHit && move?.combat?.damage_class !== 'status') reason = 'Telepathy';
    if (ability === 'Wonder Guard' && move?.combat?.damage_class !== 'status' && effectiveness <= 1) reason = 'Wonder Guard';
    const defenderFlying = [defender.type1, defender.type2].includes('Flying') || hasAbility(defender, 'Levitate');
    if (battleState?.terrain?.kind === 'psychic_terrain' && movePriority > 0
        && (!defenderFlying || battleState?.field?.gravityTurns > 0)) reason = 'Psychic Terrain';
    if (hasAbility(attacker, 'Prankster') && move?.combat?.damage_class === 'status'
        && [defender.type1, defender.type2].includes('Dark')) reason = 'son type Ténèbres';

    const absorption = TYPE_ABSORPTIONS[ability];
    if (!reason && absorption?.type === move.type) {
        reason = ability;
        if (absorption.healFraction && typeof heal === 'function') {
            heal(defender, Math.max(1, Math.floor(safeNumber(defender.maxHp, 1) * absorption.healFraction)));
        }
        if (absorption.stat && typeof changeStage === 'function') {
            changeStage(defender, absorption.stat, absorption.stages, messages, defender);
        }
        if (absorption.flag) {
            if (!defender.__battle) defender.__battle = {};
            defender.__battle[absorption.flag] = true;
        }
    }

    if (!reason) return false;
    messages.push(`${defender.truename || defender.name || 'Pokemon'} est protege par ${reason}.`);
    return true;
}

function getAbilityPriority(pokemon, move) {
    const ability = getAbilityName(pokemon);
    const damageClass = move?.combat?.damage_class || (move?.category === 'sta' ? 'status' : null);
    if (ability === 'Prankster' && damageClass === 'status') return 1;
    if (ability === 'Gale Wings' && move?.type === 'Flying'
        && safeNumber(pokemon.currentHp, 0) >= safeNumber(pokemon.maxHp, 1)) return 1;
    if (ability === 'Triage' && getMoveFlags(move).heal) return 3;
    return 0;
}

function getAbilityAccuracyMultiplier(attacker, defender, move, battleState) {
    if (hasAbility(attacker, 'No Guard') || hasAbility(defender, 'No Guard')) return Infinity;
    let multiplier = 1;
    if (hasAbility(attacker, 'Compound Eyes')) multiplier *= 1.3;
    if (hasAbility(attacker, 'Victory Star')) multiplier *= 1.1;
    if (hasAbility(attacker, 'Hustle') && move?.combat?.damage_class === 'physical') multiplier *= 0.8;
    if (!ignoresDefenderAbility(attacker, defender)) {
        if (!isWeatherSuppressed(attacker, defender) && hasAbility(defender, 'Sand Veil') && battleState?.weather?.kind === 'sandstorm') multiplier *= 0.8;
        if (!isWeatherSuppressed(attacker, defender) && hasAbility(defender, 'Snow Cloak') && battleState?.weather?.kind === 'hail') multiplier *= 0.8;
        if (hasAbility(defender, 'Tangled Feet') && defender.__battle?.confusionTurns > 0) multiplier *= 0.5;
        if (hasAbility(defender, 'Wonder Skin') && move?.combat?.damage_class === 'status') multiplier *= 0.5;
    }
    return multiplier;
}

function getAbilitySpeedMultiplier(pokemon, battleState, opponent = null) {
    const ability = getAbilityName(pokemon);
    const weather = isWeatherSuppressed(pokemon, opponent) ? null : battleState?.weather?.kind;
    if (ability === 'Quick Feet' && pokemon.status && pokemon.status !== 'normal') return 1.5;
    if (ability === 'Unburden' && pokemon.__battle?.unburden && !pokemon.heldItem) return 2;
    if (ability === 'Slow Start' && (pokemon.__battle?.activeTurns || 0) < 5) return 0.5;
    if ((ability === 'Chlorophyll' && weather === 'sun')
        || (ability === 'Swift Swim' && weather === 'rain')
        || (ability === 'Sand Rush' && weather === 'sandstorm')
        || (ability === 'Slush Rush' && weather === 'hail')) return 2;
    return 1;
}

function getAbilityStatMultiplier(pokemon, statName, battleState, opponent = null) {
    const ability = getAbilityName(pokemon);
    const hpRatio = safeNumber(pokemon.currentHp, 0) / Math.max(1, safeNumber(pokemon.maxHp, 1));
    const weather = isWeatherSuppressed(pokemon, opponent) ? null : battleState?.weather?.kind;
    let multiplier = 1;

    if (['attack', 'specialAttack'].includes(statName) && ability === 'Defeatist' && hpRatio <= 0.5) multiplier *= 0.5;
    if (statName === 'attack' && ['Huge Power', 'Pure Power'].includes(ability)) multiplier *= 2;
    if (statName === 'attack' && ability === 'Hustle') multiplier *= 1.5;
    if (statName === 'attack' && ability === 'Slow Start' && (pokemon.__battle?.activeTurns || 0) < 5) multiplier *= 0.5;
    if (statName === 'attack' && ability === 'Guts' && pokemon.status !== 'normal') multiplier *= 1.5;
    if (statName === 'attack' && ability === 'Flower Gift' && weather === 'sun') multiplier *= 1.5;
    if (statName === 'specialAttack' && ability === 'Flare Boost' && pokemon.status === 'burn') multiplier *= 1.5;
    if (statName === 'specialAttack' && ability === 'Solar Power' && weather === 'sun') multiplier *= 1.5;
    if (statName === 'defense' && ability === 'Fur Coat') multiplier *= 2;
    if (statName === 'defense' && ability === 'Marvel Scale' && pokemon.status !== 'normal') multiplier *= 1.5;
    if (statName === 'defense' && ability === 'Grass Pelt' && battleState?.terrain?.kind === 'grassy_terrain') multiplier *= 1.5;
    if (statName === 'specialDefense' && ability === 'Flower Gift' && weather === 'sun') multiplier *= 1.5;
    return multiplier;
}

function getAbilityDamageMultiplier(context) {
    const { attacker, defender, move, effectiveness, battleState, movedLast = false } = context;
    const attackerAbility = getAbilityName(attacker);
    const defenderAbility = ignoresDefenderAbility(attacker, defender) ? null : getAbilityName(defender);
    const flags = getMoveFlags(move);
    const hpRatio = safeNumber(attacker.currentHp, 0) / Math.max(1, safeNumber(attacker.maxHp, 1));
    const defenderHpRatio = safeNumber(defender.currentHp, 0) / Math.max(1, safeNumber(defender.maxHp, 1));
    const weather = isWeatherSuppressed(attacker, defender) ? null : battleState?.weather?.kind;
    let multiplier = safeNumber(context.abilityPowerMultiplier, 1);

    if (attackerAbility === 'Analytic' && movedLast) multiplier *= 1.3;
    if (attackerAbility === 'Technician' && safeNumber(move.power, 0) <= 60) multiplier *= 1.5;
    if (attackerAbility === 'Iron Fist' && flags.punch) multiplier *= 1.2;
    if (attackerAbility === 'Mega Launcher' && flags.pulse) multiplier *= 1.5;
    if (attackerAbility === 'Strong Jaw' && flags.bite) multiplier *= 1.5;
    if (attackerAbility === 'Tough Claws' && flags.contact) multiplier *= 4 / 3;
    if (attackerAbility === 'Reckless' && flags.recoil) multiplier *= 1.2;
    if (attackerAbility === 'Sheer Force' && flags.secondary) multiplier *= 1.3;
    if (attackerAbility === 'Steelworker' && move.type === 'Steel') multiplier *= 1.5;
    if (attackerAbility === 'Water Bubble' && move.type === 'Water') multiplier *= 2;
    if (attackerAbility === 'Tinted Lens' && effectiveness > 0 && effectiveness < 1) multiplier *= 2;
    if (attackerAbility === 'Sand Force' && weather === 'sandstorm' && ['Ground', 'Rock', 'Steel'].includes(move.type)) multiplier *= 1.3;
    if (attackerAbility === 'Toxic Boost' && ['poison', 'badly_poison'].includes(attacker.status)
        && move?.combat?.damage_class === 'physical') multiplier *= 1.5;
    if (attackerAbility === 'Sniper' && context.critical) multiplier *= 1.5;
    if (attackerAbility === 'Stakeout' && defender.__battle?.switchedInTurn === battleState?.turn) multiplier *= 2;
    if (attackerAbility === 'Rivalry') {
        const gender = require('../items/stoneEvolution').gender;
        const a = gender(attacker), d = gender(defender);
        if (['male','female'].includes(a) && ['male','female'].includes(d)) multiplier *= a === d ? 1.25 : 0.75;
    }
    if ((move.type === 'Dark' && [attackerAbility, getAbilityName(defender)].includes('Dark Aura'))
        || (move.type === 'Fairy' && [attackerAbility, getAbilityName(defender)].includes('Fairy Aura'))) {
        multiplier *= [attackerAbility, getAbilityName(defender)].includes('Aura Break') ? 0.75 : 4 / 3;
    }
    if (attacker.__battle?.flashFireBoost && move.type === 'Fire') multiplier *= 1.5;

    if (defenderAbility === 'Fluffy') {
        if (flags.contact && attackerAbility !== 'Long Reach') multiplier *= 0.5;
        if (move.type === 'Fire') multiplier *= 2;
    }
    if (defenderAbility === 'Heatproof' && move.type === 'Fire') multiplier *= 0.5;
    if (defenderAbility === 'Dry Skin' && move.type === 'Fire') multiplier *= 1.25;
    if (defenderAbility === 'Water Bubble' && move.type === 'Fire') multiplier *= 0.5;
    if (defenderAbility === 'Thick Fat' && ['Fire', 'Ice'].includes(move.type)) multiplier *= 0.5;
    if (['Filter', 'Prism Armor', 'Solid Rock'].includes(defenderAbility) && effectiveness > 1) multiplier *= 0.75;
    if (['Multiscale', 'Shadow Shield'].includes(defenderAbility) && defenderHpRatio >= 1) multiplier *= 0.5;

    if (hpRatio <= 1 / 3 && ((attackerAbility === 'Blaze' && move.type === 'Fire')
        || (attackerAbility === 'Torrent' && move.type === 'Water')
        || (attackerAbility === 'Overgrow' && move.type === 'Grass')
        || (attackerAbility === 'Swarm' && move.type === 'Bug'))) multiplier *= 1.5;

    return multiplier;
}

function getCriticalAbilityState(attacker, defender) {
    const defenderAbility = ignoresDefenderAbility(attacker, defender) ? null : getAbilityName(defender);
    return {
        bonusStage: hasAbility(attacker, 'Super Luck') ? 1 : 0,
        alwaysCritical: hasAbility(attacker, 'Merciless') && ['poison', 'badly_poison'].includes(defender?.status),
        blocked: CRITICAL_IMMUNITIES.has(defenderAbility)
    };
}

function applySwitchInAbility(pokemon, opponent, ownSide, enemySide, battleState, helpers = {}) {
    const messages = [];
    if (!pokemon || safeNumber(pokemon.currentHp, 0) <= 0) return messages;
    const ability = getAbilityName(pokemon);
    const name = pokemon.truename || pokemon.name || 'Pokemon';
    const enemyName = opponent?.truename || opponent?.name || 'adversaire';
    const changeStage = helpers.changeStage;

    const weatherByAbility = {
        Drizzle: 'rain', Drought: 'sun', 'Sand Stream': 'sandstorm', 'Snow Warning': 'hail'
    };
    const terrainByAbility = {
        'Electric Surge': 'electric_terrain', 'Grassy Surge': 'grassy_terrain',
        'Misty Surge': 'misty_terrain', 'Psychic Surge': 'psychic_terrain'
    };
    if (weatherByAbility[ability] && battleState?.weather) {
        battleState.weather.kind = weatherByAbility[ability];
        battleState.weather.turns = 5;
        messages.push(`${ability} de ${name} declenche la meteo ${battleState.weather.kind}.`);
    }
    if (terrainByAbility[ability] && battleState?.terrain) {
        battleState.terrain.kind = terrainByAbility[ability];
        battleState.terrain.turns = 5;
        messages.push(`${ability} de ${name} cree le terrain ${battleState.terrain.kind}.`);
    }
    if (ability === 'Intimidate' && opponent && typeof changeStage === 'function') {
        changeStage(opponent, 'attack', -1, messages, pokemon);
    }
    if (ability === 'Download' && typeof changeStage === 'function' && opponent) {
        const defense = safeNumber(opponent.currentDefense, opponent.defense);
        const specialDefense = safeNumber(opponent.currentSpecialDefense, opponent.specialDefense);
        changeStage(pokemon, defense < specialDefense ? 'attack' : 'specialAttack', 1, messages, pokemon);
    }
    const uncopyable = new Set(['Trace','Imposter','Illusion','Multitype','RKS System','Schooling','Shields Down','Stance Change','Disguise','Comatose','Power Construct','Battle Bond']);
    if (ability === 'Trace' && opponent && getAbilityName(opponent) && !uncopyable.has(getAbilityName(opponent)) && typeof helpers.snapshotAbility === 'function') {
        helpers.snapshotAbility(pokemon);
        pokemon.passiveAbility = getAbilityName(opponent);
        messages.push(`${name} copie ${getAbilityName(opponent)} avec Trace.`);
        messages.push(...applySwitchInAbility(pokemon,opponent,ownSide,enemySide,battleState,helpers));
    }
    if (ability === 'Frisk' && opponent?.heldItem) {
        messages.push(`${name} detecte l'objet ${opponent.heldItem} de ${enemyName}.`);
    }
    if (ability === 'Forewarn' && Array.isArray(opponent?.abilities) && typeof helpers.getMove === 'function') {
        const strongest = opponent.abilities.map((moveName) => helpers.getMove(moveName)).filter(Boolean)
            .sort((a, b) => safeNumber(b.power, 0) - safeNumber(a.power, 0))[0];
        if (strongest) messages.push(`${name} pressent ${strongest.ename} avec Forewarn.`);
    }
    if (ability === 'Anticipation' && Array.isArray(opponent?.abilities) && typeof helpers.isThreateningMove === 'function') {
        const threat = opponent.abilities.find((moveName) => helpers.isThreateningMove(moveName, pokemon));
        if (threat) messages.push(`${name} fremit devant ${threat} grace a Anticipation.`);
    }
    if (ability === 'Imposter' && opponent && typeof helpers.snapshotMoveStats === 'function') {
        helpers.snapshotMoveStats(pokemon);
        pokemon.abilities = Array.isArray(opponent.abilities) ? [...opponent.abilities] : [];
        pokemon.movePp = pokemon.abilities.map(() => 5);
        for (const stat of ['currentAttack', 'currentDefense', 'currentSpecialAttack', 'currentSpecialDefense', 'currentSpeed']) {
            pokemon[stat] = opponent[stat];
        }
        if (!pokemon.__battle) pokemon.__battle = {};
        pokemon.__battle.tempTypes = [opponent.type1, opponent.type2].filter(Boolean);
        if(typeof helpers.snapshotAbility==='function') {helpers.snapshotAbility(pokemon);pokemon.passiveAbility=getAbilityName(opponent);}
        messages.push(`${name} prend l'apparence et les aptitudes de ${enemyName} avec Imposter.`);
    }
    if (ability === 'Forecast') {
        if (!pokemon.__battle) pokemon.__battle = {};
        const weather = isWeatherSuppressed(pokemon,opponent)?null:battleState?.weather?.kind;
        pokemon.__battle.tempTypes = weather === 'sun' ? ['Fire']
            : weather === 'rain' ? ['Water']
                : weather === 'hail' ? ['Ice'] : [];
    }
    return messages;
}

function applySwitchOutAbility(pokemon) {
    const messages = [];
    if (!pokemon) return messages;
    const ability = getAbilityName(pokemon);
    const name = pokemon.truename || pokemon.name || 'Pokemon';
    if (ability === 'Natural Cure' && pokemon.currentHp > 0 && pokemon.status && pokemon.status !== 'normal') {
        pokemon.status = 'normal';
        messages.push(`${name} est soigne par Medic Nature.`);
    }
    if (ability === 'Regenerator' && safeNumber(pokemon.currentHp, 0) > 0) {
        const before = safeNumber(pokemon.currentHp, 0);
        pokemon.currentHp = Math.min(safeNumber(pokemon.maxHp, 1), before + Math.max(1, Math.floor(safeNumber(pokemon.maxHp, 1) / 3)));
        if (pokemon.currentHp > before) messages.push(`${name} recupere des PV avec Regenerator.`);
    }
    return messages;
}

function applyWeatherAbilityEndTurn(pokemon, opponent, battleState, helpers = {}) {
    const messages = [];
    if (!pokemon || safeNumber(pokemon.currentHp, 0) <= 0) return messages;
    const ability = getAbilityName(pokemon);
    const weather = isWeatherSuppressed(pokemon,opponent)?null:battleState?.weather?.kind;
    const maxHp = Math.max(1, safeNumber(pokemon.maxHp, 1));
    const name = pokemon.truename || pokemon.name || 'Pokemon';
    const canHeal = pokemon.__battle?.healBlockTurns <= 0;

    if (canHeal && ((ability === 'Rain Dish' && weather === 'rain') || (ability === 'Ice Body' && weather === 'hail'))) {
        const healed = helpers.heal?.(pokemon, Math.max(1, Math.floor(maxHp / 16))) || 0;
        if (healed > 0) messages.push(`${name} recupere ${healed} PV grace a ${ability}.`);
    }
    if (ability === 'Dry Skin') {
        if (weather === 'rain' && canHeal) {
            const healed = helpers.heal?.(pokemon, Math.max(1, Math.floor(maxHp / 8))) || 0;
            if (healed > 0) messages.push(`${name} recupere ${healed} PV avec Dry Skin.`);
        } else if (weather === 'sun') {
            const damaged = helpers.damage?.(pokemon, Math.max(1, Math.floor(maxHp / 8)))?.damageToHp || 0;
            if (damaged > 0) messages.push(`${name} perd ${damaged} PV avec Dry Skin.`);
        }
    }
    if (ability === 'Solar Power' && weather === 'sun') {
        const damaged = helpers.damage?.(pokemon, Math.max(1, Math.floor(maxHp / 8)))?.damageToHp || 0;
        if (damaged > 0) messages.push(`${name} perd ${damaged} PV avec Solar Power.`);
    }
    if (ability === 'Hydration' && weather === 'rain' && pokemon.status !== 'normal') {
        pokemon.status = 'normal';
        messages.push(`${name} est soigne par Hydration.`);
    }
    if (ability === 'Forecast') {
        if (!pokemon.__battle) pokemon.__battle = {};
        pokemon.__battle.tempTypes = weather === 'sun' ? ['Fire']
            : weather === 'rain' ? ['Water']
                : weather === 'hail' ? ['Ice'] : [];
    }
    return messages;
}

module.exports = {
    FAMILY_ABILITIES,
    SUPPORTED_ABILITIES,
    applySwitchInAbility,
    applySwitchOutAbility,
    applyWeatherAbilityEndTurn,
    blocksForcedSwitch,
    blocksStatDrop,
    canAbilityBlockStatus,
    getAbilityAccuracyMultiplier,
    getAbilityDamageMultiplier,
    getAbilityName,
    getAbilityPriority,
    getAbilitySpeedMultiplier,
    getAbilityStatMultiplier,
    getCriticalAbilityState,
    getMoveFlags,
    hasAbility,
    ignoresDefenderAbility,
    isWeatherSuppressed,
    resolveMoveAbilityImmunity,
    transformMoveForAbility
};
