const { battleWeatherForMap } = require('../world/mapWeather');
const heldItems = require('../items/heldItems');
const reactions = require('../abilities/abilityReactions');
const abilityForms = require('../abilities/abilityForms');
const { abilityFlag } = require('../abilities/abilityRules');
const twoTurn = require('./twoTurnMoves');
const rampage = require('./rampageMoves');
const turnActions = require('./turnActions');
const battleField = require('./battleField');
const moveGuards = require('./moveGuards');
const { weatherHealingAmount } = require('./weatherHealing');
const drift = require('../drift/driftEffects');
const {
    consumeMovePp,
    getItemDefinition,
    getMovePp,
    getMaxMovePp,
    getUsableMoveIndexes,
    getChargingMove,
    getForcedMove,
    normalizeMovePp,
    reduceMovePp
} = require('./battleResources');
const {
    applySwitchInAbility,
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
} = require('../abilities/abilityEngine');
const { getEffectiveness } = require('./typeChart');
const { getMoveByName, loadMovesData } = require('./moveDex');

const STATUS_LABELS = {
    burn: 'brulure',
    poison: 'poison',
    badly_poison: 'empoisonnement severe',
    paralyze: 'paralysie',
    sleep: 'sommeil',
    freeze: 'gel',
    confusion: 'confusion',
    infatuation: 'attirance'
};

const STAGE_MIN = -6;
const STAGE_MAX = 6;
const NON_VOLATILE_STATUSES = new Set(['burn', 'poison', 'badly_poison', 'paralyze', 'sleep', 'freeze']);
const PARTIAL_EFFECT_KINDS = new Set();

const FIELD_TIMER_MAP = battleField.FIELD_TIMERS;
const SIDE_FIELD_TIMER_MAP = battleField.SIDE_TIMERS;

const WEATHER_FIELDS = new Set(['rain', 'sun', 'sandstorm', 'hail']);
const TERRAIN_FIELDS = new Set(['electric_terrain', 'grassy_terrain', 'misty_terrain', 'psychic_terrain']);

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function getPokemonDisplayName(pokemon) {
    if (!pokemon) return 'Pokemon';
    return pokemon.truename || pokemon.name || 'Pokemon';
}

function getStatusLabel(status) {
    return STATUS_LABELS[status] || status || 'etat';
}

function safeNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function createSideState(name = 'side') {
    return {
        name,
        hazards: {
            spikes: 0,
            toxicSpikes: 0,
            stealthRock: false,
            stickyWeb: false
        },
        screens: {
            reflectTurns: 0,
            auroraVeilTurns: 0,
            lightScreenTurns: 0,
            safeguardTurns: 0,
            mistTurns: 0,
            tailwindTurns: 0,
            luckyChantTurns: 0
        },
        protectTeam: {
            wideGuardTurns: 0,
            quickGuardTurns: 0,
            matBlockTurns: 0,
            craftyShieldTurns: 0
        },
        wish: null,
        pendingFullHeal: null,
        rewardMultiplier: 1,
        redirectionPokemonId: null,
        afterYouPokemonId: null
    };
}

function createBattleState(options = {}) {
    return {
        turn: 1,
        battleType: ['wild','trainer','arena','pvp'].includes(options?.battleType) ? options.battleType : null,
        weather: battleWeatherForMap(options?.mapName, options?.opponentMap),
        terrain: {
            kind: null,
            turns: 0
        },
        field: {
            gravityTurns: 0,
            trickRoomTurns: 0,
            magicRoomTurns: 0,
            wonderRoomTurns: 0,
            luckyChantTurns: 0,
            ionDelugeTurns: 0,
            mudSportTurns: 0,
            waterSportTurns: 0,
            fairyLockTurns: 0
        },
        sides: {
            player: createSideState('player'),
            enemy: createSideState('enemy')
        }
    };
}

function ensureBattleData(pokemon) {
    if (!pokemon || typeof pokemon !== 'object') {
        return {
            statStages: {
                attack: 0,
                defense: 0,
                specialAttack: 0,
                specialDefense: 0,
                speed: 0,
                accuracy: 0,
                evasion: 0,
                critical: 0
            }
        };
    }

    if (!pokemon.__battle || typeof pokemon.__battle !== 'object') {
        pokemon.__battle = {};
    }

    const battleData = pokemon.__battle;

    if (!battleData.statStages) {
        battleData.statStages = {};
    }

    for (const statName of ['attack', 'defense', 'specialAttack', 'specialDefense', 'speed', 'accuracy', 'evasion', 'critical']) {
        if (!Number.isFinite(battleData.statStages[statName])) {
            battleData.statStages[statName] = 0;
        }
    }

    // Saved non-volatile sleep can outlive the transient battle counter.
    if (!Number.isFinite(battleData.sleepTurns)) battleData.sleepTurns = pokemon.status === 'sleep' ? Math.floor(Math.random() * 3) + 2 : 0;
    if (!Number.isFinite(battleData.activeMoveActions)) battleData.activeMoveActions = Number(battleData.lastActionTurn) > 0 ? 1 : 0;
    if (!Number.isFinite(battleData.toxicCounter)) battleData.toxicCounter = 1;
    if (!Number.isFinite(battleData.confusionTurns)) battleData.confusionTurns = 0;
    if (!Number.isFinite(battleData.infatuationTurns)) battleData.infatuationTurns = 0;
    if (!Number.isFinite(battleData.trappedTurns)) battleData.trappedTurns = 0;
    if (!Number.isFinite(battleData.tauntTurns)) battleData.tauntTurns = 0;
    if (!Number.isFinite(battleData.disableTurns)) battleData.disableTurns = 0;
    if (!Number.isFinite(battleData.encoreTurns)) battleData.encoreTurns = 0;
    if (!Number.isFinite(battleData.lockOnTurns)) battleData.lockOnTurns = 0;
    if (!Number.isFinite(battleData.magnetRiseTurns)) battleData.magnetRiseTurns = 0;
    if (!Number.isFinite(battleData.telekinesisTurns)) battleData.telekinesisTurns = 0;
    if (!Number.isFinite(battleData.perishSongTurns)) battleData.perishSongTurns = 0;
    if (!Number.isFinite(battleData.stockpileCount)) battleData.stockpileCount = 0;
    if (!Number.isFinite(battleData.substituteHp)) battleData.substituteHp = 0;
    if (!Number.isFinite(battleData.chargeTurns)) battleData.chargeTurns = 0;
    if (!Number.isFinite(battleData.healBlockTurns)) battleData.healBlockTurns = 0;
    if (!Number.isFinite(battleData.embargoTurns)) battleData.embargoTurns = 0;

    if (typeof battleData.lastMoveUsed !== 'string') battleData.lastMoveUsed = null;
    if (typeof battleData.disabledMove !== 'string') battleData.disabledMove = null;
    if (typeof battleData.encoreMove !== 'string') battleData.encoreMove = null;
    if (typeof battleData.lockOnTargetId !== 'string') battleData.lockOnTargetId = null;
    if (typeof battleData.chargeMove !== 'string') battleData.chargeMove = null;
    if (typeof battleData.lastMoveSlot !== 'number') battleData.lastMoveSlot = -1;
    if (typeof battleData.originalPassiveAbility !== 'string') battleData.originalPassiveAbility = null;

    if (!battleData.leechSeedSource) battleData.leechSeedSource = null;
    if (!battleData.curseSource) battleData.curseSource = null;
    if (!battleData.delayedStatus || typeof battleData.delayedStatus !== 'object') battleData.delayedStatus = null;
    if (!battleData.tempTypes || !Array.isArray(battleData.tempTypes)) battleData.tempTypes = [];

    battleData.protect = Boolean(battleData.protect);
    battleData.endure = Boolean(battleData.endure);
    battleData.nightmare = Boolean(battleData.nightmare);
    battleData.aquaRing = Boolean(battleData.aquaRing);
    battleData.ingrain = Boolean(battleData.ingrain);
    battleData.chargeElectric = Boolean(battleData.chargeElectric);
    battleData.tormented = Boolean(battleData.tormented);
    battleData.destinyBond = Boolean(battleData.destinyBond);
    battleData.powdered = Boolean(battleData.powdered);
    battleData.helpingHand = Boolean(battleData.helpingHand);
    battleData.abilitySuppressed = Boolean(battleData.abilitySuppressed);
    battleData.imprison = Boolean(battleData.imprison);
    battleData.magicCoat = Boolean(battleData.magicCoat);
    battleData.snatch = Boolean(battleData.snatch);
    battleData.grudge = Boolean(battleData.grudge);
    battleData.quashed = Boolean(battleData.quashed);
    battleData.electrified = Boolean(battleData.electrified);
    battleData.celebrated = Boolean(battleData.celebrated);

    if (!Number.isFinite(battleData.lastDamageTaken)) battleData.lastDamageTaken = 0;
    if (!Number.isFinite(battleData.lastActionTurn)) battleData.lastActionTurn = 0;
    if (typeof battleData.lastDamageClass !== 'string') battleData.lastDamageClass = null;

    return battleData;
}

function getPokemonTypes(pokemon) {
    const battleData = ensureBattleData(pokemon);
    if (battleData.tempTypes.length > 0) {
        return battleData.tempTypes.filter(Boolean);
    }
    if (battleData.formTypes?.length) return battleData.formTypes;

    return [pokemon.type1, pokemon.type2].filter(Boolean);
}

function hasType(pokemon, type) {
    if (!type) return false;
    return getPokemonTypes(pokemon).includes(type);
}

function getPassiveAbility(pokemon) {
    return getAbilityName(pokemon);
}

function hasPassiveAbility(pokemon, abilityName) {
    return hasAbility(pokemon, abilityName);
}

function isHeldItemEnabled(pokemon, battleState) {
    return heldItems.enabled(pokemon, battleState);
}

function itemOwner(pokemon, key, value) { Object.defineProperty(pokemon, key, {value,writable:true,configurable:true,enumerable:false}); }

function consumeHeldItem(pokemon, battleState = null) {
    if (!pokemon?.heldItem) return null;
    const battleData = ensureBattleData(pokemon);
    const itemKey = pokemon.heldItem;
    const origin = pokemon.__heldItemOrigin || pokemon;
    if (itemKey === 'focus_sash') {
        // Strategic equipment is spent for this battle, not permanently lost.
        // Keep its original owner even after Trick, theft or Pickup.
        snapshotHeldItemForExchange(origin);
        itemOwner(origin, '__heldItemConsumedForBattle', itemKey);
    } else if (Object.hasOwn(origin, '__heldItemBeforeExchange')) origin.__heldItemBeforeExchange = null;
    itemOwner(pokemon, '__consumedHeldItemOrigin', origin);
    itemOwner(pokemon, '__heldItemOrigin', null);
    pokemon.heldItem = null;
    if (hasPassiveAbility(pokemon, 'Unburden')) battleData.unburden = true;
    battleData.consumedHeldItem = itemKey;
    battleData.consumedHeldItemTurn=battleState?.turn;
    return itemKey;
}

function snapshotHeldItemForExchange(pokemon) {
    if (!pokemon || Object.prototype.hasOwnProperty.call(pokemon, '__heldItemBeforeExchange')) return;
    if (!Object.hasOwn(pokemon, '__heldItemOrigin')) itemOwner(pokemon, '__heldItemOrigin', pokemon.heldItem ? pokemon : null);
    Object.defineProperty(pokemon, '__heldItemBeforeExchange', {
        value: pokemon.heldItem || null,
        writable: true,
        configurable: true,
        enumerable: false
    });
}

function canKnockOffItem(pokemon) {
    const item=getItemDefinition(pokemon?.heldItem);
    return Boolean(item?.category==='held'&&!item.unremovable&&item.key!=='rift_talisman');
}
function knockOffHeldItem(attacker,target,messages=[]) {
    if(!canKnockOffItem(target))return null;
    if(target.currentHp>0&&hasPassiveAbility(target,'Sticky Hold')&&!ignoresDefenderAbility(attacker,target)){
        messages.push('Glue empêche Sabotage de faire tomber l’objet.');return null;
    }
    snapshotHeldItemForExchange(target);
    const item=target.heldItem,origin=target.__heldItemOrigin||target;
    itemOwner(origin,'__heldItemKnockedOff',item);
    itemOwner(target,'__heldItemOrigin',null);
    target.heldItem=null;
    if(hasPassiveAbility(target,'Unburden'))ensureBattleData(target).unburden=true;
    messages.push(`Sabotage fait tomber ${getItemDefinition(item).name} de ${getPokemonDisplayName(target)} !`);
    return item;
}

function snapshotPassiveAbility(pokemon) {
    if (!pokemon || Object.prototype.hasOwnProperty.call(pokemon, '__passiveAbilityBeforeBattle')) return;
    Object.defineProperty(pokemon, '__passiveAbilityBeforeBattle', {
        value: pokemon.passiveAbility || null,
        writable: true,
        configurable: true,
        enumerable: false
    });
}

function snapshotMoveAndStatOverrides(pokemon) {
    if (!pokemon || Object.prototype.hasOwnProperty.call(pokemon, '__moveAndStatOverrides')) return;
    Object.defineProperty(pokemon, '__moveAndStatOverrides', {
        value: {
            abilities: Array.isArray(pokemon.abilities) ? [...pokemon.abilities] : [],
            movePp: Array.isArray(pokemon.movePp) ? [...pokemon.movePp] : [],
            currentAttack: pokemon.currentAttack,
            currentDefense: pokemon.currentDefense,
            currentSpecialAttack: pokemon.currentSpecialAttack,
            currentSpecialDefense: pokemon.currentSpecialDefense,
            currentSpeed: pokemon.currentSpeed
        },
        writable: true,
        configurable: true,
        enumerable: false
    });
}

// Copy stored combat stats, never the target's item/status/side multipliers.
// Identity, level, K, training, HP and held item continue to belong to the user.
function transformPokemon(pokemon, target) {
    if (!pokemon || !target || pokemon === target || !(pokemon.currentHp > 0) || !(target.currentHp > 0)) return false;
    const own = ensureBattleData(pokemon), other = ensureBattleData(target);
    if (own.transformed || own.illusion || other.transformed || other.substituteHp > 0 || other.illusion || other.semiInvulnerable) return false;
    if (!Array.isArray(target.abilities) || !target.abilities.length) return false;
    snapshotMoveAndStatOverrides(pokemon);
    snapshotPassiveAbility(pokemon);
    for (const stat of ['attack','defense','specialAttack','specialDefense','speed']) {
        pokemon['current' + stat[0].toUpperCase() + stat.slice(1)] = getBaseStatValue(target, stat);
    }
    own.tempTypes = [...getPokemonTypes(target)];
    own.statStages = { ...other.statStages };
    own.transformed = true;
    own.transformSpeciesId = target.data?.id || null;
    own.transformSpriteId = other.formSpriteId || target.data?.id || null;
    own.abilityForm = null;
    own.formTypes = null;
    own.formSpriteId = null;
    own.formLabel = null;
    pokemon.abilities = target.abilities.slice(0, 4);
    pokemon.movePp = pokemon.abilities.map(name => Math.min(5, getMaxMovePp(name)));
    pokemon.passiveAbility = target.passiveAbility || null;
    if (own.choiceMove && !pokemon.abilities.includes(own.choiceMove)) delete own.choiceMove;
    return true;
}

function consumeBerry(pokemon, battleState, messages) {
    consumeHeldItem(pokemon,battleState);
    if (pokemon.currentHp > 0 && hasPassiveAbility(pokemon,'Cheek Pouch') && !(pokemon.__battle?.healBlockTurns > 0)) {
        const healed = healPokemon(pokemon,Math.max(1,Math.floor(pokemon.maxHp/3)));
        if (healed) messages.push(`${getPokemonDisplayName(pokemon)} récupère ${healed} PV avec Bajoues.`);
    }
}

function resistanceBerry(defender, attacker, move, effectiveness, state) {
    const item = getItemDefinition(defender.heldItem);
    if (heldItems.effect(defender,state) !== 'type_resist' || item?.resist_type !== move.type
        || (effectiveness <= 1 && move.type !== 'Normal') || (attacker?.currentHp > 0 && hasPassiveAbility(attacker,'Unnerve'))
        || (defender.__battle?.substituteHp > 0 && !hasPassiveAbility(attacker,'Infiltrator') && !getMoveFlags(move).sound)) return null;
    return item.key;
}

function activateHeldItem(pokemon, battleState, messages, trigger = 'immediate', opponent = null) {
    if (!isHeldItemEnabled(pokemon, battleState) || safeNumber(pokemon.currentHp, 0) <= 0) return false;
    const item = getItemDefinition(pokemon.heldItem);
    if (!item || item.category !== 'held') return false;
    const pokemonName = getPokemonDisplayName(pokemon);
    const maxHp = Math.max(1, safeNumber(pokemon.maxHp, 1));
    const berry = pokemon.heldItem.endsWith('_berry');
    if (berry && opponent?.currentHp > 0 && hasPassiveAbility(opponent,'Unnerve')) return false;
    const consume = () => {
        if (berry) consumeBerry(pokemon,battleState,messages);
        else consumeHeldItem(pokemon,battleState);
    };

    const cures = item.cure || item.fieldUse?.cure || [];
    if (trigger === 'immediate' && item.battle_effect === 'cure_status'
        && (cures.includes(pokemon.status) || (item.key === 'lum_berry' && pokemon.__battle?.confusionTurns > 0))) {
        const itemName = item.name;
        pokemon.status = 'normal';
        pokemon.__battle.sleepTurns = 0; pokemon.__battle.toxicCounter = 1; pokemon.__battle.nightmare = false;
        if (item.key === 'lum_berry') pokemon.__battle.confusionTurns = 0;
        consume();
        messages.push(`${pokemonName} consomme ${itemName}.`);
        return true;
    }
    if (trigger === 'immediate' && item.battle_effect === 'cure_confusion' && pokemon.__battle?.confusionTurns > 0) {
        pokemon.__battle.confusionTurns = 0; consume();
        messages.push(`${pokemonName} consomme ${item.name} et n’est plus confus.`); return true;
    }
    if (trigger === 'immediate' && item.battle_effect === 'restore_pp') {
        normalizeMovePp(pokemon);
        const slot = pokemon.abilities.findIndex((_name,i) => pokemon.movePp[i] === 0);
        if (slot >= 0) {
            pokemon.movePp[slot] = Math.min(getMaxMovePp(pokemon.abilities[slot]),item.restore_pp);
            consume(); messages.push(`${pokemonName} consomme ${item.name} et récupère des PP.`); return true;
        }
    }

    const hpRatio = safeNumber(pokemon.currentHp, 0) / maxHp;
    const threshold=berry && hasPassiveAbility(pokemon,'Gluttony') && item.trigger_hp_ratio===.25 ? .5 : safeNumber(item.trigger_hp_ratio,0);
    if (trigger === 'immediate' && item.battle_effect === 'stat_berry' && hpRatio <= threshold) {
        if ((pokemon.__battle?.statStages?.[item.stat] || 0) < 6) {
            applyStageChange(pokemon,item.stat,1,messages,pokemon); consume();
            messages.push(`${pokemonName} consomme ${item.name}.`); return true;
        }
    }
    if (trigger === 'immediate' && hpRatio <= threshold && !(pokemon.__battle?.healBlockTurns > 0)) {
        let amount = 0;
        if (item.battle_effect === 'heal_flat') amount = safeNumber(item.amount, 0);
        if (item.battle_effect === 'heal_fraction') amount = Math.floor(maxHp * safeNumber(item.fraction, 0));
        if (amount > 0) {
            const healed = healPokemon(pokemon, amount);
            const itemName = item.name;
            consume();
            messages.push(`${pokemonName} consomme ${itemName} et recupere ${healed} PV.`);
            return true;
        }
    }

    if (trigger === 'end_turn' && item.battle_effect === 'end_turn_heal') {
        const healed = healPokemon(pokemon, Math.max(1, Math.floor(maxHp * safeNumber(item.fraction, 0))));
        if (healed > 0) messages.push(`${pokemonName} recupere ${healed} PV avec ${item.name}.`);
        return healed > 0;
    }

    return false;
}

function isGrounded(pokemon, battleState) {
    if (!pokemon) return false;
    if (battleState?.field?.gravityTurns > 0) return true;
    if (pokemon.__battle?.grounded || pokemon.__battle?.ingrain) return true;
    if (hasType(pokemon, 'Flying')) return false;
    if (hasPassiveAbility(pokemon, 'Levitate')) return false;
    const battleData = ensureBattleData(pokemon);
    if (battleData.telekinesisTurns > 0) return false;
    if (battleData.magnetRiseTurns > 0) return false;
    return true;
}

function stageMultiplier(stage) {
    const normalized = clamp(Math.trunc(stage), STAGE_MIN, STAGE_MAX);
    if (normalized >= 0) {
        return (2 + normalized) / 2;
    }
    return 2 / (2 - normalized);
}

function getCriticalChance(stage) {
    if (stage <= 0) return 1 / 24;
    if (stage === 1) return 1 / 8;
    if (stage === 2) return 1 / 2;
    return 1;
}

function setPokemonHp(pokemon, nextHp) {
    const hpMax = Math.max(1, safeNumber(pokemon.maxHp, 1));
    const clampedHp = clamp(Math.round(nextHp), 0, hpMax);
    pokemon.currentHp = clampedHp;
    drift.markHp(pokemon, clampedHp);
    return clampedHp;
}

function getBaseStatValue(pokemon, statName) {
    const formStat=pokemon.__battle?.transformed ? null : abilityForms.stat(pokemon,statName);
    if(formStat!=null)return formStat;
    switch (statName) {
        case 'attack':
            return safeNumber(pokemon.currentAttack, safeNumber(pokemon.attack, 1));
        case 'defense':
            return safeNumber(pokemon.currentDefense, safeNumber(pokemon.defense, 1));
        case 'specialAttack':
            return safeNumber(pokemon.currentSpecialAttack, safeNumber(pokemon.specialAttack, 1));
        case 'specialDefense':
            return safeNumber(pokemon.currentSpecialDefense, safeNumber(pokemon.specialDefense, 1));
        case 'speed':
            return safeNumber(pokemon.currentSpeed, safeNumber(pokemon.speed, 1));
        default:
            return 1;
    }
}

function getEffectiveStatValue(pokemon, statName, battleState = null, opponent = null, ignoreStages = false, ignoreAbility = false) {
    const baseStat = battleState?.field?.wonderRoomTurns > 0
        ? ({defense:'specialDefense',specialDefense:'defense'}[statName] || statName) : statName;
    const base = Math.max(1, getBaseStatValue(pokemon, baseStat));
    const battleData = ensureBattleData(pokemon);
    const stage = ignoreStages ? 0 : battleData.statStages[statName] || 0;
    let value = base * stageMultiplier(stage);
    if (statName === 'speed') value = Math.floor(value);
    if (!ignoreAbility) value *= getAbilityStatMultiplier(pokemon, statName, battleState, opponent);
    value *= heldItems.statMultiplier(pokemon, statName, battleState);
    value = drift.defense(pokemon, statName, value);
    return Math.max(1, statName === 'speed' ? Math.floor(value) : Math.round(value));
}

function getAccuracyModifier(attacker, defender) {
    const attackerData = ensureBattleData(attacker);
    const defenderData = ensureBattleData(defender);

    const accuracyMultiplier = stageMultiplier(!ignoresDefenderAbility(attacker,defender)&&hasPassiveAbility(defender,'Unaware') ? 0 : attackerData.statStages.accuracy || 0);
    const evasionMultiplier = stageMultiplier(hasPassiveAbility(attacker,'Unaware') ? 0 : hasPassiveAbility(attacker,'Keen Eye') ? Math.min(0,defenderData.statStages.evasion||0) : defenderData.statStages.evasion || 0);
    return accuracyMultiplier / evasionMultiplier;
}

function getBattleSpeed(pokemon, side = null, battleState = null, opponent = null) {
    let speed = getEffectiveStatValue(pokemon, 'speed', battleState, opponent);
    if (side?.screens?.tailwindTurns > 0) speed *= 2;
    speed *= getAbilitySpeedMultiplier(pokemon, battleState, opponent);
    // Apply paralysis after the other modifiers and their rounding, so an odd
    // Speed under Tailwind is not rounded down twice.
    speed = Math.floor(speed);
    if (pokemon.status === 'paralyze' && !hasPassiveAbility(pokemon, 'Quick Feet')) speed = Math.floor(speed / 2);
    return Math.max(1, Math.floor(speed));
}

function applyDamage(target, damage, options = {}) {
    const resolvedDamage = Math.max(0, Math.floor(safeNumber(damage, 0)));
    const targetData = ensureBattleData(target);
    const hpBefore = safeNumber(target.currentHp, 0);

    const result = {
        damageToHp: 0,
        damageToSubstitute: 0,
        substituteBroken: false,
        endured: false
    };

    if (resolvedDamage <= 0 || hpBefore <= 0) {
        return result;
    }

    if (targetData.substituteHp > 0 && options.attacker && !options.bypassSubstitute) {
        const subBefore = targetData.substituteHp;
        targetData.substituteHp = Math.max(0, subBefore - resolvedDamage);
        result.damageToSubstitute = Math.min(subBefore, resolvedDamage);
        result.substituteBroken = targetData.substituteHp === 0;
        return result;
    }
    if(options.attacker && abilityForms.intercept(target,options.attacker,resolvedDamage)) {
        result.disguiseBroken=true;return result;
    }

    let finalDamage = Math.min(hpBefore, resolvedDamage);
    if (options.attacker && !ignoresDefenderAbility(options.attacker, target) && hasPassiveAbility(target, 'Sturdy')
        && hpBefore === safeNumber(target.maxHp, hpBefore) && finalDamage >= hpBefore) {
        finalDamage = Math.max(0, hpBefore - 1);
        result.endured = true;
    }
    if (options.allowEndure !== false && targetData.endure && finalDamage >= hpBefore) {
        finalDamage = Math.max(0, hpBefore - 1);
        result.endured = true;
    }

    if (options.attacker && finalDamage >= hpBefore && hpBefore === target.maxHp
        && heldItems.effect(target, options.battleState) === 'focus_sash') {
        finalDamage = hpBefore - 1; consumeHeldItem(target,options.battleState); result.endured = true; result.enduredBy = 'sa Ceinture Force';
    }
    finalDamage = drift.directDamage(target, finalDamage, options.attacker);
    setPokemonHp(target, hpBefore - finalDamage);
    drift.afterDamage(target, hpBefore, options.attacker);
    result.damageToHp = finalDamage;
    return result;
}

function healPokemon(target, healAmount) {
    const resolvedHeal = Math.max(0, Math.floor(safeNumber(healAmount, 0)));
    if (resolvedHeal <= 0 || target.currentHp <= 0 || target.__battle?.healBlockTurns>0 || (drift.states.has(target) && drift.isDead(target))) return 0;

    const hpBefore = safeNumber(target.currentHp, 0);
    const hpAfter = setPokemonHp(target, hpBefore + resolvedHeal);
    drift.shareHeal(target, Math.max(0, hpAfter - hpBefore));
    return Math.max(0, hpAfter - hpBefore);
}
function canApplyStatus(target, status, targetSide, options = {}) {
    if (!target || safeNumber(target.currentHp, 0) <= 0) return false;
    if (!status) return false;

    const currentStatus = target.status || 'normal';
    const isNonVolatile = NON_VOLATILE_STATUSES.has(status);

    if (!isNonVolatile && !['confusion', 'infatuation'].includes(status)) return false;

    const targetData = ensureBattleData(target);
    if (status === 'confusion' && targetData.confusionTurns > 0) return false;
    if (status === 'infatuation' && targetData.infatuationTurns > 0) return false;

    if (isNonVolatile && currentStatus !== 'normal') {
        return false;
    }

    if ((isNonVolatile || status === 'confusion') && !options.ignoreSafeguard && !hasPassiveAbility(options.attacker,'Infiltrator') && targetSide?.screens?.safeguardTurns > 0) {
        return false;
    }

    if (status === 'burn' && hasType(target, 'Fire')) return false;
    if (NON_VOLATILE_STATUSES.has(status) && !ignoresDefenderAbility(options.attacker,target) && target.data?.id===774 && hasPassiveAbility(target,'Shields Down')
        && target.__battle?.abilityForm==='Minior-Meteor')return false;
    if ((status === 'poison' || status === 'badly_poison') && (hasType(target, 'Poison') || hasType(target, 'Steel')) && !hasPassiveAbility(options.attacker,'Corrosion')) return false;
    if (status === 'freeze' && hasType(target, 'Ice')) return false;
    if (status === 'paralyze' && hasType(target, 'Electric')) return false;
    const abilityState=isWeatherSuppressed(target,options.attacker)?{...options.battleState,weather:null}:options.battleState;
    if (!ignoresDefenderAbility(options.attacker, target) && canAbilityBlockStatus(target, status, abilityState, options.attacker)) return false;

    const battleState = options.battleState;
    if (isGrounded(target, battleState)) {
        if ((isNonVolatile || status === 'confusion') && battleState?.terrain?.kind === 'misty_terrain') return false;
        if (status === 'sleep' && battleState?.terrain?.kind === 'electric_terrain') return false;
    }

    const moveType = options.move?.type;
    if (status === 'paralyze' && moveType === 'Electric' && hasType(target, 'Ground')) return false;

    return true;
}

function applyStatus(target, status, targetSide, messages, options = {}) {
    if (!canApplyStatus(target, status, targetSide, options)) {
        return false;
    }

    if (drift.statusGuard(target, status, options.attacker, options.driftReflected ? null : (source, reflectedStatus) =>
        applyStatus(source, reflectedStatus, null, messages, { ...options, attacker: target, driftReflected: true }))) return false;
    const targetData = ensureBattleData(target);
    const targetName = getPokemonDisplayName(target);

    if (status === 'confusion') {
        targetData.confusionTurns = Math.max(1, safeNumber(options.turns, 3));
        messages.push(`${targetName} est confus !`);
        return true;
    }

    if (status === 'infatuation') {
        targetData.infatuationTurns = Math.max(1, safeNumber(options.turns, 3));
        messages.push(`${targetName} est charme !`);
        return true;
    }

    target.status = status;
    if (status === 'sleep') {
        targetData.sleepTurns = clamp(
            // The counter includes the waking action: 2–4 means 1–3 blocked actions.
            Math.floor(Number.isFinite(options.turns) ? options.turns : Math.floor(Math.random() * 3) + 2),
            2,
            4
        );
    }

    if (status === 'badly_poison') {
        targetData.toxicCounter = 1;
    }

    messages.push(`${targetName} est touche par ${getStatusLabel(status)}.`);
    if (!options.synchronized && options.attacker && options.attacker!==target && hasPassiveAbility(target,'Synchronize')
        && ['burn','poison','badly_poison','paralyze'].includes(status)) {
        applyStatus(options.attacker,status==='badly_poison'?'poison':status,options.sourceSide,messages,
            {...options,attacker:target,synchronized:true});
    }
    return true;
}

function clearStatus(target, messages, statusFilter = null, clearVolatile = true) {
    if (!target) return false;
    const targetData = ensureBattleData(target);
    const currentStatus = target.status || 'normal';

    if (statusFilter && Array.isArray(statusFilter) && !statusFilter.includes(currentStatus)) {
        return false;
    }

    let removed = false;

    if (currentStatus !== 'normal') {
        target.status = 'normal';
        targetData.sleepTurns = 0;
        targetData.toxicCounter = 1;
        targetData.nightmare = false;
        removed = true;
    }

    if (clearVolatile && targetData.confusionTurns > 0) {
        targetData.confusionTurns = 0;
        removed = true;
    }

    if (clearVolatile && targetData.infatuationTurns > 0) {
        targetData.infatuationTurns = 0;
        removed = true;
    }

    if (removed) {
        messages.push(`${getPokemonDisplayName(target)} retrouve son etat normal.`);
    }

    return removed;
}

function getMovePriority(moveName, pokemon = null) {
    const move = getMoveByName(getChargingMove(pokemon) || moveName);
    return safeNumber(move?.combat?.priority, 0) + getAbilityPriority(pokemon, move);
}

function orderBattleActions(actions, battleState, random = Math.random) {
    return [...(Array.isArray(actions) ? actions : [])].sort((actionA, actionB) => {
        const pokemonA = actionA?.pokemon;
        const pokemonB = actionB?.pokemon;
        const dataA = ensureBattleData(pokemonA);
        const dataB = ensureBattleData(pokemonB);

        if (dataA.quashed !== dataB.quashed) return dataA.quashed ? 1 : -1;

        const afterYouA = actionA?.side?.afterYouPokemonId === pokemonA?.uuid;
        const afterYouB = actionB?.side?.afterYouPokemonId === pokemonB?.uuid;
        if (afterYouA !== afterYouB) return afterYouA ? -1 : 1;

        const priorityA = getMovePriority(actionA?.moveName, pokemonA) + safeNumber(actionA?.driftPriority, 0);
        const priorityB = getMovePriority(actionB?.moveName, pokemonB) + safeNumber(actionB?.driftPriority, 0);
        if (priorityA !== priorityB) return priorityB - priorityA;
        if (hasPassiveAbility(pokemonA,'Stall') !== hasPassiveAbility(pokemonB,'Stall')) return hasPassiveAbility(pokemonA,'Stall') ? 1 : -1;

        const speedA = getBattleSpeed(pokemonA, actionA?.side, battleState, pokemonB);
        const speedB = getBattleSpeed(pokemonB, actionB?.side, battleState, pokemonA);
        if (speedA !== speedB) {
            return battleState?.field?.trickRoomTurns > 0 ? speedA - speedB : speedB - speedA;
        }
        return random() < 0.5 ? -1 : 1;
    });
}

function resolveRedirectedTarget(originalTarget, targetSide, activeTargets = [], move = null) {
    const moveTarget = move?.combat?.target || 'single';
    if (!['single', 'opponent'].includes(moveTarget)) return originalTarget;
    const redirectId = targetSide?.redirectionPokemonId;
    if (!redirectId) return originalTarget;
    return activeTargets.find((pokemon) => pokemon?.uuid === redirectId && safeNumber(pokemon.currentHp, 0) > 0)
        || originalTarget;
}

function resolveWeatherMove(move, attacker, defender, battleState) {
    // Keep user-dependent targeting identical for execution and animation,
    // without modifying the shared catalogue (including temporary types).
    if (move?.ename === 'Curse') {
        return {...move, combat: {...move.combat, target: hasType(attacker, 'Ghost') ? 'single' : 'self'}};
    }
    if (move?.ename !== 'Weather Ball' || move.__weatherResolved) return move;
    const weather=isWeatherSuppressed(attacker,defender)?null:battleState?.weather?.kind;
    const type=({sun:'Fire',rain:'Water',hail:'Ice',sandstorm:'Rock'})[weather];
    return {...move,type:type||'Normal',power:type?100:50,__weatherResolved:true};
}

function battleMoveTypes(pokemon, opponent, battleState) {
    return (pokemon?.abilities||[]).map(name=> {
        const move=resolveWeatherMove(getMoveByName(name),pokemon,opponent,battleState);
        return move?.ename==='Weather Ball'?transformMoveForAbility(pokemon,move).move.type:null;
    });
}

function calculateDamageDetailed(attacker, defender, move, context = {}) {
    move=resolveWeatherMove(move,attacker,defender,context.battleState);
    const damageClass = move?.combat?.damage_class || (move?.category === 'phy' ? 'physical' : move?.category === 'spe' ? 'special' : 'status');
    if (damageClass === 'status') {
        return {
            damage: 0,
            effectiveness: 1,
            critical: false
        };
    }

    const level = Math.max(1, safeNumber(attacker.level, 1));
    let power = Math.max(0, safeNumber(move.power, 0))*(move.ename==='Knock Off'&&canKnockOffItem(defender)?1.5:1);
    if (move.ename === 'Facade' && ['burn', 'poison', 'badly_poison', 'paralyze'].includes(attacker.status)) power *= 2;
    if (power <= 0) {
        return {
            damage: 0,
            effectiveness: 1,
            critical: false
        };
    }

    const attackStatName = damageClass === 'physical' ? 'attack' : 'specialAttack';
    const defenseStatName = damageClass === 'physical' ? 'defense' : 'specialDefense';
    const battleState = context.battleState;
    const bypass=ignoresDefenderAbility(attacker,defender);
    const attackStat = Math.max(1, getEffectiveStatValue(attacker, attackStatName, battleState, defender, !bypass&&hasPassiveAbility(defender,'Unaware')));
    let defenseStat = Math.max(1, getEffectiveStatValue(defender, defenseStatName, battleState, attacker, hasPassiveAbility(attacker,'Unaware'),bypass));

    defenseStat = Math.max(1, drift.pierce(attacker, defenseStat));
    let baseDamage = (((((2 * level) / 5) + 2) * attackStat * power) / defenseStat) / 50 + 2;
    let modifier = 1;

    const attackerTypes = getPokemonTypes(attacker);
    const defenderTypes = getPokemonTypes(defender);

    if (attackerTypes.includes(move.type)) {
        modifier *= hasPassiveAbility(attacker, 'Adaptability') ? 2 : 1.5;
    }

    let effectiveness = 1;
    const defenderData = ensureBattleData(defender);
    for (const type of defenderTypes) {
        let typeModifier = getEffectiveness(move.type, type);
        if (type === 'Flying' && move.type === 'Ground' && (defenderData.grounded || battleState?.field?.gravityTurns > 0 || move.ename === 'Thousand Arrows')) typeModifier = 1;
        if (typeModifier === 0 && type === 'Ghost' && (defenderData.foresight || hasPassiveAbility(attacker,'Scrappy')) && ['Normal', 'Fighting'].includes(move.type)) {
            typeModifier = 1;
        }
        if (typeModifier === 0 && type === 'Dark' && defenderData.miracleEye && move.type === 'Psychic') {
            typeModifier = 1;
        }
        effectiveness *= typeModifier;
    }
    modifier *= effectiveness;

    const weather = isWeatherSuppressed(attacker, defender) ? null : battleState?.weather?.kind;
    if (twoTurn.rule(move.ename)?.solar && ['rain','hail','sandstorm'].includes(weather)) modifier *= 0.5;
    const hidden = twoTurn.rule(defenderData.chargeMove) || (defenderData.skyDropBy ? twoTurn.rule('Sky Drop') : null);
    if (defenderData.semiInvulnerable && hidden?.hits?.[move.ename]) modifier *= hidden.hits[move.ename];
    if (weather === 'rain') {
        if (move.type === 'Water') modifier *= 1.5;
        if (move.type === 'Fire') modifier *= 0.5;
    } else if (weather === 'sun') {
        if (move.type === 'Fire') modifier *= 1.5;
        if (move.type === 'Water') modifier *= 0.5;
    }

    if (battleState?.terrain?.kind === 'electric_terrain' && move.type === 'Electric' && isGrounded(attacker, battleState)) {
        modifier *= 1.5;
    }
    if (battleState?.terrain?.kind === 'grassy_terrain' && move.type === 'Grass' && isGrounded(attacker, battleState)) {
        modifier *= 1.5;
    }
    if (battleState?.terrain?.kind === 'psychic_terrain' && move.type === 'Psychic' && isGrounded(attacker, battleState)) modifier *= 1.5;
    if (battleState?.terrain?.kind === 'misty_terrain' && move.type === 'Dragon' && isGrounded(defender, battleState)) {
        modifier *= 0.5;
    }
    if (battleState?.terrain?.kind === 'grassy_terrain' && ['Earthquake','Bulldoze','Magnitude'].includes(move.ename) && isGrounded(defender,battleState)) modifier *= 0.5;
    if (battleState?.field?.mudSportTurns > 0 && move.type === 'Electric') modifier *= 1/3;
    if (battleState?.field?.waterSportTurns > 0 && move.type === 'Fire') modifier *= 1/3;

    if (damageClass === 'physical' && attacker.status === 'burn' && move.ename !== 'Facade' && !hasPassiveAbility(attacker, 'Guts')) {
        modifier *= 0.5;
    }


    const attackerData = ensureBattleData(attacker);
    if (attackerData.chargeElectric && move.type === 'Electric') {
        modifier *= 2;
        attackerData.chargeElectric = false;
    }
    if (attackerData.helpingHand) {
        modifier *= 1.5;
        attackerData.helpingHand = false;
    }

    const criticalAbility = getCriticalAbilityState(attacker, defender);
    const critStage = (safeNumber(move?.combat?.crit_stage, 0)
        + safeNumber(attackerData.statStages.critical, 0)
        + criticalAbility.bonusStage);
    const criticalBlocked = battleState?.field?.luckyChantTurns > 0
        || context.defenderSide?.screens?.luckyChantTurns > 0
        || criticalAbility.blocked;
    const critical = !criticalBlocked && (attackerData.laserFocusTurns>0
        || !context.preview && (criticalAbility.alwaysCritical || Math.random() < getCriticalChance(critStage)));
    if (critical) {
        modifier *= 1.5;
    }
    if (!critical && !hasPassiveAbility(attacker,'Infiltrator') && (context.defenderSide?.screens?.[damageClass==='physical'?'reflectTurns':'lightScreenTurns']>0 || context.defenderSide?.screens?.auroraVeilTurns>0)) modifier *= 0.5;

    modifier *= getAbilityDamageMultiplier({
        attacker,
        defender,
        move,
        effectiveness,
        critical,
        battleState,
        movedLast: Boolean(context.movedLast),
        abilityPowerMultiplier: context.abilityPowerMultiplier
    });

    modifier *= heldItems.damageMultiplier(attacker, effectiveness, battleState);
    const resistBerry = resistanceBerry(defender,attacker,move,effectiveness,battleState);
    if (resistBerry) modifier *= 0.5;
    modifier *= drift.multiplier(attacker, defender, move, critical);
    let damage = Math.floor(baseDamage * modifier);
    if (effectiveness <= 0) {
        damage = 0;
    } else if (damage > 0) {
        damage = Math.max(1, damage);
    }

    return {
        damage,
        effectiveness,
        critical,
        resistBerry
    };
}

function calculateDamage(attacker, defender, move) {
    return calculateDamageDetailed(attacker, defender, move).damage;
}

// Read-only, non-critical estimate. Never consumes flags, PP, items or battle RNG.
// Callers can supply an inferred opponent instead of exposing hidden information.
function estimateDamage(attacker, defender, move, context = {}) {
    return calculateDamageDetailed(structuredClone(attacker), structuredClone(defender), move,
        { ...structuredClone(context), preview: true }).damage;
}

// Internal planner fast path: callers must own disposable Pokémon copies and
// an isolated field. The formula may normalize/consume flags on those copies;
// it only reads the field. Live combat callers keep using estimateDamage above.
function estimateDamageOnCopies(attacker, defender, move, context = {}) {
    return calculateDamageDetailed(attacker, defender, move, { ...context, preview: true }).damage;
}

function weatherMoveAccuracy(move, attacker, defender, battleState) {
    const weather = isWeatherSuppressed(attacker, defender) ? null : battleState?.weather?.kind;
    if (['Thunder', 'Hurricane'].includes(move?.ename)) {
        if (weather === 'rain') return -1;
        if (weather === 'sun') return 50;
    }
    if (move?.ename === 'Blizzard' && weather === 'hail') return -1;
    return safeNumber(move?.accuracy, -1);
}

function resolveEffectTarget(effect, attacker, defender, context, move) {
    const rawTarget = effect.target || move?.combat?.target || 'single';
    const normalized = typeof rawTarget === 'string' ? rawTarget : 'single';

    if (normalized === 'ally' && context.targetAlly) {
        return {
            pokemon: context.targetAlly,
            side: context.attackerSide,
            targetType: normalized
        };
    }

    if (normalized === 'self' || normalized === 'ally' || normalized === 'self_or_ally') {
        return {
            pokemon: attacker,
            side: context.attackerSide,
            targetType: normalized
        };
    }

    if (normalized === 'self_side' || normalized === 'plus_minus_allies' || normalized === 'grass_grounded_allies') {
        return {
            pokemon: attacker,
            side: context.attackerSide,
            targetType: normalized
        };
    }

    if (normalized === 'opponent_side' || normalized === 'all_opponents') {
        return {
            pokemon: defender,
            side: context.defenderSide,
            targetType: normalized
        };
    }

    if (normalized === 'field' || normalized === 'all' || normalized === 'all_active' || normalized === 'all_adjacent') {
        return {
            pokemon: defender,
            side: null,
            targetType: normalized
        };
    }

    return {
        pokemon: defender,
        side: context.defenderSide,
        targetType: normalized
    };
}

function describeStageDelta(stat, appliedStages) {
    const statLabels = {
        attack: 'Attaque',
        defense: 'Defense',
        specialAttack: 'Attaque Speciale',
        specialDefense: 'Defense Speciale',
        speed: 'Vitesse',
        accuracy: 'Precision',
        evasion: 'Esquive',
        critical: 'Critique'
    };

    const label = statLabels[stat] || stat;
    if (appliedStages > 0) {
        return `${label} augmente de ${appliedStages}.`;
    }
    return `${label} baisse de ${Math.abs(appliedStages)}.`;
}

function applyStageChange(target, stat, stages, messages, source = null, options = {}) {
    const targetData = ensureBattleData(target);
    let resolvedStages = safeNumber(stages, 0);
    if (resolvedStages < 0 && source && source !== target && options.side?.screens?.mistTurns > 0 && !hasPassiveAbility(source,'Infiltrator')) {
        messages.push(`Brume protège les statistiques de ${getPokemonDisplayName(target)}.`); return;
    }
    if (!ignoresDefenderAbility(source, target) && blocksStatDrop(target, stat, resolvedStages, source)) {
        messages.push(`${getPokemonDisplayName(target)} protege ses statistiques avec son talent.`);
        return;
    }
    if (!ignoresDefenderAbility(source, target) && hasPassiveAbility(target, 'Contrary')) resolvedStages *= -1;
    if (!ignoresDefenderAbility(source, target) && hasPassiveAbility(target, 'Simple')) resolvedStages *= 2;
    const currentStage = safeNumber(targetData.statStages[stat], 0);
    const nextStage = clamp(currentStage + resolvedStages, STAGE_MIN, STAGE_MAX);
    const applied = nextStage - currentStage;
    targetData.statStages[stat] = nextStage;

    if (applied !== 0) {
        messages.push(`${getPokemonDisplayName(target)}: ${describeStageDelta(stat, applied)}`);
        if(applied<0 && source!==target && source) {
            if(hasPassiveAbility(target,'Defiant'))applyStageChange(target,'attack',2,messages,target);
            if(hasPassiveAbility(target,'Competitive'))applyStageChange(target,'specialAttack',2,messages,target);
        }
    } else {
        messages.push(`${getPokemonDisplayName(target)}: la statistique ${stat} ne peut plus changer.`);
    }
}

function canSwitchOut(pokemon, opponent = null, battleState = null, { escape = false } = {}) {
    if (!pokemon || safeNumber(pokemon.currentHp, 0) <= 0) return false;
    const battleData = ensureBattleData(pokemon);
    if (battleData.skyDropBy || (!escape && getForcedMove(pokemon))) return false;
    if (escape && hasPassiveAbility(pokemon,'Run Away')) return true;
    if (hasType(pokemon,'Ghost')) return true;
    if (battleState?.field?.fairyLockTurns > 0) return false;
    if (battleData.trappedTurns > 0) return false;
    if (battleData.ingrain) return false;
    if(opponent?.currentHp>0) {
        if(hasPassiveAbility(opponent,'Shadow Tag') && !hasPassiveAbility(pokemon,'Shadow Tag'))return false;
        if(hasPassiveAbility(opponent,'Magnet Pull') && hasType(pokemon,'Steel'))return false;
        if(hasPassiveAbility(opponent,'Arena Trap') && isGrounded(pokemon,battleState))return false;
    }
    return true;
}

function isMoveBlockedByProtect(defender, defenderSide, move, attacker = null) {
    if (move?.ename === 'Curse') return false;
    const defenderData = ensureBattleData(defender);
    if (defenderData.protect) return true;

    const movePriority = safeNumber(move?.combat?.priority, 0) + getAbilityPriority(attacker,move);
    if (movePriority > 0 && defenderSide?.protectTeam?.quickGuardTurns > 0) return true;
    if (move?.combat?.damage_class === 'status' && defenderSide?.protectTeam?.craftyShieldTurns > 0) return true;
    if (defenderSide?.protectTeam?.wideGuardTurns > 0 && move?.combat?.damage_class !== 'status' && battleField.SPREAD_MOVES.has(move.ename)) return true;
    if (defenderSide?.protectTeam?.matBlockTurns > 0 && move?.combat?.damage_class !== 'status') return true;
    return false;
}

function resolveHitCount(move, attacker) {
    if(move.ename==='Water Shuriken' && attacker.__battle?.abilityForm==='Greninja-Ash')return 3;
    const canonical=reactions.traits.moves[move.ename]?.multihit;
    if (Number.isInteger(canonical)) return canonical;
    if (move?.combat?.power_type !== 'multi_hit' && !Array.isArray(canonical)) {
        return 1;
    }

    const minHits = canonical?.[0] || Math.max(2, safeNumber(move?.combat?.multi_hit?.min, 2));
    const maxHits = canonical?.[1] || Math.max(minHits, safeNumber(move?.combat?.multi_hit?.max, 5));
    if(hasPassiveAbility(attacker,'Skill Link'))return maxHits;
    if (minHits === 2 && maxHits === 5) {
        const roll = Math.random();
        return roll < .35 ? 2 : roll < .7 ? 3 : roll < .85 ? 4 : 5;
    }
    return Math.floor(Math.random() * (maxHits - minHits + 1)) + minHits;
}

function applyFieldEffect(effect, context, moveResult) {
    const fieldName=effect.field, messages=moveResult.messages, state=context.battleState;
    if(!fieldName || !state)return;
    const turns=Math.max(1,safeNumber(effect.turns,5)), label=battleField.LABELS[fieldName] || fieldName;
    if(fieldName==='aurora_veil' && (state.weather?.kind!=='hail' || isWeatherSuppressed(context.attacker,context.defender))){moveResult.success=false;messages.push('Voile Aurore échoue : la grêle est nécessaire.');return;}
    let container,key;
    if(WEATHER_FIELDS.has(fieldName) || TERRAIN_FIELDS.has(fieldName)) {
        const kind=WEATHER_FIELDS.has(fieldName)?'weather':'terrain';
        if(state[kind]?.kind===fieldName){moveResult.success=false;messages.push(`${label} est déjà actif.`);return;}
        state[kind]={kind:fieldName,turns};
        messages.push(`${label} s’installe pour ${turns} tours.`);return;
    }
    if(SIDE_FIELD_TIMER_MAP[fieldName]){container=context.attackerSide?.screens;key=SIDE_FIELD_TIMER_MAP[fieldName];}
    else {container=state.field;key=FIELD_TIMER_MAP[fieldName];}
    if(!container || !key)return;
    if(container[key]>0) {
        if(battleField.ROOMS.has(fieldName)){container[key]=0;messages.push(`${label} se termine.`);}
        else {moveResult.success=false;messages.push(`${label} est déjà actif.`);}
        return;
    }
    container[key]=turns;messages.push(`${label} s’active pour ${turns} tours.`);
    if(fieldName==='magic_room')for(const p of [context.attacker,context.defender])if(p?.__battle)delete p.__battle.choiceMove;
}

function applyEffect(effect, context, moveResult) {
    const messages = moveResult.messages;
    const { pokemon: effectTargetPokemon, side: effectTargetSide } = resolveEffectTarget(
        effect,
        context.attacker,
        context.defender,
        context,
        context.move
    );

    const attackerData = ensureBattleData(context.attacker);
    const targetData = ensureBattleData(effectTargetPokemon);
    if (effectTargetPokemon !== context.attacker && !ignoresDefenderAbility(context.attacker,effectTargetPokemon)) {
        if (hasPassiveAbility(effectTargetPokemon,'Aroma Veil') && ['taunt','disable_last_move','encore','torment','heal_block'].includes(effect.kind)) {
            messages.push(`${getPokemonDisplayName(effectTargetPokemon)} est protégé par Aroma-Voile.`); return;
        }
        if (effect.kind==='taunt' && hasPassiveAbility(effectTargetPokemon,'Oblivious')) return;
        if (effect.kind==='swap_item' && hasPassiveAbility(effectTargetPokemon,'Sticky Hold')) { messages.push('Glue empêche le transfert d’objet.'); return; }
    }
    const attemptProtection = () => {
        const turn = context.battleState.turn;
        const streak = attackerData.protectionTurn === turn - 1 ? (attackerData.protectionStreak || 0) : 0;
        if (streak && Math.random() >= 1 / (3 ** Math.min(streak, 6))) {
            attackerData.protectionStreak = 0;
            attackerData.protectionTurn = null;
            moveResult.success = false;
            messages.push('La protection échoue après des utilisations consécutives.');
            return false;
        }
        attackerData.protectionTurn = turn;
        attackerData.protectionStreak = streak + 1;
        return true;
    };
    const calledDepth = Math.max(0, safeNumber(context.calledDepth, 0));
    const executeCalledMove = (calledMoveName, { ignoreSleep = false } = {}) => {
        if (!calledMoveName || calledDepth >= 2 || calledMoveName === context.move?.ename) {
            messages.push(`Aucune capacite compatible ne peut etre appelee.`);
            return;
        }
        const nestedResult = useattack(calledMoveName, context.attacker, context.defender, {
            battleState: context.battleState,
            attackerSide: context.attackerSide,
            defenderSide: context.defenderSide,
            attackerTeam: context.attackerTeam,
            defenderTeam: context.defenderTeam,
            calledDepth: calledDepth + 1,
            sourceMove: context.move.ename,
            ignoreSleep,
            skipTurnStart: true,
            consumePp: false,
            targetAlly: context.targetAlly,
            activeAllies: context.activeAllies,
            activeDefenders: context.activeDefenders
        });
        moveResult.success = nestedResult.success;
        moveResult.calledMoveResolved = true;
        moveResult.damage += safeNumber(nestedResult.damage, 0);
        moveResult.substituteDamage += safeNumber(nestedResult.substituteDamage, 0);
        for (const key of ['critical','effectiveness','switchSelf','chooseSwitch','forceSwitch','batonPass','escape','phase']) {
            if (nestedResult[key] !== undefined) moveResult[key] = nestedResult[key];
        }
        moveResult.hits += safeNumber(nestedResult.hits, 0);
        moveResult.messages.push(`${getPokemonDisplayName(context.attacker)} appelle ${calledMoveName}.`);
        moveResult.messages.push(...nestedResult.messages);
    };

    switch (effect.kind) {
        case 'laser_focus':
            attackerData.laserFocusTurns=2;
            messages.push(`${getPokemonDisplayName(context.attacker)} se concentre : ses prochains coups seront critiques !`);
            return;
        case 'sound_block':
            targetData.soundBlockedTurns=Math.max(targetData.soundBlockedTurns||0,2);
            messages.push(`${getPokemonDisplayName(effectTargetPokemon)} ne peut plus utiliser de capacités sonores pendant deux tours.`);
            return;
        case 'strength_sap': {
            if((targetData.statStages.attack||0)<=-6){moveResult.success=false;messages.push('Vole-Force échoue : l’Attaque est déjà au minimum.');return;}
            const amount=Math.max(1,Math.floor(getBaseStatValue(effectTargetPokemon,'attack')*stageMultiplier(targetData.statStages.attack||0)));
            const old=targetData.statStages.attack||0;
            applyStageChange(effectTargetPokemon,'attack',-1,messages,context.attacker,{side:effectTargetSide});
            let healed=0;
            if(hasPassiveAbility(effectTargetPokemon,'Liquid Ooze')) {
                if(!hasPassiveAbility(context.attacker,'Magic Guard'))applyDamage(context.attacker,amount,{allowEndure:false});
                messages.push('Suintement transforme le soin de Vole-Force en dégâts !');
            } else healed=healPokemon(context.attacker,amount);
            moveResult.success=healed>0||(targetData.statStages.attack||0)!==old;
            if(healed)messages.push(`${getPokemonDisplayName(context.attacker)} récupère ${healed} PV avec Vole-Force.`);
            return;
        }
        case 'stat_stage':
            applyStageChange(
                effectTargetPokemon,
                effect.stat,
                safeNumber(effect.stages, 0),
                messages,
                context.attacker,
                {side: effectTargetSide}
            );
            return;

        case 'random_stat_boost': {
            const stats = ['attack', 'defense', 'specialAttack', 'specialDefense', 'speed'];
            const randomStat = stats[Math.floor(Math.random() * stats.length)];
            applyStageChange(effectTargetPokemon, randomStat, Math.max(1, safeNumber(effect.stages, 1)), messages);
            return;
        }

        case 'status': {
            const chance = clamp(safeNumber(effect.chance, 1), 0, 1);
            if (Math.random() <= chance) {
                applyStatus(effectTargetPokemon, effect.status, effectTargetSide, messages, {
                    battleState: context.battleState,
                    move: context.move,
                    turns: effect.turns,
                    sourceSide: context.attackerSide,
                    attacker: context.attacker
                });
            } else {
                messages.push(`Le statut ${effect.status} n'est pas applique.`);
            }
            return;
        }

        case 'status_chance': {
            const chance = clamp(safeNumber(effect.chance, 0), 0, 1);
            if (Math.random() <= chance) {
                applyStatus(effectTargetPokemon, effect.status, effectTargetSide, messages, {
                    battleState: context.battleState,
                    move: context.move,
                    turns: effect.turns,
                    sourceSide: context.attackerSide,
                    attacker: context.attacker
                });
            }
            return;
        }

        case 'heal': {
            if (targetData.healBlockTurns > 0) {
                messages.push(`${getPokemonDisplayName(effectTargetPokemon)} ne peut pas etre soigne (Anti-Soin).`);
                return;
            }
            let healAmount = 0;
            if (effect.mode === 'full') {
                healAmount = safeNumber(effectTargetPokemon.maxHp, 1);
            } else if (effect.mode === 'fraction') {
                healAmount = weatherHealingAmount(context.move, effectTargetPokemon, context.defender, context.battleState)
                    ?? Math.floor(safeNumber(effectTargetPokemon.maxHp, 1) * safeNumber(effect.fraction, 0));
            }
            const healed = healPokemon(effectTargetPokemon, healAmount);
            if (healed > 0) {
                messages.push(`${getPokemonDisplayName(effectTargetPokemon)} recupere ${healed} PV.`);
            } else {
                moveResult.success = false;
                messages.push(`${getPokemonDisplayName(effectTargetPokemon)} est deja au max de PV.`);
            }
            return;
        }

        case 'field':
            applyFieldEffect(effect, context, moveResult);
            return;

        case 'hazard':
            moveResult.success = battleField.setHazard(effect.hazard, context.defenderSide, messages);
            return;

        case 'protect': {
            const scope = effect.scope || 'self';
            if (scope === 'self') {
                if (!attemptProtection()) return;
                attackerData.protect = true;
                messages.push(`${getPokemonDisplayName(context.attacker)} se protege.`);
                return;
            }
            if (scope === 'team_wide') {
                if (context.attackerSide?.protectTeam) {
                    context.attackerSide.protectTeam.wideGuardTurns = 1;
                }
                messages.push(`L'equipe de ${getPokemonDisplayName(context.attacker)} est protegee.`);
                return;
            }
            if (scope === 'quick_guard') {
                if (context.attackerSide?.protectTeam) {
                    context.attackerSide.protectTeam.quickGuardTurns = 1;
                }
                messages.push(`Quick Guard est actif.`);
                return;
            }
            if (scope === 'mat_block') {
                if (context.attackerSide?.protectTeam) {
                    context.attackerSide.protectTeam.matBlockTurns = 1;
                }
                messages.push(`Mat Block est actif.`);
                return;
            }
            if (scope === 'crafty_shield') {
                if (context.attackerSide?.protectTeam) {
                    context.attackerSide.protectTeam.craftyShieldTurns = 1;
                }
                messages.push(`Crafty Shield protege l'equipe des capacites de statut.`);
                return;
            }
            attackerData.protect = true;
            messages.push(`${getPokemonDisplayName(context.attacker)} se protege.`);
            return;
        }

        case 'endure':
            if (!attemptProtection()) return;
            attackerData.endure = true;
            messages.push(`${getPokemonDisplayName(context.attacker)} se prepare a tenir le coup.`);
            return;

        case 'trap':
            targetData.trappedTurns = Math.max(targetData.trappedTurns, 4);
            messages.push(`${getPokemonDisplayName(effectTargetPokemon)} est piege et ne peut plus fuir.`);
            return;

        case 'leech_seed':
            targetData.leechSeedSource = context.attacker;
            messages.push(`${getPokemonDisplayName(effectTargetPokemon)} est touche par Vampigraine.`);
            return;

        case 'wish': {
            if (context.attackerSide) {
                const amount = Math.max(1, Math.floor(safeNumber(context.attacker.maxHp, 1) * safeNumber(effect.fraction, 0.5)));
                context.attackerSide.wish = {
                    turns: Math.max(1, safeNumber(effect.turns, 1)),
                    amount
                };
                messages.push(`Un voeu est formule.`);
            }
            return;
        }

        case 'aqua_ring':
            attackerData.aquaRing = true;
            messages.push(`${getPokemonDisplayName(context.attacker)} est entoure d'un anneau d'eau.`);
            return;

        case 'ingrain':
            attackerData.ingrain = true;
            messages.push(`${getPokemonDisplayName(context.attacker)} plante ses racines.`);
            return;

        case 'substitute': {
            const hpCost = Math.floor(safeNumber(context.attacker.maxHp, 1) * safeNumber(effect.hp_fraction, 0.25));
            if (safeNumber(context.attacker.currentHp, 0) <= hpCost) {
                messages.push(`${getPokemonDisplayName(context.attacker)} n'a pas assez de PV pour Clonage.`);
                return;
            }
            applyDamage(context.attacker, hpCost, { allowEndure: false });
            attackerData.substituteHp = hpCost;
            messages.push(`${getPokemonDisplayName(context.attacker)} cree un clone.`);
            return;
        }

        case 'cure_status':
            clearStatus(effectTargetPokemon, messages, Array.isArray(effect.statuses) ? effect.statuses : null);
            return;

        case 'purify': {
            if (!NON_VOLATILE_STATUSES.has(effectTargetPokemon.status)) {
                moveResult.success=false;messages.push('Purification échoue : la cible ne souffre d’aucun problème de statut.');return;
            }
            clearStatus(effectTargetPokemon,messages,null,false);
            const healed=healPokemon(context.attacker,Math.ceil(context.attacker.maxHp/2));
            if(healed)messages.push(`${getPokemonDisplayName(context.attacker)} récupère ${healed} PV grâce à Purification.`);
            return;
        }

        case 'cure_status_team':
            if (Array.isArray(context.attackerTeam)) {
                for (const pokemon of context.attackerTeam) {
                    clearStatus(pokemon, messages);
                }
            } else {
                clearStatus(context.attacker, messages);
            }
            return;

        case 'taunt':
            targetData.tauntTurns = Math.max(targetData.tauntTurns, Math.max(1, safeNumber(effect.turns, 3)));
            messages.push(`${getPokemonDisplayName(effectTargetPokemon)} subit Provoc.`);
            return;

        case 'disable_last_move':
            if (targetData.lastMoveUsed) {
                targetData.disabledMove = targetData.lastMoveUsed;
                targetData.disableTurns = Math.max(targetData.disableTurns, Math.max(1, safeNumber(effect.turns, 3)));
                messages.push(`${getPokemonDisplayName(effectTargetPokemon)} ne peut plus utiliser ${targetData.disabledMove}.`);
            }
            return;

        case 'encore':
            if (targetData.lastMoveUsed) {
                targetData.encoreMove = targetData.lastMoveUsed;
                targetData.encoreTurns = Math.max(targetData.encoreTurns, Math.max(1, safeNumber(effect.turns, 3)));
                messages.push(`${getPokemonDisplayName(effectTargetPokemon)} est force de rejouer ${targetData.encoreMove}.`);
            }
            return;

        case 'lock_on':
            attackerData.lockOnTargetId = effectTargetPokemon.uuid || getPokemonDisplayName(effectTargetPokemon);
            attackerData.lockOnTurns = 2;
            messages.push(`${getPokemonDisplayName(context.attacker)} verrouille sa cible.`);
            return;

        case 'nightmare':
            if ((effectTargetPokemon.status || 'normal') === 'sleep') {
                targetData.nightmare = true;
                messages.push(`${getPokemonDisplayName(effectTargetPokemon)} fait un cauchemar.`);
            }
            return;

        case 'perish_song':
            attackerData.perishSongTurns = Math.max(1, safeNumber(effect.turns, 3));
            targetData.perishSongTurns = Math.max(1, safeNumber(effect.turns, 3));
            messages.push('Tous les Pokemon actifs entendent Requiem.');
            return;

        case 'belly_drum': {
            const hpCost = Math.floor(safeNumber(context.attacker.maxHp, 1) / 2);
            if (safeNumber(context.attacker.currentHp, 0) <= hpCost) {
                messages.push(`${getPokemonDisplayName(context.attacker)} n'a pas assez de PV pour Cognobidon.`);
                return;
            }
            applyDamage(context.attacker, hpCost, { allowEndure: false });
            applyStageChange(context.attacker, 'attack', 6, messages);
            return;
        }

        case 'stockpile':
            attackerData.stockpileCount = clamp(attackerData.stockpileCount + 1, 0, 3);
            applyStageChange(context.attacker, 'defense', 1, messages);
            applyStageChange(context.attacker, 'specialDefense', 1, messages);
            messages.push(`${getPokemonDisplayName(context.attacker)} stocke de l'energie (${attackerData.stockpileCount}).`);
            return;

        case 'swallow': {
            const stockpile = clamp(attackerData.stockpileCount, 0, 3);
            if (stockpile <= 0) {
                messages.push(`${getPokemonDisplayName(context.attacker)} n'a rien stocke.`);
                return;
            }
            const healRatio = stockpile === 1 ? 0.25 : stockpile === 2 ? 0.5 : 1;
            const healed = healPokemon(context.attacker, Math.floor(safeNumber(context.attacker.maxHp, 1) * healRatio));
            attackerData.stockpileCount = 0;
            messages.push(`${getPokemonDisplayName(context.attacker)} avale son energie et recupere ${healed} PV.`);
            return;
        }

        case 'reset_stat_stages': {
            const resetTargets = effect.target === 'all' ? [context.attacker, context.defender]
                : [effect.target === 'self' ? context.attacker : effectTargetPokemon];
            for (const resetTarget of resetTargets) {
                const resetData = ensureBattleData(resetTarget);
                for (const stat of Object.keys(resetData.statStages)) resetData.statStages[stat] = 0;
                messages.push(`Les changements de statistiques de ${getPokemonDisplayName(resetTarget)} sont annules.`);
            }
            return;
        }

        case 'invert_stat_stages': {
            for (const stat of Object.keys(targetData.statStages)) {
                targetData.statStages[stat] = clamp(-targetData.statStages[stat], STAGE_MIN, STAGE_MAX);
            }
            messages.push(`Les modificateurs de stats de ${getPokemonDisplayName(effectTargetPokemon)} sont inverses.`);
            return;
        }

        case 'copy_stat_stages': {
            const attackerStages = ensureBattleData(context.attacker).statStages;
            for (const stat of Object.keys(attackerStages)) {
                attackerStages[stat] = targetData.statStages[stat];
            }
            messages.push(`${getPokemonDisplayName(context.attacker)} copie les stats de ${getPokemonDisplayName(effectTargetPokemon)}.`);
            return;
        }

        case 'swap_stat_stage': {
            const stats = Array.isArray(effect.stats) ? effect.stats : [];
            const attackerStages = ensureBattleData(context.attacker).statStages;
            const defenderStages = ensureBattleData(context.defender).statStages;
            for (const stat of stats) {
                const swapTmp = attackerStages[stat];
                attackerStages[stat] = defenderStages[stat];
                defenderStages[stat] = swapTmp;
            }
            messages.push(`Les modificateurs de stats selectionnes sont echanges.`);
            return;
        }

        case 'swap_all_stat_stages': {
            const attackerStages = ensureBattleData(context.attacker).statStages;
            const defenderStages = ensureBattleData(context.defender).statStages;
            for (const stat of Object.keys(attackerStages)) {
                const swapTmp = attackerStages[stat];
                attackerStages[stat] = defenderStages[stat];
                defenderStages[stat] = swapTmp;
            }
            messages.push(`Tous les modificateurs de stats sont echanges.`);
            return;
        }

        case 'set_type': {
            const typeName = effect.type;
            if (typeName) {
                targetData.tempTypes = [typeName];
                messages.push(`${getPokemonDisplayName(effectTargetPokemon)} devient de type ${typeName}.`);
            }
            return;
        }

        case 'add_type': {
            if (effect.type && !targetData.tempTypes.includes(effect.type)) {
                const currentTypes = getPokemonTypes(effectTargetPokemon);
                targetData.tempTypes = [...new Set([...currentTypes, effect.type])];
                messages.push(`${getPokemonDisplayName(effectTargetPokemon)} acquiert le type ${effect.type}.`);
            }
            return;
        }

        case 'swap_stats': {
            const firstStat = effect.a;
            const secondStat = effect.b;
            const propertyByStat = {
                attack: 'currentAttack',
                defense: 'currentDefense',
                specialAttack: 'currentSpecialAttack',
                specialDefense: 'currentSpecialDefense',
                speed: 'currentSpeed'
            };
            const firstProperty = propertyByStat[firstStat];
            const secondProperty = propertyByStat[secondStat];
            if (firstProperty && secondProperty) {
                const previous = effectTargetPokemon[firstProperty];
                effectTargetPokemon[firstProperty] = effectTargetPokemon[secondProperty];
                effectTargetPokemon[secondProperty] = previous;
                messages.push(`${getPokemonDisplayName(effectTargetPokemon)} echange ${firstStat} et ${secondStat}.`);
            }
            return;
        }

        case 'change_type_from_move':
            if (context.move?.type) {
                attackerData.tempTypes = [context.move.type];
                messages.push(`${getPokemonDisplayName(context.attacker)} prend le type ${context.move.type}.`);
            }
            return;

        case 'reflect_type': {
            const defenderTypes = getPokemonTypes(context.defender);
            if (defenderTypes.length > 0) {
                attackerData.tempTypes = [...defenderTypes];
                messages.push(`${getPokemonDisplayName(context.attacker)} copie le type de la cible.`);
            }
            return;
        }
        case 'charge_next_electric':
            attackerData.chargeElectric = true;
            messages.push(`${getPokemonDisplayName(context.attacker)} charge sa prochaine attaque Electrik.`);
            return;

        case 'magnet_rise':
            attackerData.magnetRiseTurns = Math.max(attackerData.magnetRiseTurns, Math.max(1, safeNumber(effect.turns, 5)));
            messages.push(`${getPokemonDisplayName(context.attacker)} levevite pour ${attackerData.magnetRiseTurns} tours.`);
            return;

        case 'self_faint':
            setPokemonHp(context.attacker, 0);
            messages.push(`${getPokemonDisplayName(context.attacker)} se met K.O. !`);
            return;

        case 'force_switch':
            if (targetData.skyDropBy || targetData.skyDropTarget) {
                messages.push('Chute Libre empêche le changement forcé.'); return;
            }
            if (blocksForcedSwitch(effectTargetPokemon, context.attacker)) {
                messages.push(`${getPokemonDisplayName(effectTargetPokemon)} reste en place grace a Ventouse.`);
                return;
            }
            moveResult.forceSwitch = true;
            messages.push(`Le Pokemon adverse est force de changer.`);
            return;

        case 'escape':
            if(context.battleState?.battleType!=='wild'){
                if (!['trainer','arena','pvp'].includes(context.battleState?.battleType)
                    || !context.attackerTeam?.some(p => p !== context.attacker && p.currentHp > 0)) {
                    moveResult.success=false;messages.push('Téléport échoue : aucun équipier ne peut prendre le relais.');return;
                }
                moveResult.switchSelf=true;
                moveResult.chooseSwitch=true;
                messages.push(`${getPokemonDisplayName(context.attacker)} se téléporte pour laisser place à un équipier !`);
                return;
            }
            if(!canSwitchOut(context.attacker,context.defender,context.battleState,{escape:true})){
                moveResult.success=false;messages.push(`${getPokemonDisplayName(context.attacker)} est piégé et ne peut pas se téléporter.`);return;
            }
            moveResult.escape = true;
            messages.push(`${getPokemonDisplayName(context.attacker)} s’échappe avec Téléport !`);
            return;

        case 'delayed_status':
            if (!canApplyStatus(effectTargetPokemon,effect.status,effectTargetSide,{battleState:context.battleState,attacker:context.attacker,move:context.move})) {
                moveResult.success=false; messages.push(`${getPokemonDisplayName(effectTargetPokemon)} ne peut pas somnoler.`); return;
            }
            targetData.delayedStatus = {
                status: effect.status,
                turns: Math.max(1, safeNumber(effect.turns, 1)) + 1
            };
            messages.push(`${getPokemonDisplayName(effectTargetPokemon)} commence a somnoler.`);
            return;

        case 'psycho_shift': {
            const attackerStatus = context.attacker.status || 'normal';
            if (attackerStatus === 'normal') {
                messages.push(`${getPokemonDisplayName(context.attacker)} n'a aucun statut a transmettre.`);
                return;
            }
            if (applyStatus(effectTargetPokemon, attackerStatus, effectTargetSide, messages, {
                battleState: context.battleState,
                move: context.move
            })) {
                context.attacker.status = 'normal';
                attackerData.sleepTurns = 0;
                attackerData.toxicCounter = 1;
                messages.push(`${getPokemonDisplayName(context.attacker)} transmet son statut.`);
            }
            return;
        }

        case 'pain_split': {
            const sharedHp = Math.floor((safeNumber(context.attacker.currentHp, 0) + safeNumber(context.defender.currentHp, 0)) / 2);
            setPokemonHp(context.attacker, sharedHp);
            setPokemonHp(context.defender, sharedHp);
            messages.push(`Les PV des deux Pokemon sont partages.`);
            return;
        }

        case 'torment':
            targetData.tormented = true;
            messages.push(`${getPokemonDisplayName(effectTargetPokemon)} ne peut plus repeter deux fois la meme capacite.`);
            return;

        case 'heal_block':
            targetData.healBlockTurns = Math.max(targetData.healBlockTurns, Math.max(1, safeNumber(effect.turns, 5)));
            messages.push(`${getPokemonDisplayName(effectTargetPokemon)} subit Anti-Soin.`);
            return;

        case 'defog': {
            applyStageChange(effectTargetPokemon, 'evasion', -1, messages, context.attacker, {side:effectTargetSide});
            battleField.clearHazards(context.attackerSide);
            battleField.clearHazards(context.defenderSide);
            battleField.clearScreens(effectTargetSide);
            messages.push('Les pièges des deux camps et les écrans adverses sont dissipés.');
            return;
        }

        case 'curse': {
            if (hasType(context.attacker, 'Ghost')) {
                if (targetData.curseSource || effectTargetPokemon.currentHp <= 0) {
                    moveResult.success = false;
                    messages.push(`${getPokemonDisplayName(effectTargetPokemon)} est déjà maudit ou hors de combat.`);
                    return;
                }
                const hpCost = Math.max(1, Math.floor(safeNumber(context.attacker.maxHp, 1) / 2));
                const paid = applyDamage(context.attacker, hpCost, { allowEndure: false });
                // Only presence is needed; do not retain a mutable Pokémon graph.
                targetData.curseSource = context.attacker.uuid || true;
                messages.push(`${getPokemonDisplayName(context.attacker)} sacrifie ${paid.damageToHp} PV.`);
                messages.push(`${getPokemonDisplayName(effectTargetPokemon)} est maudit.`);
            } else {
                const before = {...attackerData.statStages};
                for (const [stat, stages] of [['speed', -1], ['attack', 1], ['defense', 1]]) {
                    applyStageChange(context.attacker, stat, stages, messages, context.attacker);
                }
                moveResult.success = ['speed', 'attack', 'defense'].some(stat =>
                    (before[stat] || 0) !== attackerData.statStages[stat]);
            }
            return;
        }

        case 'fairy_lock':
            if (context.battleState?.field?.fairyLockTurns > 0) { moveResult.success=false;messages.push('Verrou Enchanté est déjà actif.');return; }
            if (context.battleState?.field) context.battleState.field.fairyLockTurns = 2;
            messages.push(`Verrou Enchanté empêche les Pokémon de fuir jusqu’à la fin du prochain tour.`);
            return;

        case 'healing_wish':
        case 'lunar_dance':
            if (context.attackerSide) {
                context.attackerSide.pendingFullHeal = { cureStatus: true };
            }
            setPokemonHp(context.attacker, 0);
            messages.push(`${getPokemonDisplayName(context.attacker)} se sacrifie pour soigner le prochain Pokemon.`);
            return;

        case 'switch_self':
            moveResult.switchSelf = true;
            messages.push(`${getPokemonDisplayName(context.attacker)} doit etre remplace.`);
            return;

        case 'transform': {
            if (!transformPokemon(context.attacker, context.defender)) {
                moveResult.success = false;
                messages.push('Morphing échoue.');
                return;
            }
            messages.push(`${getPokemonDisplayName(context.attacker)} se transforme en ${getPokemonDisplayName(context.defender)}.`);
            if (getPassiveAbility(context.attacker) !== 'Imposter') messages.push(...applySwitchInAbility(
                context.attacker, context.defender, context.attackerSide, context.defenderSide, context.battleState, switchInAbilityHelpers(context.attacker,context.attackerSide,context.defenderSide)));
            return;
        }

        case 'camouflage': {
            const terrainType = {
                electric_terrain: 'Electric',
                grassy_terrain: 'Grass',
                misty_terrain: 'Fairy'
            }[context.battleState?.terrain?.kind] || 'Normal';
            attackerData.tempTypes = [terrainType];
            messages.push(`${getPokemonDisplayName(context.attacker)} devient de type ${terrainType}.`);
            return;
        }

        case 'foresight':
            targetData.foresight = true;
            messages.push(`${getPokemonDisplayName(effectTargetPokemon)} est identifie.`);
            return;

        case 'miracle_eye':
            targetData.miracleEye = true;
            messages.push(`${getPokemonDisplayName(effectTargetPokemon)} est sous l'effet d'Oeil Miracle.`);
            return;

        case 'guard_split': {
            const sharedDefense = Math.max(1, Math.floor((safeNumber(context.attacker.currentDefense, 1) + safeNumber(context.defender.currentDefense, 1)) / 2));
            const sharedSpecialDefense = Math.max(1, Math.floor((safeNumber(context.attacker.currentSpecialDefense, 1) + safeNumber(context.defender.currentSpecialDefense, 1)) / 2));
            context.attacker.currentDefense = sharedDefense;
            context.defender.currentDefense = sharedDefense;
            context.attacker.currentSpecialDefense = sharedSpecialDefense;
            context.defender.currentSpecialDefense = sharedSpecialDefense;
            messages.push(`Les defenses des deux Pokemon sont partagees.`);
            return;
        }

        case 'power_split': {
            const sharedAttack = Math.max(1, Math.floor((safeNumber(context.attacker.currentAttack, 1) + safeNumber(context.defender.currentAttack, 1)) / 2));
            const sharedSpecialAttack = Math.max(1, Math.floor((safeNumber(context.attacker.currentSpecialAttack, 1) + safeNumber(context.defender.currentSpecialAttack, 1)) / 2));
            context.attacker.currentAttack = sharedAttack;
            context.defender.currentAttack = sharedAttack;
            context.attacker.currentSpecialAttack = sharedSpecialAttack;
            context.defender.currentSpecialAttack = sharedSpecialAttack;
            messages.push(`Les forces offensives des deux Pokemon sont partagees.`);
            return;
        }

        case 'weight_down':
            attackerData.weightMultiplier = Math.max(0.25, safeNumber(attackerData.weightMultiplier, 1) * 0.5);
            applyStageChange(context.attacker, 'speed', 2, messages);
            messages.push(`${getPokemonDisplayName(context.attacker)} s'allege.`);
            return;

        case 'telekinesis':
            targetData.telekinesisTurns = Math.max(targetData.telekinesisTurns, Math.max(1, safeNumber(effect.turns, 3)));
            messages.push(`${getPokemonDisplayName(effectTargetPokemon)} flotte dans les airs.`);
            return;

        case 'ally_power_boost':
            attackerData.helpingHand = true;
            messages.push(`${getPokemonDisplayName(context.attacker)} renforce sa prochaine attaque.`);
            return;

        case 'contact_damage':
            attackerData.contactDamageFraction = Math.max(0, safeNumber(effect.fraction, 0.125));
            return;

        case 'powder':
            targetData.powdered = true;
            messages.push(`${getPokemonDisplayName(effectTargetPokemon)} est couvert de poudre explosive.`);
            return;

        case 'destiny_bond':
            attackerData.destinyBond = true;
            messages.push(`${getPokemonDisplayName(context.attacker)} tente d'entrainer son adversaire dans sa chute.`);
            return;

        case 'change_type_resist_last_hit':
            attackerData.tempTypes = ['Steel'];
            messages.push(`${getPokemonDisplayName(context.attacker)} adopte un type resistant.`);
            return;

        case 'copy_move':
        case 'copy_move_permanent': {
            const copiedMove = targetData.lastMoveUsed;
            if (!copiedMove) {
                messages.push(`Aucune capacite ne peut etre copiee.`);
                return;
            }
            if (!Array.isArray(context.attacker.abilities)) context.attacker.abilities = [];
            if (effect.kind === 'copy_move') snapshotMoveAndStatOverrides(context.attacker);
            if (!context.attacker.abilities.includes(copiedMove)) {
                if (context.attacker.abilities.length < 4) context.attacker.abilities.push(copiedMove);
                else context.attacker.abilities[context.attacker.abilities.length - 1] = copiedMove;
            }
            normalizeMovePp(context.attacker);
            messages.push(`${getPokemonDisplayName(context.attacker)} apprend ${copiedMove}.`);
            return;
        }

        case 'copy_last_move':
        case 'me_first':
        case 'copycat':
            executeCalledMove(targetData.lastMoveUsed);
            return;

        case 'random_move': {
            const callableMoves = loadMovesData().filter((candidate) =>
                candidate?.ename
                && candidate.ename !== context.move?.ename
                && candidate.combat?.damage_class !== 'status'
                && candidate.combat?.power_type !== 'ohko'
            );
            const selected = callableMoves[Math.floor(Math.random() * callableMoves.length)];
            executeCalledMove(selected?.ename);
            return;
        }

        case 'nature_power':
            executeCalledMove(context.battleState?.terrain?.kind === 'electric_terrain' ? 'Thunderbolt'
                : context.battleState?.terrain?.kind === 'grassy_terrain' ? 'Energy Ball'
                    : context.battleState?.terrain?.kind === 'misty_terrain' ? 'Moonblast'
                        : 'Tri Attack');
            return;

        case 'sleep_talk': {
            const callableMoves = (context.attacker.abilities || [])
                .filter((moveName) => moveName && moveName !== 'Sleep Talk' && getMoveByName(moveName));
            const selected = callableMoves[Math.floor(Math.random() * callableMoves.length)];
            executeCalledMove(selected, { ignoreSleep: true });
            return;
        }

        case 'assist': {
            const teamMoves = (context.attackerTeam || [])
                .flatMap((pokemon) => Array.isArray(pokemon?.abilities) ? pokemon.abilities : [])
                .filter((moveName) => moveName && moveName !== 'Assist' && getMoveByName(moveName));
            executeCalledMove(teamMoves[Math.floor(Math.random() * teamMoves.length)]);
            return;
        }

        case 'baton_pass':
            moveResult.switchSelf = true;
            moveResult.batonPass = true;
            messages.push(`${getPokemonDisplayName(context.attacker)} transmet ses bonus au prochain Pokemon.`);
            return;

        case 'reduce_pp_last_move': {
            const reduced = targetData.lastMoveUsed
                ? reduceMovePp(effectTargetPokemon, targetData.lastMoveUsed, Math.max(1, safeNumber(effect.amount, 4)))
                : 0;
            if (reduced > 0) {
                messages.push(`${targetData.lastMoveUsed} perd ${reduced} PP.`);
            } else {
                messages.push(`Aucun PP ne peut etre retire.`);
            }
            return;
        }

        case 'embargo':
            targetData.embargoTurns = Math.max(targetData.embargoTurns, Math.max(1, safeNumber(effect.turns, 5)));
            messages.push(`${getPokemonDisplayName(effectTargetPokemon)} ne peut plus utiliser son objet tenu.`);
            return;

        case 'knock_off':
            knockOffHeldItem(context.attacker,effectTargetPokemon,messages);
            return;

        case 'swap_item': {
            if ([context.attacker,context.defender].some(p=>p.heldItem==='rift_talisman')) { moveResult.messages.push('Le talisman ne peut pas être échangé en combat.'); break; }
            snapshotHeldItemForExchange(context.attacker);
            snapshotHeldItemForExchange(context.defender);
            const heldItem = context.attacker.heldItem || null;
            context.attacker.heldItem = context.defender.heldItem || null;
            context.defender.heldItem = heldItem;
            [context.attacker.__heldItemOrigin,context.defender.__heldItemOrigin] = [context.defender.__heldItemOrigin,context.attacker.__heldItemOrigin];
            messages.push(`Les objets tenus sont echanges.`);
            return;
        }

        case 'bestow_item':
            if (context.attacker.heldItem==='rift_talisman') { moveResult.messages.push('Le talisman ne peut pas être donné en combat.'); break; }
            if (!context.attacker.heldItem || context.defender.heldItem) {
                messages.push(`Le don d'objet echoue.`);
                return;
            }
            snapshotHeldItemForExchange(context.attacker);
            snapshotHeldItemForExchange(context.defender);
            context.defender.heldItem = context.attacker.heldItem;
            context.defender.__heldItemOrigin = context.attacker.__heldItemOrigin;
            context.attacker.__heldItemOrigin = null;
            context.attacker.heldItem = null;
            messages.push(`${getPokemonDisplayName(context.attacker)} transmet son objet tenu.`);
            return;

        case 'recycle':
            if (context.attacker.heldItem || !attackerData.consumedHeldItem) {
                messages.push(`Aucun objet ne peut etre recycle.`);
                return;
            }
            context.attacker.heldItem = attackerData.consumedHeldItem;
            if (context.attacker.__consumedHeldItemOrigin) {
                const origin = context.attacker.__consumedHeldItemOrigin;
                itemOwner(context.attacker, '__heldItemOrigin', origin);
                if (Object.hasOwn(origin, '__heldItemBeforeExchange')) origin.__heldItemBeforeExchange = attackerData.consumedHeldItem;
            }
            attackerData.consumedHeldItem = null;
            messages.push(`${getPokemonDisplayName(context.attacker)} recupere son objet consomme.`);
            return;

        case 'set_ability':
            if (abilityFlag(getAbilityName(effectTargetPokemon),'cantsuppress') || getAbilityName(effectTargetPokemon)==='Truant'
                || getAbilityName(effectTargetPokemon)===effect.ability) return;
            snapshotPassiveAbility(effectTargetPokemon);
            effectTargetPokemon.passiveAbility = effect.ability || null;
            targetData.abilitySuppressed = false;
            messages.push(`${getPokemonDisplayName(effectTargetPokemon)} obtient le talent ${effect.ability}.`);
            refreshChangedAbility(effectTargetPokemon, context.attacker, effectTargetSide, context.attackerSide, context.battleState, messages);
            return;

        case 'copy_ability':
            if (!getPassiveAbility(context.defender) || abilityFlag(getAbilityName(context.defender),'failroleplay')
                || abilityFlag(getAbilityName(context.attacker),'cantsuppress') || getAbilityName(context.attacker)===getAbilityName(context.defender)) {
                messages.push(`Aucun talent ne peut etre copie.`);
                return;
            }
            snapshotPassiveAbility(context.attacker);
            context.attacker.passiveAbility = getPassiveAbility(context.defender);
            attackerData.abilitySuppressed = false;
            messages.push(`${getPokemonDisplayName(context.attacker)} copie le talent ${context.attacker.passiveAbility}.`);
            refreshChangedAbility(context.attacker, context.defender, context.attackerSide, context.defenderSide, context.battleState, messages);
            return;

        case 'swap_ability': {
            if([context.attacker,context.defender].some(p=>abilityFlag(getAbilityName(p),'failskillswap')))return;
            snapshotPassiveAbility(context.attacker);
            snapshotPassiveAbility(context.defender);
            const attackerAbility = context.attacker.passiveAbility || null;
            context.attacker.passiveAbility = context.defender.passiveAbility || null;
            context.defender.passiveAbility = attackerAbility;
            attackerData.abilitySuppressed = false;
            targetData.abilitySuppressed = false;
            messages.push(`Les talents des deux Pokemon sont echanges.`);
            refreshChangedAbility(context.attacker, context.defender, context.attackerSide, context.defenderSide, context.battleState, messages);
            refreshChangedAbility(context.defender, context.attacker, context.defenderSide, context.attackerSide, context.battleState, messages);
            return;
        }

        case 'suppress_ability':
            if(reactions.UNCHANGEABLE.has(getAbilityName(effectTargetPokemon)))return;
            targetData.abilitySuppressed = true;
            messages.push(`Le talent de ${getPokemonDisplayName(effectTargetPokemon)} est neutralise.`);
            return;

        case 'entrainment':
            if (!getPassiveAbility(context.attacker) || abilityFlag(getAbilityName(context.attacker),'noentrain')
                || abilityFlag(getAbilityName(context.defender),'cantsuppress') || getAbilityName(context.defender)==='Truant'
                || getAbilityName(context.attacker)===getAbilityName(context.defender)) {
                messages.push(`Aucun talent ne peut etre transmis.`);
                return;
            }
            snapshotPassiveAbility(context.defender);
            context.defender.passiveAbility = getPassiveAbility(context.attacker);
            targetData.abilitySuppressed = false;
            messages.push(`${getPokemonDisplayName(context.defender)} recoit le talent ${context.defender.passiveAbility}.`);
            refreshChangedAbility(context.defender, context.attacker, context.defenderSide, context.attackerSide, context.battleState, messages);
            return;

        case 'magic_coat':
            attackerData.magicCoat = true;
            messages.push(`${getPokemonDisplayName(context.attacker)} se prepare a renvoyer une capacite de statut.`);
            return;

        case 'snatch':
            attackerData.snatch = true;
            messages.push(`${getPokemonDisplayName(context.attacker)} guette une capacite benefique a voler.`);
            return;

        case 'imprison':
            attackerData.imprison = true;
            messages.push(`${getPokemonDisplayName(context.attacker)} scelle les capacites qu'il connait.`);
            return;

        case 'grudge':
            attackerData.grudge = true;
            messages.push(`${getPokemonDisplayName(context.attacker)} nourrit une rancune.`);
            return;

        case 'electrify':
            targetData.electrified = true;
            messages.push(`La prochaine capacite de ${getPokemonDisplayName(effectTargetPokemon)} devient Electrik.`);
            return;

        case 'money_bonus':
            if (context.attackerSide) {
                context.attackerSide.rewardMultiplier = 2;
            }
            messages.push(`La recompense de ce combat sera doublee.`);
            return;

        case 'celebration':
            attackerData.celebrated = true;
            messages.push(`${getPokemonDisplayName(context.attacker)} celebre ce combat !`);
            return;

        case 'redirection':
            if (context.attackerSide) context.attackerSide.redirectionPokemonId = context.attacker.uuid || null;
            messages.push(`${getPokemonDisplayName(context.attacker)} attire les attaques adverses.`);
            return;

        case 'after_you':
            if (context.attackerSide) context.attackerSide.afterYouPokemonId = effectTargetPokemon.uuid || null;
            messages.push(`${getPokemonDisplayName(effectTargetPokemon)} agira des que possible.`);
            return;

        case 'ally_switch':
            if (Array.isArray(context.activeAllies) && context.activeAllies.length >= 2) {
                const actorIndex = context.activeAllies.indexOf(context.attacker);
                const allyIndex = context.activeAllies.findIndex((pokemon, index) =>
                    index !== actorIndex && safeNumber(pokemon?.currentHp, 0) > 0
                );
                if (actorIndex >= 0 && allyIndex >= 0) {
                    [context.activeAllies[actorIndex], context.activeAllies[allyIndex]] = [
                        context.activeAllies[allyIndex],
                        context.activeAllies[actorIndex]
                    ];
                    moveResult.allySwitch = true;
                    messages.push(`Les deux allies echangent leur position.`);
                    return;
                }
            }
            moveResult.allySwitch = false;
            messages.push(`Interversion echoue sans allie actif.`);
            return;

        case 'quash':
            targetData.quashed = true;
            messages.push(`${getPokemonDisplayName(effectTargetPokemon)} agira en dernier.`);
            return;

        case 'charge_turn':
        case 'ohko':
            return;
        case 'no_effect':
            messages.push(`Mais rien ne se passe.`);
            return;
        default:
            if (PARTIAL_EFFECT_KINDS.has(effect.kind)) {
                messages.push(`Effet ${effect.kind} applique (implementation simplifiee).`);
                return;
            }
            messages.push(`Effet ${effect.kind} non reconnu.`);
    }
}

function processTurnStart(pokemon, options = {}) {
    const messages = [];
    if (!pokemon || safeNumber(pokemon.currentHp, 0) <= 0) {
        return { canAct: false, messages };
    }

    const move = options.move || null;
    const pokemonData = ensureBattleData(pokemon);
    const pokemonName = getPokemonDisplayName(pokemon);
    if (pokemonData.rechargeMove) {
        delete pokemonData.rechargeMove;
        if (hasPassiveAbility(pokemon,'Truant')) pokemonData.loafing = false;
        messages.push(`${pokemonName} doit recharger son énergie.`);
        return { canAct: false, messages };
    }
    if(hasPassiveAbility(pokemon,'Truant')) {
        pokemonData.loafing=!pokemonData.loafing;
        if(!pokemonData.loafing){messages.push(`${pokemonName} paresse ce tour-ci (Absentéisme).`);return {canAct:false,messages};}
    }
    if(pokemonData.flinch) {
        const bypassAbility = pokemonData.flinchBypassesAbility;
        pokemonData.flinch=false;
        delete pokemonData.flinchBypassesAbility;
        if(bypassAbility || !hasPassiveAbility(pokemon,'Inner Focus')) {messages.push(`${pokemonName} est apeuré et ne peut pas agir !`);return {canAct:false,messages};}
    }

    if (pokemonData.healBlockTurns > 0 && Array.isArray(move?.combat?.effects)
        && move.combat.effects.some((effect) => ['heal','strength_sap','purify'].includes(effect.kind))) {
        messages.push(`${pokemonName} ne peut pas utiliser ${move.ename} a cause d'Anti-Soin.`);
        return { canAct: false, messages };
    }

    if(pokemonData.soundBlockedTurns>0 && getMoveFlags(move).sound){messages.push(`${pokemonName} ne peut pas utiliser de capacité sonore (Exécu-Son).`);return {canAct:false,messages};}

    if (pokemonData.powdered) {
        pokemonData.powdered = false;
        if (move?.type === 'Fire') {
            const damage = Math.max(1, Math.floor(safeNumber(pokemon.maxHp, 1) / 4));
            const result = applyDamage(pokemon, damage, { allowEndure: false });
            messages.push(`${pokemonName} declenche la poudre et perd ${result.damageToHp} PV.`);
            return { canAct: false, messages };
        }
    }

    if (pokemonData.destinyBond && move?.ename !== 'Destiny Bond') {
        pokemonData.destinyBond = false;
    }

    if (pokemonData.disableTurns > 0 && pokemonData.disabledMove && move?.ename === pokemonData.disabledMove) {
        messages.push(`${pokemonName} ne peut pas utiliser ${pokemonData.disabledMove} (Entrave).`);
        return { canAct: false, messages };
    }

    if (pokemonData.encoreTurns > 0 && pokemonData.encoreMove && move?.ename && move.ename !== pokemonData.encoreMove) {
        messages.push(`${pokemonName} est bloque par Encore sur ${pokemonData.encoreMove}.`);
        return { canAct: false, messages };
    }

    if (pokemonData.tauntTurns > 0 && move?.combat?.damage_class === 'status') {
        messages.push(`${pokemonName} est sous Provoc et ne peut pas utiliser une capacite de statut.`);
        return { canAct: false, messages };
    }

    if (!options.charging && pokemonData.tormented && pokemonData.lastMoveUsed && move?.ename === pokemonData.lastMoveUsed) {
        messages.push(`${pokemonName} est sous Tourmente et ne peut pas rejouer ${move.ename}.`);
        return { canAct: false, messages };
    }

    if (pokemonData.infatuationTurns > 0) {
        pokemonData.infatuationTurns -= 1;
        if (Math.random() < 0.5) {
            messages.push(`${pokemonName} est paralyse par l'amour.`);
            return { canAct: false, messages };
        }
        if (pokemonData.infatuationTurns <= 0) {
            messages.push(`${pokemonName} n'est plus charme.`);
        }
    }

    if (pokemon.status === 'sleep' && !options.ignoreSleep) {
        if (pokemonData.sleepTurns <= 0) {
            pokemon.status = 'normal';
            pokemonData.sleepTurns = 0; pokemonData.nightmare = false;
            messages.push(`${pokemonName} se reveille !`);
        } else {
            pokemonData.sleepTurns -= hasPassiveAbility(pokemon,'Early Bird') ? 2 : 1;
            if (pokemonData.sleepTurns > 0) {
                messages.push(`${pokemonName} dort.`);
                if (!['Sleep Talk','Snore'].includes(move?.ename)) return { canAct: false, messages };
            } else {
                pokemon.status = 'normal';
                pokemonData.sleepTurns = 0; pokemonData.nightmare = false;
                messages.push(`${pokemonName} se reveille !`);
            }
        }
    }

    if (pokemon.status === 'freeze') {
        if (Math.random() < 0.2) {
            pokemon.status = 'normal';
            messages.push(`${pokemonName} degel.`);
        } else {
            messages.push(`${pokemonName} est gele et ne peut pas bouger.`);
            return { canAct: false, messages };
        }
    }

    if (pokemon.status === 'paralyze' && Math.random() < 0.25) {
        messages.push(`${pokemonName} est paralyse, il ne peut pas attaquer.`);
        return { canAct: false, messages };
    }

    if (pokemonData.confusionTurns > 0) {
        messages.push(`${pokemonName} est confus.`);
        pokemonData.confusionTurns -= 1;

        if (Math.random() < (1 / 3)) {
            const selfHitPower = 40;
            const pseudoMove = {
                power: selfHitPower,
                type: 'Normal',
                combat: { damage_class: 'physical', crit_stage: 0 }
            };
            const selfDamage = calculateDamageDetailed(pokemon, pokemon, pseudoMove, options).damage;
            const dmgResult = applyDamage(pokemon, selfDamage, { allowEndure: false });
            if (dmgResult.damageToHp > 0) {
                messages.push(`${pokemonName} se blesse dans sa confusion (${dmgResult.damageToHp} PV).`);
            }
            return { canAct: false, messages };
        }

        if (pokemonData.confusionTurns <= 0) {
            messages.push(`${pokemonName} n'est plus confus.`);
        }
    }

    return { canAct: true, messages };
}

function resolveWeatherDamage(pokemon, battleState, opponent = null) {
    if (!pokemon || safeNumber(pokemon.currentHp, 0) <= 0) return 0;
    if (isWeatherSuppressed(pokemon, opponent) || hasPassiveAbility(pokemon, 'Overcoat')) return 0;
    const weather = battleState?.weather?.kind;
    if (['underground','submerged'].includes(pokemon.__battle?.semiInvulnerable)) return 0;
    if (!weather) return 0;

    if (weather === 'sandstorm' && !['Sand Force', 'Sand Rush', 'Sand Veil'].includes(getPassiveAbility(pokemon))
        && !hasType(pokemon, 'Rock') && !hasType(pokemon, 'Ground') && !hasType(pokemon, 'Steel')) {
        return Math.max(1, Math.floor(safeNumber(pokemon.maxHp, 1) / 16));
    }

    if (weather === 'hail' && !['Ice Body', 'Slush Rush', 'Snow Cloak'].includes(getPassiveAbility(pokemon))
        && !hasType(pokemon, 'Ice')) {
        return Math.max(1, Math.floor(safeNumber(pokemon.maxHp, 1) / 16));
    }

    return 0;
}

function processPokemonEndTurn(pokemon, enemyPokemon, ownSide, battleState) {
    const messages = [];
    if (!pokemon || safeNumber(pokemon.currentHp, 0) <= 0) return messages;

    const pokemonData = ensureBattleData(pokemon);
    const pokemonName = getPokemonDisplayName(pokemon);
    const maxHp = Math.max(1, safeNumber(pokemon.maxHp, 1));
    const indirectDamageBlocked = hasPassiveAbility(pokemon, 'Magic Guard');

    if (pokemon.status === 'burn' && !indirectDamageBlocked) {
        const damage = Math.max(1, Math.floor(maxHp / (hasPassiveAbility(pokemon, 'Heatproof') ? 32 : 16)));
        const dmgResult = applyDamage(pokemon, damage, { allowEndure: false });
        if (dmgResult.damageToHp > 0) {
            messages.push(`${pokemonName} souffre de sa brulure (${dmgResult.damageToHp} PV).`);
        }
    }

    const poisonHeal=hasPassiveAbility(pokemon,'Poison Heal') && ['poison','badly_poison'].includes(pokemon.status);
    if(poisonHeal && !(pokemonData.healBlockTurns>0)) {
        const healed=healPokemon(pokemon,Math.max(1,Math.floor(maxHp/8)));
        if(healed)messages.push(`${pokemonName} récupère ${healed} PV avec Soin Poison.`);
    }
    if (pokemon.status === 'poison' && !indirectDamageBlocked && !poisonHeal) {
        const damage = Math.max(1, Math.floor(maxHp / 8));
        const dmgResult = applyDamage(pokemon, damage, { allowEndure: false });
        if (dmgResult.damageToHp > 0) {
            messages.push(`${pokemonName} souffre du poison (${dmgResult.damageToHp} PV).`);
        }
    }

    if (pokemon.status === 'badly_poison' && !indirectDamageBlocked && !poisonHeal) {
        const toxicCounter = Math.max(1, safeNumber(pokemonData.toxicCounter, 1));
        const damage = Math.max(1, Math.floor((maxHp / 16) * toxicCounter));
        const dmgResult = applyDamage(pokemon, damage, { allowEndure: false });
        pokemonData.toxicCounter = toxicCounter + 1;
        if (dmgResult.damageToHp > 0) {
            messages.push(`${pokemonName} souffre gravement du poison (${dmgResult.damageToHp} PV).`);
        }
    }

    if (pokemonData.leechSeedSource && safeNumber(pokemon.currentHp, 0) > 0 && !indirectDamageBlocked) {
        const drain = Math.max(1, Math.floor(maxHp / 8));
        // The seeded Pokémon stays seeded when the original user faints or
        // switches; the opposing active receives the healing when alive.
        const source = enemyPokemon || pokemonData.leechSeedSource;
        const dmgResult = applyDamage(pokemon, drain, { allowEndure: false });
        if (dmgResult.damageToHp > 0) {
            messages.push(`${pokemonName} perd ${dmgResult.damageToHp} PV a cause de Vampigraine.`);
        }
        if (dmgResult.damageToHp > 0 && source && safeNumber(source.currentHp, 0) > 0) {
            const ooze=hasPassiveAbility(pokemon,'Liquid Ooze');
            if(ooze && !hasPassiveAbility(source,'Magic Guard'))applyDamage(source,dmgResult.damageToHp,{allowEndure:false});
            const healed = ooze || source.__battle?.healBlockTurns>0 ? 0 : healPokemon(source, dmgResult.damageToHp);
            if (healed > 0) {
                messages.push(`${getPokemonDisplayName(source)} recupere ${healed} PV avec Vampigraine.`);
            }
        }
    }

    if (pokemonData.trappedTurns > 0 && safeNumber(pokemon.currentHp, 0) > 0 && !indirectDamageBlocked) {
        const trapDamage = Math.max(1, Math.floor(maxHp / 8));
        const dmgResult = applyDamage(pokemon, trapDamage, { allowEndure: false });
        pokemonData.trappedTurns -= 1;
        if (dmgResult.damageToHp > 0) {
            messages.push(`${pokemonName} est blesse par son piege (${dmgResult.damageToHp} PV).`);
        }
        if (pokemonData.trappedTurns <= 0) {
            messages.push(`${pokemonName} n'est plus piege.`);
        }
    }

    if (pokemonData.curseSource && safeNumber(pokemon.currentHp, 0) > 0 && !indirectDamageBlocked) {
        const curseDamage = Math.max(1, Math.floor(maxHp / 4));
        const dmgResult = applyDamage(pokemon, curseDamage, { allowEndure: false });
        if (dmgResult.damageToHp > 0) {
            messages.push(`${pokemonName} souffre de la malediction (${dmgResult.damageToHp} PV).`);
        }
    }

    if (pokemonData.nightmare && pokemon.status === 'sleep' && safeNumber(pokemon.currentHp, 0) > 0 && !indirectDamageBlocked) {
        const nightmareDamage = Math.max(1, Math.floor(maxHp / 4));
        const dmgResult = applyDamage(pokemon, nightmareDamage, { allowEndure: false });
        if (dmgResult.damageToHp > 0) {
            messages.push(`${pokemonName} est tourmente par un cauchemar (${dmgResult.damageToHp} PV).`);
        }
    }

    const healingAllowed = pokemonData.healBlockTurns <= 0;

    if (pokemonData.aquaRing && healingAllowed && safeNumber(pokemon.currentHp, 0) > 0) {
        const healed = healPokemon(pokemon, Math.max(1, Math.floor(maxHp / 16)));
        if (healed > 0) {
            messages.push(`${pokemonName} recupere ${healed} PV avec Anneau Hydro.`);
        }
    }

    if (pokemonData.ingrain && healingAllowed && safeNumber(pokemon.currentHp, 0) > 0) {
        const healed = healPokemon(pokemon, Math.max(1, Math.floor(maxHp / 16)));
        if (healed > 0) {
            messages.push(`${pokemonName} recupere ${healed} PV avec Racines.`);
        }
    }

    const weatherDamage = resolveWeatherDamage(pokemon, battleState, enemyPokemon);
    if (weatherDamage > 0 && !indirectDamageBlocked && safeNumber(pokemon.currentHp, 0) > 0) {
        const dmgResult = applyDamage(pokemon, weatherDamage, { allowEndure: false });
        if (dmgResult.damageToHp > 0) {
            messages.push(`${pokemonName} est touche par la meteo (${dmgResult.damageToHp} PV).`);
        }
    }

    if (battleState?.terrain?.kind === 'grassy_terrain' && healingAllowed && isGrounded(pokemon, battleState)) {
        const healed = healPokemon(pokemon, Math.max(1, Math.floor(maxHp / 16)));
        if (healed > 0) messages.push(`${pokemonName} recupere ${healed} PV grace au Champ Herbu.`);
    }

    if (healingAllowed && safeNumber(pokemon.currentHp, 0) > 0) {
        activateHeldItem(pokemon, battleState, messages, 'end_turn',enemyPokemon);
    }

    messages.push(...applyWeatherAbilityEndTurn(pokemon, enemyPokemon, battleState, {
        heal: healPokemon,
        damage: (target, amount) => indirectDamageBlocked
            ? { damageToHp: 0 }
            : applyDamage(target, amount, { allowEndure: false })
    }));
    reactions.endTurn(pokemon,enemyPokemon,battleState,reactionHelpers(),messages);
    abilityForms.sync(pokemon,'end',messages,null,battleState,enemyPokemon);
    activateHeldItem(pokemon,battleState,messages,'immediate',enemyPokemon);

    if (pokemonData.perishSongTurns > 0 && safeNumber(pokemon.currentHp, 0) > 0) {
        pokemonData.perishSongTurns -= 1;
        if (pokemonData.perishSongTurns > 0) {
            messages.push(`${pokemonName}: compte a rebours Requiem ${pokemonData.perishSongTurns}.`);
        } else {
            setPokemonHp(pokemon, 0);
            messages.push(`${pokemonName} tombe K.O. sous l'effet de Requiem.`);
        }
    }
    for(const key of ['laserFocusTurns','soundBlockedTurns'])if(pokemonData[key]>0)pokemonData[key]--;
    if (pokemonData.disableTurns > 0) {
        pokemonData.disableTurns -= 1;
        if (pokemonData.disableTurns <= 0) {
            pokemonData.disabledMove = null;
        }
    }
    if (pokemonData.tauntTurns > 0) pokemonData.tauntTurns -= 1;
    if (pokemonData.encoreTurns > 0) {
        pokemonData.encoreTurns -= 1;
        if (pokemonData.encoreTurns <= 0) {
            pokemonData.encoreMove = null;
        }
    }
    if (pokemonData.lockOnTurns > 0) {
        pokemonData.lockOnTurns -= 1;
        if (pokemonData.lockOnTurns <= 0) {
            pokemonData.lockOnTargetId = null;
        }
    }
    if (pokemonData.magnetRiseTurns > 0) pokemonData.magnetRiseTurns -= 1;
    if (pokemonData.telekinesisTurns > 0) pokemonData.telekinesisTurns -= 1;
    if (pokemonData.healBlockTurns > 0) pokemonData.healBlockTurns -= 1;
    if (pokemonData.embargoTurns > 0) pokemonData.embargoTurns -= 1;

    if (pokemonData.delayedStatus) {
        pokemonData.delayedStatus.turns -= 1;
        if (pokemonData.delayedStatus.turns <= 0) {
            applyStatus(
                pokemon,
                pokemonData.delayedStatus.status,
                ownSide,
                messages,
                { battleState }
            );
            pokemonData.delayedStatus = null;
        }
    }

    pokemonData.protect = false;
    pokemonData.endure = false;
    pokemonData.contactDamageFraction = 0;
    pokemonData.magicCoat = false;
    pokemonData.snatch = false;
    pokemonData.quashed = false;
    pokemonData.flinch = false;
    delete pokemonData.flinchBypassesAbility;

    if (ownSide?.wish) {
        ownSide.wish.turns -= 1;
        if (ownSide.wish.turns <= 0) {
            const healed = healingAllowed ? healPokemon(pokemon, ownSide.wish.amount) : 0;
            if (healed > 0) {
                messages.push(`${pokemonName} recupere ${healed} PV grace au Voeu.`);
            } else if (!healingAllowed) {
                messages.push(`Anti-Soin empeche le Voeu de soigner ${pokemonName}.`);
            }
            ownSide.wish = null;
        }
    }

    return messages;
}

function advanceBattleState(battleState) {
    const messages = [];
    if (!battleState) return messages;

    battleState.turn = Math.max(1, safeNumber(battleState.turn, 1) + 1);

    if (battleState.weather?.kind && !battleState.weather.persistent) {
        battleState.weather.turns -= 1;
        if (battleState.weather.turns <= 0) {
            messages.push(`La meteo ${battleState.weather.kind} se dissipe.`);
            battleState.weather.kind = null;
            battleState.weather.turns = 0;
        }
    }

    if (battleState.terrain?.kind) {
        battleState.terrain.turns -= 1;
        if (battleState.terrain.turns <= 0) {
            messages.push(`${battleField.LABELS[battleState.terrain.kind] || battleState.terrain.kind} se termine.`);
            battleState.terrain.kind = null;
            battleState.terrain.turns = 0;
        }
    }

    battleField.tickTimers(battleState.field, FIELD_TIMER_MAP, messages);

    for (const sideKey of Object.keys(battleState.sides || {})) {
        const side = battleState.sides[sideKey];
        if (!side) continue;

        battleField.tickTimers(side.screens, SIDE_FIELD_TIMER_MAP, messages, true);

        battleField.tickTimers(side.protectTeam,battleField.TEAM_GUARDS,messages,true);
        side.redirectionPokemonId = null;
        side.afterYouPokemonId = null;
    }

    return messages;
}

function processEndOfRound(playerPokemon, enemyPokemon, playerSide, enemySide, battleState) {
    const messages = [];
    abilityForms.syncWeatherForms(playerPokemon,enemyPokemon,battleState,messages);
    const before=[playerPokemon?.currentHp,enemyPokemon?.currentHp];
    messages.push(...processPokemonEndTurn(playerPokemon, enemyPokemon, playerSide, battleState));
    messages.push(...processPokemonEndTurn(enemyPokemon, playerPokemon, enemySide, battleState));
    for (const p of [playerPokemon,enemyPokemon]) if (p?.status==='sleep'||Number(p?.currentHp)<=0) rampage.clear(p);
    for (const [p,other] of [[playerPokemon,enemyPokemon],[enemyPokemon,playerPokemon]]) if (Number(p?.currentHp)<=0) twoTurn.clear(p,other,battleState.turn);
    for(const [p,other,hp]of [[playerPokemon,enemyPokemon,before[1]],[enemyPokemon,playerPokemon,before[0]]]) {
        if(p?.currentHp>0 && hp>0 && other?.currentHp<=0 && hasPassiveAbility(p,'Soul-Heart'))applyStageChange(p,'specialAttack',1,messages,p);
    }
    messages.push(...advanceBattleState(battleState));
    abilityForms.syncWeatherForms(playerPokemon,enemyPokemon,battleState,messages);
    return messages;
}

function switchInAbilityHelpers(pokemon, ownSide, enemySide) {
    return {
        downloadStat: (target, stat) => Math.floor(getBaseStatValue(target, stat) * stageMultiplier(ensureBattleData(target).statStages[stat] || 0)),
        clearStatus: (target, messages) => clearStatus(target, messages, null, false),
        changeStage: (target,stat,stages,messages,source) => applyStageChange(target,stat,stages,messages,source,{side:target===pokemon?ownSide:enemySide}),
        snapshotAbility: snapshotPassiveAbility,
        snapshotMoveStats: snapshotMoveAndStatOverrides,
        transform: transformPokemon,
        getMove: getMoveByName,
        isThreateningMove: (moveName, target) => {
            const move = getMoveByName(moveName);
            if (!move) return false;
            if (move.combat?.power_type === 'ohko') return true;
            const effectiveness = getPokemonTypes(target)
                .reduce((value, type) => value * getEffectiveness(move.type, type), 1);
            return safeNumber(move.power, 0) > 0 && effectiveness > 1;
        }
    };
}

function refreshChangedAbility(pokemon, opponent, ownSide, enemySide, battleState, messages) {
    abilityForms.sync(pokemon,'ability',messages,null,battleState,opponent);
    messages.push(...applySwitchInAbility(pokemon,opponent,ownSide,enemySide,battleState,switchInAbilityHelpers(pokemon,ownSide,enemySide)));
    if (opponent?.currentHp > 0 && hasPassiveAbility(opponent,'Trace')) {
        messages.push(...applySwitchInAbility(opponent,pokemon,enemySide,ownSide,battleState,switchInAbilityHelpers(opponent,enemySide,ownSide)));
    }
    abilityForms.syncWeatherForms(pokemon,opponent,battleState,messages);
}

function applySwitchInEffects(pokemon, ownSide, enemySide, battleState, enemyPokemon = null) {
    const messages = [];
    if (!pokemon || !ownSide?.hazards || safeNumber(pokemon.currentHp, 0) <= 0) {
        return messages;
    }

    const pokemonName = getPokemonDisplayName(pokemon);
    const grounded = isGrounded(pokemon, battleState);
    const hazards = ownSide.hazards;
    const bootsActive = heldItems.effect(pokemon, battleState) === 'heavy_duty_boots';

    const indirectDamageBlocked = hasPassiveAbility(pokemon, 'Magic Guard');

    if (hazards.spikes > 0 && grounded && !indirectDamageBlocked && !bootsActive) {
        const spikesDamageRatios = [0, 1 / 8, 1 / 6, 1 / 4];
        const ratio = spikesDamageRatios[clamp(hazards.spikes, 0, 3)];
        const damage = Math.max(1, Math.floor(safeNumber(pokemon.maxHp, 1) * ratio));
        const dmgResult = applyDamage(pokemon, damage, { allowEndure: false });
        if (dmgResult.damageToHp > 0) {
            messages.push(`${pokemonName} subit ${dmgResult.damageToHp} PV a cause des Spikes.`);
        }
    }

    if (hazards.stealthRock && !indirectDamageBlocked && !bootsActive) {
        let effectiveness = 1;
        for (const type of getPokemonTypes(pokemon)) {
            effectiveness *= getEffectiveness('Rock', type);
        }
        const damage = Math.max(1, Math.floor(safeNumber(pokemon.maxHp, 1) * (1 / 8) * effectiveness));
        const dmgResult = applyDamage(pokemon, damage, { allowEndure: false });
        if (dmgResult.damageToHp > 0) {
            messages.push(`${pokemonName} subit ${dmgResult.damageToHp} PV a cause de Piege de Roc.`);
        }
    }

    if (hazards.toxicSpikes > 0 && grounded && safeNumber(pokemon.currentHp, 0) > 0) {
        if (hasType(pokemon, 'Poison')) {
            hazards.toxicSpikes = 0;
            messages.push(`${pokemonName} absorbe les Toxic Spikes.`);
        } else if (!hasType(pokemon, 'Steel') && !bootsActive) {
            const status = hazards.toxicSpikes >= 2 ? 'badly_poison' : 'poison';
            applyStatus(pokemon, status, ownSide, messages, {battleState,ignoreSafeguard:true});
        }
    }

    if (hazards.stickyWeb && grounded && safeNumber(pokemon.currentHp, 0) > 0 && !bootsActive) {
        applyStageChange(pokemon, 'speed', -1, messages, enemyPokemon, {side:ownSide});
        messages.push(`${pokemonName} est ralenti par la Toile Gluante.`);
    }

    if (safeNumber(pokemon.currentHp, 0) <= 0) return messages;

    if (ownSide.pendingFullHeal) {
        const healed = healPokemon(pokemon, safeNumber(pokemon.maxHp, 1));
        clearStatus(pokemon, messages);
        ownSide.pendingFullHeal = null;
        messages.push(`${pokemonName} beneficie du voeu de soin (${healed} PV).`);
    }

    const battleData = ensureBattleData(pokemon);
    battleData.switchedInTurn=ownSide.abilityEntries>0?battleState?.turn:0;
    ownSide.abilityEntries=(ownSide.abilityEntries||0)+1;
    battleData.activeTurns=0;
    battleData.activeMoveActions=0;
    abilityForms.sync(pokemon,'entry',messages,null,battleState,enemyPokemon);
    battleData.protect = false;
    battleData.endure = false;

    messages.push(...applySwitchInAbility(pokemon, enemyPokemon, ownSide, enemySide, battleState, switchInAbilityHelpers(pokemon,ownSide,enemySide)));
    if (enemyPokemon?.currentHp > 0 && hasPassiveAbility(enemyPokemon,'Trace')) {
        messages.push(...applySwitchInAbility(enemyPokemon,pokemon,enemySide,ownSide,battleState,switchInAbilityHelpers(enemyPokemon,enemySide,ownSide)));
    }
    abilityForms.syncWeatherForms(pokemon,enemyPokemon,battleState,messages);
    activateHeldItem(pokemon,battleState,messages,'immediate',enemyPokemon);
    return messages;
}

function getPokemonMassProxy(pokemon) {
    const base = pokemon?.data?.base || {};
    const mass=reactions.traits.weights[pokemon?.data?.id] || Math.max(1,
        safeNumber(base.HP, 50)
        + safeNumber(base.Defense, 50)
        + safeNumber(base['Sp. Defense'], 50)
    );
    return mass*(hasPassiveAbility(pokemon,'Heavy Metal')?2:hasPassiveAbility(pokemon,'Light Metal')?.5:1);
}

function getLowHpPower(pokemon) {
    const ratio = Math.max(1, Math.floor(48 * safeNumber(pokemon?.currentHp, 1) / Math.max(1, safeNumber(pokemon?.maxHp, 1))));
    if (ratio < 2) return 200;
    if (ratio < 5) return 150;
    if (ratio < 10) return 100;
    if (ratio < 17) return 80;
    if (ratio < 33) return 40;
    return 20;
}

function getWeightBasedPower(attacker, defender) {
    const ratio = getPokemonMassProxy(attacker) / getPokemonMassProxy(defender);
    if (ratio >= 5) return 120;
    if (ratio >= 4) return 100;
    if (ratio >= 3) return 80;
    if (ratio >= 2) return 60;
    return 40;
}

function getSpecialMoveResolution(move, attacker, defender, options = {}) {
    if (move?.combat?.power_type !== 'special_case') return null;

    const name = move.ename;
    const attackerData = ensureBattleData(attacker);
    const defenderHp = Math.max(0, safeNumber(defender.currentHp, 0));
    const defenderMaxHp = Math.max(1, safeNumber(defender.maxHp, 1));
    const attackerSpeed = getBattleSpeed(attacker, options.attackerSide, options.battleState, defender);
    const defenderSpeed = getBattleSpeed(defender, options.defenderSide, options.battleState, attacker);
    const positiveStages = Object.values(ensureBattleData(defender).statStages)
        .reduce((sum, stage) => sum + Math.max(0, safeNumber(stage, 0)), 0);

    const damageThisTurn = attackerData.lastDamageTurn === (options.battleState?.turn ?? 1)
        && (!attackerData.lastDamageSource || attackerData.lastDamageSource === defender.uuid);
    switch (name) {
        case 'Sonic Boom': return { fixedDamage: 20 };
        case 'Dragon Rage': return { fixedDamage: 40 };
        case 'Seismic Toss':
        case 'Night Shade': return { fixedDamage: Math.max(1, safeNumber(attacker.level, 1)) };
        case 'Psywave': return { fixedDamage: Math.max(1, Math.floor(safeNumber(attacker.level, 1) * (0.5 + Math.random()))) };
        case 'Super Fang': return { fixedDamage: Math.max(1, Math.floor(defenderHp / 2)) };
        case 'Endeavor': return defenderHp > safeNumber(attacker.currentHp, 0)
            ? { fixedDamage: defenderHp - safeNumber(attacker.currentHp, 0) }
            : { failMessage: `Effort echoue.` };
        case 'Final Gambit': return { fixedDamage: Math.max(1, safeNumber(attacker.currentHp, 1)), selfFaint: true };
        case 'Counter':
            return damageThisTurn && attackerData.lastDamageClass === 'physical' && attackerData.lastDamageTaken > 0
                ? { fixedDamage: attackerData.lastDamageTaken * 2 }
                : { failMessage: `Riposte echoue: aucun degat physique a renvoyer.` };
        case 'Mirror Coat':
            return damageThisTurn && attackerData.lastDamageClass === 'special' && attackerData.lastDamageTaken > 0
                ? { fixedDamage: attackerData.lastDamageTaken * 2 }
                : { failMessage: `Voile Miroir echoue: aucun degat special a renvoyer.` };
        case 'Metal Burst':
            return damageThisTurn && attackerData.lastDamageTaken > 0
                ? { fixedDamage: Math.max(1, Math.floor(attackerData.lastDamageTaken * 1.5)) }
                : { failMessage: `Fulmifer echoue: aucun degat a renvoyer.` };
        case 'Bide':
            return attackerData.bideDamage > 0
                ? { fixedDamage: attackerData.bideDamage * 2 }
                : { failMessage: `Patience n'a encore aucun degat a renvoyer.` };
        case 'Flail':
        case 'Reversal': return { power: getLowHpPower(attacker) };
        case 'Return':
        case 'Frustration': return { power: 102 };
        case 'Low Kick':
        case 'Grass Knot': {
            const weight = getPokemonMassProxy(defender);
            return { power: weight >= 200 ? 120 : weight >= 100 ? 100 : weight >= 50 ? 80 : weight >= 25 ? 60 : weight >= 10 ? 40 : 20 };
        }
        case 'Heavy Slam':
        case 'Heat Crash': return { power: getWeightBasedPower(attacker, defender) };
        case 'Gyro Ball': return { power: clamp(Math.floor(25 * defenderSpeed / Math.max(1, attackerSpeed)) + 1, 1, 150) };
        case 'Electro Ball': {
            const ratio = attackerSpeed / Math.max(1, defenderSpeed);
            return { power: ratio >= 4 ? 150 : ratio >= 3 ? 120 : ratio >= 2 ? 80 : ratio >= 1 ? 60 : 40 };
        }
        case 'Wring Out':
        case 'Crush Grip': return { power: Math.max(1, Math.floor(120 * defenderHp / defenderMaxHp) + 1) };
        case 'Stored Power':
        case 'Power Trip': return {power:20+20*Object.entries(attackerData.statStages).reduce((n,[key,v])=>n+(key==='critical'?0:Math.max(0,safeNumber(v,0))),0)};
        case 'Burn Up': return hasType(attacker,'Fire')?{power:130}:{failMessage:'Flamme Ultime échoue : le lanceur doit être de type Feu.'};
        case 'Stomping Tantrum': return {power:attackerData.lastMoveFailed && attackerData.lastMoveResultTurn===(options.battleState?.turn??1)-1?150:75};
        case 'Punishment': return { power: clamp(60 + positiveStages * 20, 60, 200) };
        case 'Magnitude': {
            const roll = Math.random();
            if (roll < 0.05) return { power: 10 };
            if (roll < 0.15) return { power: 30 };
            if (roll < 0.35) return { power: 50 };
            if (roll < 0.65) return { power: 70 };
            if (roll < 0.85) return { power: 90 };
            if (roll < 0.95) return { power: 110 };
            return { power: 150 };
        }
        case 'Present': {
            const roll = Math.random();
            if (roll < 0.2) return { healDefender: Math.max(1, Math.floor(defenderMaxHp / 4)) };
            if (roll < 0.6) return { power: 40 };
            if (roll < 0.9) return { power: 80 };
            return { power: 120 };
        }
        case 'Beat Up': {
            const team = Array.isArray(options.attackerTeam) ? options.attackerTeam : [attacker];
            const hitPowers = team.filter(p => p === attacker || (p.currentHp > 0 && (!p.status || p.status === 'normal')))
                .map(p => 5 + Math.floor(safeNumber(p.data?.base?.Attack, 50) / 10));
            return {power: hitPowers[0] || 5, hitPowers};
        }
        case 'Spit Up': {
            const stockpile = clamp(attackerData.stockpileCount, 0, 3);
            if (stockpile <= 0) return { failMessage: `Relache echoue: aucune energie stockee.` };
            attackerData.stockpileCount = 0;
            return { power: stockpile * 100 };
        }
        case 'Natural Gift': {
            const item = getItemDefinition(attacker.heldItem);
            return item?.natural_gift_power
                ? { power: item.natural_gift_power, consumeHeldItem: true }
                : { failMessage: `Aucune baie ne peut alimenter Don Naturel.` };
        }
        case 'Fling': {
            const item = getItemDefinition(attacker.heldItem);
            return item
                ? { power: Math.max(1, safeNumber(item.fling_power, 30)), consumeHeldItem: true }
                : { failMessage: `Aucun objet ne peut etre lance.` };
        }
        case 'Trump Card': {
            const pp = getMovePp(attacker, options.sourceMove || move.ename)?.current;
            return { power: pp === 0 ? 200 : pp === 1 ? 80 : pp === 2 ? 60 : pp === 3 ? 50 : 40 };
        }
        case 'Sticky Web':
        case 'Venom Drench':
        case 'Curse': return { statusOnly: true };
        default: return { unsupported: true, failMessage: `La capacite ${name} n'a pas encore de regle de degats.` };
    }
}

function applyImplicitMoveEffect(move, context, moveResult) {
    if (move.ename === 'Venom Drench') {
        if (['poison', 'badly_poison'].includes(context.defender.status)) {
            applyStageChange(context.defender, 'attack', -1, moveResult.messages);
            applyStageChange(context.defender, 'specialAttack', -1, moveResult.messages);
            applyStageChange(context.defender, 'speed', -1, moveResult.messages);
        } else {
            moveResult.messages.push(`Detrempage echoue: la cible n'est pas empoisonnee.`);
        }
    }

    if (['U-turn', 'Volt Switch', 'Flip Turn'].includes(move.ename) && (moveResult.damage + moveResult.substituteDamage) > 0) {
        moveResult.switchSelf = true;
        moveResult.messages.push(`${getPokemonDisplayName(context.attacker)} revient apres son attaque.`);
    }
}

function reactionHelpers(context = {}) {
    return {damage:applyDamage,heal:healPokemon,status:applyStatus,clearStatus,clearMajorStatus:(p,m)=>clearStatus(p,m,null,false),stage:(target,stat,stages,messages,source)=>applyStageChange(target,stat,stages,messages,source,{side:target===context.attacker?context.attackerSide:context.defenderSide}),
        types:getPokemonTypes,base:getBaseStatValue,snapshotAbility:snapshotPassiveAbility,snapshotItem:snapshotHeldItemForExchange,
        recycle:(p,messages)=>applyEffect({kind:'recycle'},{attacker:p,defender:p,move:{}},{messages})};
}

// Sacrifice is not recoil: it bypasses Endure, Sturdy, substitutes and held items.
function finishSelfDestruct(attacker, result) {
    if (result.selfDestruct && safeNumber(attacker?.currentHp, 0) > 0) {
        setPokemonHp(attacker, 0);
        result.messages.push(`${getPokemonDisplayName(attacker)} se met K.O. !`);
    }
}

function useattack(attackName, attacker, defender, options = {}) {
    options={...options,battleState:options.battleState||createBattleState()};
    const rampageBefore=rampage.current(attacker);
    if (!options.calledDepth && !options.skipTurnStart) turnActions.spendTurnAction(options.battleState, attacker);
    // Called moves and the internal Struggle fallback are part of the same action.
    if (attacker && !options.calledDepth && !options.skipTurnStart && !options.actionCounted) {
        const data = ensureBattleData(attacker);
        data.activeMoveActions += 1;
        options.actionCounted = true;
    }
    const before=[];
    abilityForms.syncWeatherForms(attacker,defender,options.battleState,before);
    const result=executeAttack(attackName,attacker,defender,options);
    rampage.finish(attacker,result.moveName,{before:rampageBefore,
        hit:result.success&&result.hits>0&&result.effectiveness>0&&!result.missed&&!result.blocked&&!result.actionPrevented,
        eligible:!options.danced&&options.sourceMove!=='Sleep Talk',messages:result.messages,
        confuse:()=>{
            applyStatus(attacker,'confusion',options.attackerSide,result.messages,{attacker,battleState:options.battleState,
                ignoreSafeguard:true,turns:1+Math.floor(Math.random()*4)});
            activateHeldItem(attacker,options.battleState,result.messages,'immediate',defender);
        }});
    if (result.moveName === 'Bide' && !result.success && attacker?.__battle) delete attacker.__battle.bideTurns;
    if (attacker?.__battle && !(attacker.__battle.bideTurns > 0)) delete attacker.__battle.bideDamage;
    if(attacker && !options.calledDepth && !options.skipTurnStart){const data=ensureBattleData(attacker);data.lastMoveFailed=(!result.success||(result.move?.combat?.damage_class!=='status'&&result.effectiveness===0))&&!result.protected&&result.phase!=='prepare'&&!data.rechargeMove;data.lastMoveResultTurn=options.battleState.turn;}
    // Misses, protection and immunities return early but still cost the user its life.
    finishSelfDestruct(attacker,result);
    for (const [p,other] of [[attacker,defender],[defender,attacker]]) if (Number(p?.currentHp)<=0) {twoTurn.clear(p,other,options.battleState.turn);rampage.clear(p);}
    result.messages.unshift(...before);
    abilityForms.syncWeatherForms(attacker,defender,options.battleState,result.messages);
    return result;
}

function movePhase(pokemon, moveName, battleState, opponent) {
    if (getChargingMove(pokemon)) return 'strike';
    const move = getMoveByName(moveName);
    if (move?.combat?.power_type !== 'charge') return null;
    if (twoTurn.rule(moveName)?.solar && battleState?.weather?.kind === 'sun' && !isWeatherSuppressed(pokemon,opponent)) return null;
    return 'prepare';
}

function executeAttack(attackName, attacker, defender, options = {}) {
    const battleState = options.battleState || createBattleState();
    const attackerSide = options.attackerSide || createSideState('attacker');
    const defenderSide = options.defenderSide || createSideState('defender');
    const attackerTeam = options.attackerTeam || null;
    const defenderTeam = options.defenderTeam || null;
    const calledDepth = Math.max(0, safeNumber(options.calledDepth, 0));
    const charging = !calledDepth && !options.skipTurnStart && getChargingMove(attacker);
    const rampaging = !calledDepth && !options.skipTurnStart && rampage.current(attacker);
    const biding = !calledDepth && !options.skipTurnStart && attacker?.__battle?.bideTurns > 0;
    if (charging) attackName = charging;
    else if (rampaging) attackName = rampaging.move;
    else if (biding) attackName = 'Bide';

    const moveResult = {
        success: false,
        moveName: attackName || 'attaque',
        move: null,
        damage: 0,
        substituteDamage: 0,
        hits: 0,
        critical: false,
        effectiveness: 1,
        missed: false,
        blocked: false,
        forceSwitch: false,
        switchSelf: false,
        escape: false,
        messages: []
    };

    if (!attacker || !defender) {
        moveResult.messages.push('Attaque impossible.');
        return moveResult;
    }

    if (safeNumber(attacker.currentHp, 0) <= 0) {
        moveResult.messages.push(`${getPokemonDisplayName(attacker)} est K.O. et ne peut pas attaquer.`);
        return moveResult;
    }

    let move = resolveWeatherMove(getMoveByName(attackName),attacker,defender,battleState);
    if (!move) {
        moveResult.messages.push(`Attaque inconnue: ${attackName}.`);
        return moveResult;
    }

    moveResult.move = move;
    moveResult.moveName = move.ename;

    const attackerData = ensureBattleData(attacker);
    const defenderData = ensureBattleData(defender);
    if (!calledDepth && !options.skipTurnStart && attackerData.rechargeMove) {
        attackerData.lastActionTurn = battleState.turn;
        moveResult.beforeActionMessages = processTurnStart(attacker, {move,battleState}).messages;
        moveResult.messages.push(...moveResult.beforeActionMessages);
        moveResult.actionPrevented = true;
        return moveResult;
    }
    const carriedTarget = attackerData.skyDropTarget;
    // Remain hidden until this action, then reappear even if sleep, flinch,
    // paralysis, Entrave, a miss or Protect interrupts the release.
    if (charging) twoTurn.clear(attacker,defender,battleState.turn);
    if (charging === 'Sky Drop' && carriedTarget && carriedTarget !== defender.uuid) {
        moveResult.blocked = true; moveResult.messages.push('La cible de Chute Libre n’est plus en combat.'); return moveResult;
    }
    if (attackerData.skyDropBy || attackerData.skyDropSkipTurn === battleState.turn) {
        moveResult.blocked = true;
        moveResult.messages.push(`${getPokemonDisplayName(attacker)} est emporté dans les airs et ne peut pas agir.`);
        return moveResult;
    }
    if (attackerData.chargeInterruptedTurn === battleState.turn) {
        moveResult.blocked = true; moveResult.messages.push(`${getPokemonDisplayName(attacker)} a été interrompu et ne peut pas terminer son attaque.`); return moveResult;
    }
    const hpBeforeMove=defender.currentHp;
    let lastHitDamage = 0;
    const helper=reactionHelpers({attacker,attackerSide,defenderSide});
    const hit=(amount,critical=false,resistBerry=null) => {
        const result=applyDamage(defender,amount,{allowEndure:true,attacker,battleState,
            bypassSubstitute:moveGuards.bypassesSubstitute(attacker,move)});
        if (resistBerry && result.damageToHp > 0 && defender.heldItem === resistBerry) {
            const name = getItemDefinition(resistBerry).name;
            consumeBerry(defender,battleState,moveResult.messages);
            moveResult.messages.push(`${getPokemonDisplayName(defender)} réduit les dégâts avec ${name}.`);
        }
        if (result.damageToHp > 0) lastHitDamage = result.damageToHp;
        reactions.afterHit({attacker,defender,move,damage:result.damageToHp,critical,battleState,attackerSide,defenderSide},helper,moveResult.messages);
        activateHeldItem(defender,battleState,moveResult.messages,'immediate',attacker);
        return result;
    };
    const movedLastThisTurn = defenderData.lastActionTurn === safeNumber(battleState.turn, 1);
    if(!options.skipTurnStart)attackerData.lastActionTurn = safeNumber(battleState.turn, 1);

    if (!calledDepth && !options.skipTurnStart && !heldItems.allowsMove(attacker, move.ename, battleState)) {
        if (options.consumePp !== false && getUsableMoveIndexes(attacker, battleState).length === 0) {
            return useattack('Struggle', attacker, defender, { ...options, consumePp:false });
        }
        moveResult.blocked = true; moveResult.messages.push('Cette capacité est bloquée par l’objet tenu.'); return moveResult;
    }

    if (defenderData.imprison && Array.isArray(defender.abilities) && defender.abilities.includes(move.ename)) {
        moveResult.blocked = true;
        moveResult.messages.push(`${move.ename} est scelle par Possessif.`);
        return moveResult;
    }

    if (options.consumePp !== false && !charging && !biding && !rampaging) {
        const ppState = getMovePp(attacker, move.ename);
        if (ppState && ppState.current <= 0) {
            if (getUsableMoveIndexes(attacker, battleState).length === 0 && move.ename !== 'Struggle') {
                const struggleResult = useattack('Struggle', attacker, defender, {
                    ...options,
                    battleState,
                    attackerSide,
                    defenderSide,
                    attackerTeam,
                    defenderTeam,
                    consumePp: false
                });
                struggleResult.messages.unshift(`${getPokemonDisplayName(attacker)} n'a plus de PP et utilise Lutte.`);
                return struggleResult;
            }
            moveResult.blocked = true;
            moveResult.messages.push(`${move.ename} n'a plus de PP.`);
            return moveResult;
        }
    }

    if (attackerData.electrified || (battleState.field?.ionDelugeTurns > 0 && move.type === 'Normal')) {
        attackerData.electrified = false;
        move = { ...move, type: 'Electric' };
        moveResult.move = move;
        moveResult.messages.push(`${move.ename} devient de type Electrik.`);
    }

    const abilityMove = transformMoveForAbility(attacker, move);
    move = abilityMove.move;
    const abilityPowerMultiplier = abilityMove.powerMultiplier;
    moveResult.move = move;

    const startTurn = options.skipTurnStart ? { canAct: true, messages: [] } : processTurnStart(attacker, {
        move,
        attackerSide,
        defenderSide,
        battleState,
        ignoreSleep: Boolean(options.ignoreSleep),
        charging: Boolean(charging||rampaging)
    });
    moveResult.beforeActionMessages = [...startTurn.messages];
    moveResult.messages.push(...startTurn.messages);
    if (!startTurn.canAct || safeNumber(attacker.currentHp, 0) <= 0) {
        moveResult.actionPrevented = true;
        delete attackerData.bideTurns;
        delete attackerData.bideDamage;
        attackerData.lastMoveUsed = move.ename;
        return moveResult;
    }
    if(options.consumePp!==false && !charging && !biding && !rampaging) {
        const consumed=consumeMovePp(attacker,move.ename);
        if(consumed.consumed) {
            attackerData.lastMoveSlot=consumed.slot;
            if(hasPassiveAbility(defender,'Pressure') && !['self','self_side','field','ally','self_or_ally'].includes(move.combat?.target))reduceMovePp(attacker,move.ename,1);
        }
    }
    abilityForms.sync(attacker,'move',moveResult.messages,move,battleState,defender);
    if (!calledDepth && !options.skipTurnStart) heldItems.lockMove(attacker, move.ename, battleState);

    if (['Fake Out','First Impression'].includes(move.ename) && attackerData.activeMoveActions > 1) {
        moveResult.blocked = true;
        attackerData.lastMoveUsed = move.ename;
        moveResult.messages.push(`${move.ename==='Fake Out'?'Bluff':'Escarmouche'} échoue : utilisable uniquement lors de la première action après l’entrée en combat.`);
        return moveResult;
    }
    if (move.ename === 'Mat Block' && attackerData.activeMoveActions > 1) {
        moveResult.blocked=true;moveResult.messages.push('Tatamigaeshi échoue : utilisable uniquement juste après l’entrée en combat.');return moveResult;
    }
    if (['Sleep Talk','Snore'].includes(move.ename) && attacker.status !== 'sleep' && !hasPassiveAbility(attacker,'Comatose')) {
        moveResult.messages.push('Cette capacité nécessite de dormir.');
        return moveResult;
    }
    if (move.ename === 'Bide') {
        if (!biding) {
            attackerData.bideTurns = 2;
            attackerData.bideDamage = 0;
        } else attackerData.bideTurns--;
        if (attackerData.bideTurns > 0) {
            moveResult.success = true;
            attackerData.lastMoveUsed = move.ename;
            moveResult.messages.push(`${getPokemonDisplayName(attacker)} accumule de l’énergie avec Patience.`);
            return moveResult;
        }
        moveResult.messages.push(`${getPokemonDisplayName(attacker)} libère l’énergie de Patience !`);
    }

    if (['Self-Destruct', 'Explosion'].includes(move.ename)) {
        // Resolve Damp before Protect/accuracy/immunity; a prevented explosion
        // consumes PP, but a Pokémon unable to act never reaches this point.
        const damp = hasPassiveAbility(attacker, 'Damp') ? attacker
            : !ignoresDefenderAbility(attacker, defender) && hasPassiveAbility(defender, 'Damp') ? defender : null;
        if (damp) {
            moveResult.blocked = true;
            moveResult.abilityBlocked = true;
            attackerData.lastMoveUsed = move.ename;
            moveResult.messages.push(`Moiteur de ${getPokemonDisplayName(damp)} empêche l’explosion.`);
            return moveResult;
        }
        moveResult.selfDestruct = true;
    }

    if (move.ename === 'Sucker Punch') {
        const pending = getMoveByName(turnActions.pendingMove(battleState, defender));
        const category = pending?.combat?.damage_class || (pending?.category === 'phy' ? 'physical' : pending?.category === 'spe' ? 'special' : 'status');
        if (!pending || (category === 'status' && pending.ename !== 'Me First')) {
            moveResult.blocked = true;
            attackerData.lastMoveUsed = move.ename;
            moveResult.messages.push('Coup Bas échoue : la cible ne prépare plus d’attaque offensive.');
            return moveResult;
        }
    }

    const chargeRule = twoTurn.rule(move.ename);
    if (chargeRule?.gravity && battleState.field?.gravityTurns > 0) {
        moveResult.blocked = true;
        moveResult.messages.push(`${move.ename} est impossible sous Gravité.`);
        return moveResult;
    }
    if (move.combat?.power_type === 'charge' && !charging) {
        if (move.ename === 'Sky Drop' && (defenderData.substituteHp > 0 || getPokemonMassProxy(defender) >= 200 || defenderData.semiInvulnerable || isMoveBlockedByProtect(defender,defenderSide,move,attacker))) {
            moveResult.blocked = true; moveResult.messages.push('Impossible d’emporter cet adversaire avec Chute Libre.'); return moveResult;
        }
        if (chargeRule?.defense) applyStageChange(attacker,'defense',1,moveResult.messages,attacker);
        const sunny = chargeRule?.solar && battleState.weather?.kind === 'sun' && !isWeatherSuppressed(attacker,defender);
        if (!sunny) {
            attackerData.chargeMove = move.ename;
            attackerData.chargeTurns = 1;
            attackerData.semiInvulnerable = chargeRule?.state || null;
            if (move.ename === 'Sky Drop') {
                attackerData.skyDropTarget = defender.uuid;
                defenderData.skyDropBy = attacker.uuid; defenderData.semiInvulnerable = 'airborne';
            }
            moveResult.success = true;
            moveResult.phase = 'prepare';
            moveResult.messages.push(`${getPokemonDisplayName(attacker)} ${chargeRule?.prepare || `se prépare pour ${move.ename}`}.`);
            attackerData.lastMoveUsed = move.ename;
            return moveResult;
        }
    }
    if (charging) moveResult.phase = 'strike';
    if (move.ename === 'Sky Drop' && charging && hasType(defender,'Flying')) {
        moveResult.effectiveness = 0; moveResult.messages.push('Chute Libre est sans effet sur un Pokémon de type Vol.'); return moveResult;
    }

    const moveTarget = move?.combat?.target || 'single';
    const damageClass = move?.combat?.damage_class || (move?.category === 'phy' ? 'physical' : move?.category === 'spe' ? 'special' : 'status');
    const moveTargetsOpponent = ![
        'self',
        'self_side',
        'field',
        'ally',
        'self_or_ally',
        'plus_minus_allies',
        'grass_grounded_allies'
    ].includes(moveTarget);

    const moveTargetsPokemon = moveTargetsOpponent && moveTarget !== 'opponent_side';
    const reflectable=Boolean(reactions.traits.moves[move.ename]?.reflectable);
    const magicBounce=reflectable && hasPassiveAbility(defender,'Magic Bounce') && !ignoresDefenderAbility(attacker,defender);
    if (reflectable && damageClass === 'status' && move.ename !== 'Curse' && moveTargetsOpponent && (defenderData.magicCoat || magicBounce) && !options.reflected) {
        if(!magicBounce)defenderData.magicCoat = false;
        moveResult.success = true;
        moveResult.messages.push(`${getPokemonDisplayName(defender)} renvoie ${move.ename} avec ${magicBounce?'Miroir Magik':'Reflet Magik'}.`);
        const reflectedResult = useattack(move.ename, defender, attacker, {
            battleState,
            attackerSide: defenderSide,
            defenderSide: attackerSide,
            attackerTeam: defenderTeam,
            defenderTeam: attackerTeam,
            consumePp: false,
            skipTurnStart: true,
            reflected: true
        });
        moveResult.messages.push(...reflectedResult.messages);
        attackerData.lastMoveUsed = move.ename;
        return moveResult;
    }

    const beneficialSelfMove = damageClass === 'status' && ['self', 'self_side'].includes(moveTarget);
    if (beneficialSelfMove && move.ename !== 'Curse' && defenderData.snatch && !options.snatched) {
        defenderData.snatch = false;
        moveResult.success = true;
        moveResult.messages.push(`${getPokemonDisplayName(defender)} vole ${move.ename}.`);
        const snatchedResult = useattack(move.ename, defender, attacker, {
            battleState,
            attackerSide: defenderSide,
            defenderSide: attackerSide,
            attackerTeam: defenderTeam,
            defenderTeam: attackerTeam,
            consumePp: false,
            skipTurnStart: true,
            snatched: true
        });
        moveResult.messages.push(...snatchedResult.messages);
        attackerData.lastMoveUsed = move.ename;
        return moveResult;
    }

    if (moveTargetsPokemon && !moveGuards.breaksProtection(move) && isMoveBlockedByProtect(defender, defenderSide, move,attacker)) {
        moveResult.blocked = true;moveResult.protected=true;
        moveResult.messages.push(`${getPokemonDisplayName(defender)} bloque l'attaque.`);
        if (safeNumber(defenderData.contactDamageFraction, 0) > 0 && damageClass !== 'status' && reactions.contact(attacker,move) && !hasPassiveAbility(attacker,'Magic Guard')) {
            const recoil = Math.max(1, Math.floor(safeNumber(attacker.maxHp, 1) * defenderData.contactDamageFraction));
            const recoilResult = applyDamage(attacker, recoil, { allowEndure: false });
            if (recoilResult.damageToHp > 0) {
                moveResult.messages.push(`${getPokemonDisplayName(attacker)} subit ${recoilResult.damageToHp} PV au contact du bouclier.`);
            }
        }
        attackerData.lastMoveUsed = move.ename;
        return moveResult;
    }

    // Always-hit accuracy alone (Swift, rain Thunder…) does not bypass a
    // semi-invulnerable turn. No Guard and Lock-On do, as do named counters.
    const lockedOn = attackerData.lockOnTurns > 0 && attackerData.lockOnTargetId === (defender.uuid || getPokemonDisplayName(defender));
    const noGuard = hasPassiveAbility(attacker,'No Guard') || (!ignoresDefenderAbility(attacker,defender) && hasPassiveAbility(defender,'No Guard'));
    const hiddenRule = twoTurn.rule(defenderData.chargeMove) || (defenderData.skyDropBy ? twoTurn.rule('Sky Drop') : null);
    const hitsHidden = !defenderData.semiInvulnerable || noGuard || lockedOn || hiddenRule?.hits?.[move.ename];
    if (moveTargetsPokemon && !hitsHidden) {
        moveResult.missed = true; attackerData.lastMoveUsed = move.ename;
        moveResult.messages.push(`${getPokemonDisplayName(defender)} est hors de portée de ${move.ename}.`); return moveResult;
    }
    const accuracy = weatherMoveAccuracy(move, attacker, defender, battleState);
    let attackHits = true;
    let hitChance = 1;
    let perHitSecondaries = false;
    if (accuracy > 0) {
        const lockOnActive = attackerData.lockOnTurns > 0 && attackerData.lockOnTargetId && attackerData.lockOnTargetId === (defender.uuid || getPokemonDisplayName(defender));
        if (!lockOnActive) {
            let baseAccuracy = accuracy / 100;
            if (damageClass === 'status' && hasPassiveAbility(defender,'Wonder Skin') && !ignoresDefenderAbility(attacker,defender)) baseAccuracy = .5;
            if (move.combat?.power_type === 'ohko') {
                const levelDifference = safeNumber(attacker.level, 1) - safeNumber(defender.level, 1);
                baseAccuracy = levelDifference < 0 ? 0 : (30 + levelDifference) / 100;
            }
            const abilityAccuracy = getAbilityAccuracyMultiplier(attacker, defender, move, battleState);
            const chance = abilityAccuracy === Infinity
                ? 1
                : clamp(baseAccuracy * getAccuracyModifier(attacker, defender) * abilityAccuracy * (battleState.field?.gravityTurns > 0 && move.combat?.power_type !== 'ohko' ? 5/3 : 1) + drift.accuracy(attacker), 0, 1);
            hitChance = chance;
            attackHits = Math.random() < hitChance;
        }
    }

    if (!attackHits) {
        moveResult.missed = true;
        moveResult.messages.push(`${getPokemonDisplayName(attacker)} rate son attaque.`);
        attackerData.lastMoveUsed = move.ename;
        return moveResult;
    }

    if (['Brick Break','Psychic Fangs'].includes(move.ename) && getPokemonTypes(defender).every(type=>getEffectiveness(move.type,type)>0)) {
        if(battleField.clearScreens(defenderSide,['reflectTurns','lightScreenTurns','auroraVeilTurns'])) moveResult.messages.push(`${move.ename==='Brick Break'?'Casse-Brique':'Psycho-Croc'} brise les écrans adverses !`);
    }

    if (moveTargetsPokemon) {
        const abilityEffectiveness = getPokemonTypes(defender)
            .reduce((value, type) => value * getEffectiveness(move.type, type), 1);
        const blockedByAbility = resolveMoveAbilityImmunity({
            attacker,
            defender,
            move,
            battleState,
            movePriority: getMovePriority(move.ename, attacker),
            grounded: isGrounded(defender,battleState),
            effectiveness: abilityEffectiveness,
            isAllyHit: Boolean(options.isAllyHit),
            heal: healPokemon,
            changeStage: applyStageChange,
            messages: moveResult.messages
        });
        if (blockedByAbility) {
            moveResult.blocked = true;
            moveResult.abilityBlocked = true;
            attackerData.lastMoveUsed = move.ename;
            return moveResult;
        }
    }

    const specialResolution = getSpecialMoveResolution(move, attacker, defender, { attackerTeam, defenderTeam, attackerSide, defenderSide, battleState, sourceMove: options.sourceMove });

    if (damageClass !== 'status') {
        if (move.combat?.power_type === 'ohko') {
            const effectiveness = move.ename === 'Bide' ? 1 : getPokemonTypes(defender)
                .reduce((value, type) => value * getEffectiveness(move.type, type), 1);
            if (effectiveness <= 0) {
                moveResult.messages.push(`Ca n'affecte pas ${getPokemonDisplayName(defender)}.`);
            } else if (!ignoresDefenderAbility(attacker, defender) && hasPassiveAbility(defender, 'Sturdy')) {
                moveResult.messages.push(`${getPokemonDisplayName(defender)} resiste grace a Fermete.`);
            } else {
                const hpBefore = safeNumber(defender.currentHp, 0);
                const fatal = hit(hpBefore);
                moveResult.success = true;
                moveResult.damage = fatal.damageToHp;
                moveResult.substituteDamage = fatal.damageToSubstitute;
                moveResult.hits = 1;
                moveResult.messages.push(defender.currentHp > 0 ? `${getPokemonDisplayName(defender)} survit au coup fatal !` : `Coup fatal ! ${getPokemonDisplayName(defender)} est K.O.`);
            }
        } else if (specialResolution?.failMessage) {
            moveResult.messages.push(specialResolution.failMessage);
        } else if (specialResolution?.healDefender) {
            const healed = healPokemon(defender, specialResolution.healDefender);
            moveResult.success = true;
            moveResult.messages.push(`${getPokemonDisplayName(defender)} recupere ${healed} PV avec Cadeau.`);
        } else if (Number.isFinite(specialResolution?.fixedDamage)) {
            const effectiveness = move.ename === 'Bide' ? 1 : getPokemonTypes(defender)
                .reduce((value, type) => value * getEffectiveness(move.type, type), 1);
            if (effectiveness <= 0) {
                moveResult.effectiveness = 0;
                moveResult.messages.push(`Ca n'affecte pas ${getPokemonDisplayName(defender)}.`);
            } else {
                const dmgResult = hit(specialResolution.fixedDamage);
                moveResult.success = true;
                moveResult.damage = dmgResult.damageToHp;
                moveResult.substituteDamage = dmgResult.damageToSubstitute;
                moveResult.hits = 1;
                moveResult.effectiveness = effectiveness;
                if (dmgResult.damageToHp > 0) {
                    moveResult.messages.push(`${getPokemonDisplayName(defender)} perd ${dmgResult.damageToHp} PV.`);
                }
            }
            if (specialResolution.selfFaint && moveResult.success) {
                setPokemonHp(attacker, 0);
                moveResult.messages.push(`${getPokemonDisplayName(attacker)} se met K.O. !`);
            }
        } else {
            const resolvedMove = move.ename==='Water Shuriken' && attacker.__battle?.abilityForm==='Greninja-Ash' ? {...move,power:20} : Number.isFinite(specialResolution?.power)
                ? { ...move, power: specialResolution.power }
                : move;
            const hits = specialResolution?.hitPowers?.length || resolveHitCount(resolvedMove,attacker);
            perHitSecondaries = Boolean(reactions.traits.moves[move.ename]?.multihit);
            const repeatAccuracy = reactions.traits.moves[move.ename]?.multiaccuracy && !hasPassiveAbility(attacker, 'Skill Link');
            let totalDamage = 0;
            let hitCount = 0;
            let criticalHit = false;
            let effectiveness = 1;

            for (let hitIndex = 0; hitIndex < hits; hitIndex++) {
                if (safeNumber(defender.currentHp, 0) <= 0 || safeNumber(attacker.currentHp, 0) <= 0) break;

                if (hitIndex > 0 && repeatAccuracy && Math.random() >= hitChance) break;
                const hitMove = specialResolution?.hitPowers ? {...resolvedMove, power:specialResolution.hitPowers[hitIndex]} : move.ename === 'Triple Kick' ? { ...resolvedMove, power: 10 * (hitIndex + 1) } : resolvedMove;
                const damageInfo = calculateDamageDetailed(attacker, defender, hitMove, {
                    battleState,
                    attackerSide,
                    defenderSide,
                    movedLast: Boolean(options.movedLast) || movedLastThisTurn,
                    abilityPowerMultiplier
                });

                effectiveness = damageInfo.effectiveness;
                if (effectiveness === 0) break;
                const dmgResult = hit(damageInfo.damage,damageInfo.critical,damageInfo.resistBerry);
                if (perHitSecondaries) reactions.secondaryEffects({ attacker, defender, move: hitMove,
                    result: { damage: dmgResult.damageToHp, substituteDamage: dmgResult.damageToSubstitute }, battleState, attackerSide, defenderSide }, helper, moveResult.messages);
                if (dmgResult.damageToHp > 0 && reactions.contact(attacker,resolvedMove) && heldItems.effect(defender, battleState) === 'rocky_helmet' && !hasPassiveAbility(attacker, 'Magic Guard')) {
                    const recoil = applyDamage(attacker, Math.max(1, Math.floor(attacker.maxHp / 6)), { allowEndure:false });
                    moveResult.messages.push(`${getPokemonDisplayName(attacker)} perd ${recoil.damageToHp} PV contre le Casque Brut.`);
                }
                totalDamage += dmgResult.damageToHp;
                moveResult.substituteDamage += dmgResult.damageToSubstitute;
                hitCount += 1;
                effectiveness = damageInfo.effectiveness;
                criticalHit = criticalHit || damageInfo.critical;

                if (dmgResult.endured) {
                    moveResult.messages.push(`${getPokemonDisplayName(defender)} résiste grâce à ${dmgResult.enduredBy || 'Endure'} !`);
                }
                if(dmgResult.disguiseBroken)moveResult.messages.push(`${getPokemonDisplayName(defender)} encaisse le coup avec Fantômasque !`);
                if (dmgResult.damageToSubstitute > 0) {
                    moveResult.messages.push(`Le clone de ${getPokemonDisplayName(defender)} encaisse ${dmgResult.damageToSubstitute} degats.`);
                    if (dmgResult.substituteBroken) {
                        moveResult.messages.push(`Le clone de ${getPokemonDisplayName(defender)} est detruit.`);
                    }
                }
            }

            moveResult.success = true;
            moveResult.damage = totalDamage;
            moveResult.hits = hitCount;
            moveResult.critical = criticalHit;
            moveResult.effectiveness = effectiveness;

            if (hitCount > 1) {
                moveResult.messages.push(`L'attaque touche ${hitCount} fois.`);
            }

            if (effectiveness === 0) {
                moveResult.messages.push(`Ca n'affecte pas ${getPokemonDisplayName(defender)}.`);
            } else if (effectiveness > 1) {
                moveResult.messages.push(`C'est super efficace.`);
            } else if (effectiveness > 0 && effectiveness < 1) {
                moveResult.messages.push(`Ce n'est pas tres efficace.`);
            }

            if (criticalHit) {
                moveResult.messages.push(`Coup critique !`);
            }

            if (totalDamage > 0) {
                moveResult.messages.push(`${getPokemonDisplayName(defender)} perd ${totalDamage} PV.`);
            }
        }
    } else {
        moveResult.success = true;
    }

    if (moveResult.damage > 0) {
        defenderData.lastDamageTurn = battleState.turn;
        defenderData.lastDamageSource = attacker.uuid;
        defenderData.lastDamageTaken = lastHitDamage;
        if (defenderData.bideTurns > 0) defenderData.bideDamage = (defenderData.bideDamage || 0) + moveResult.damage;
        defenderData.lastDamageClass = damageClass;
        defenderData.lastDamageType = move.type;
        if (safeNumber(defender.currentHp, 0) <= 0 && defenderData.destinyBond) {
            setPokemonHp(attacker, 0);
            moveResult.messages.push(`${getPokemonDisplayName(attacker)} est emporte par Lien du Destin.`);
        }
        if (safeNumber(defender.currentHp, 0) <= 0 && defenderData.grudge) {
            const removed = reduceMovePp(attacker, move.ename, 999);
            if (removed > 0) moveResult.messages.push(`Rancune retire tous les PP de ${move.ename}.`);
            defenderData.grudge = false;
        }
    }

    if (specialResolution?.consumeHeldItem && moveResult.hits > 0 && moveResult.effectiveness > 0) {
        const consumedItem = consumeHeldItem(attacker,battleState);
        if (consumedItem) moveResult.messages.push(`${getPokemonDisplayName(attacker)} consomme son objet avec ${move.ename}.`);
    }

    // Successful explosions sacrifice before post-move healing/reactions.
    finishSelfDestruct(attacker,moveResult);

    if (moveGuards.breaksProtection(move) && moveResult.hits>0 && moveResult.effectiveness>0 && moveGuards.clearProtection(defender,defenderSide)) {
        moveResult.messages.push(`${move.ename==='Feint'?'Ruse':move.ename==='Hyperspace Hole'?'Trou Dimensionnel':move.ename==='Phantom Force'?'Hantise':'Revenant'} brise la protection adverse !`);
    }
    const effectContext = {
        attacker,
        defender,
        attackerSide,
        defenderSide,
        attackerTeam,
        defenderTeam,
        battleState,
        move,
        calledDepth,
        targetAlly: options.targetAlly || null,
        activeAllies: options.activeAllies || null,
        activeDefenders: options.activeDefenders || null
    };
    if (move.ename === 'Rest') {
        const oldStatus = attacker.status;
        if (attacker.currentHp >= attacker.maxHp || oldStatus === 'sleep') {
            moveResult.success = false;
            moveResult.messages.push('Repos échoue.');
        } else {
            attacker.status = 'normal';
            if (applyStatus(attacker, 'sleep', null, moveResult.messages, {battleState, attacker, turns:3, ignoreSafeguard:true})) {
                attackerData.toxicCounter = 0;
                const healed = healPokemon(attacker, attacker.maxHp);
                moveResult.messages.push(`${getPokemonDisplayName(attacker)} récupère ${healed} PV avec Repos.`);
            } else {
                attacker.status = oldStatus;
                moveResult.success = false;
                moveResult.messages.push('Repos échoue : impossible de s’endormir.');
            }
        }
    }
    const sheerForce = hasPassiveAbility(attacker, 'Sheer Force') && getMoveFlags(move).secondary;
    const effects = move.ename !== 'Rest' && Array.isArray(move?.combat?.effects)
        ? move.combat.effects.filter((effect) => !sheerForce || !effect.secondary && !['status_chance', 'flinch'].includes(effect.kind))
        : [];
    for (const effect of effects) {
        const callsMove = ['copy_last_move','me_first','copycat','random_move','nature_power','sleep_talk','assist'].includes(effect.kind);
        const targetsEnemy=!callsMove && !['self','self_side','field','all','opponent_side'].includes(effect.target||moveTarget);
        if(targetsEnemy && damageClass!=='status' && !moveResult.damage)continue;
        if(targetsEnemy && (defenderData.substituteHp>0 || moveResult.substituteDamage>0)
            && !moveGuards.bypassesSubstitute(attacker,move)){
            if(['purify','pain_split'].includes(effect.kind)){
                moveResult.success=false;moveResult.blocked=true;
                moveResult.messages.push(`Le clone empêche ${effect.kind==='pain_split'?'Balance':'Purification'} d’atteindre sa cible.`);
            }
            continue;
        }
        if(targetsEnemy && hasPassiveAbility(attacker,'Infiltrator'))effectContext.ignoreSafeguard=true;
        if(targetsEnemy && damageClass!=='status' && effect.chance!=null && !ignoresDefenderAbility(attacker,defender) && hasPassiveAbility(defender,'Shield Dust'))continue;
        const resolved=damageClass!=='status' && effect.chance!=null && hasPassiveAbility(attacker,'Serene Grace') ? {...effect,chance:Math.min(1,effect.chance*2)} : effect;
        applyEffect(resolved, effectContext, moveResult);
    }
    // A called move has already applied its reactions and held-item costs.
    if (moveResult.calledMoveResolved) {
        attackerData.lastMoveUsed = move.ename;
        return moveResult;
    }
    if (moveResult.hits > 0 && moveResult.effectiveness > 0 && attacker.currentHp > 0) {
        const selfDrops = {
            'Close Combat': {defense:-1,specialDefense:-1}, 'Superpower': {attack:-1,defense:-1},
            'Overheat': {specialAttack:-2}, 'Leaf Storm': {specialAttack:-2},
            'Draco Meteor': {specialAttack:-2}, 'Psycho Boost': {specialAttack:-2},
            'Hammer Arm': {speed:-1}, 'V-create': {speed:-1,defense:-1,specialDefense:-1}
        };
        for (const [stat, stages] of Object.entries(selfDrops[move.ename] || {})) {
            applyStageChange(attacker, stat, stages, moveResult.messages, attacker);
        }
        if (['Hyper Beam','Giga Impact','Blast Burn','Hydro Cannon','Frenzy Plant','Rock Wrecker','Roar of Time'].includes(move.ename)) {
            attackerData.rechargeMove = move.ename;
        }
    }
    if (move.ename === 'Rapid Spin' && moveResult.effectiveness > 0 && moveResult.damage + moveResult.substituteDamage > 0 && attacker.currentHp > 0) {
        const cleared=battleField.clearHazards(attackerSide);
        const bound=attackerData.trappedTurns > 0 || Boolean(attackerData.leechSeedSource);
        attackerData.trappedTurns=0;attackerData.leechSeedSource=null;
        if(cleared || bound)moveResult.messages.push('Tour Rapide libère le lanceur et dégage les pièges de son camp !');
    }
    if(move.ename==='Burn Up'&&moveResult.damage+moveResult.substituteDamage>0){attackerData.tempTypes=getPokemonTypes(attacker).filter(t=>t!=='Fire');if(!attackerData.tempTypes.length)attackerData.tempTypes=['???'];moveResult.messages.push(`${getPokemonDisplayName(attacker)} perd son type Feu !`);}
    applyImplicitMoveEffect(move, effectContext, moveResult);
    // Grounding moves interrupt the airborne release; Gravity interrupts both
    // participants in Sky Drop. Keep this after the successful hit/effect.
    if (moveResult.success && ['Gravity','Smack Down','Thousand Arrows'].includes(move.ename)) {
        for (const [target,other] of move.ename === 'Gravity' ? [[attacker,defender],[defender,attacker]] : [[defender,attacker]]) {
            if (target.__battle?.semiInvulnerable === 'airborne') {
                twoTurn.clear(target,other,battleState.turn);
                if (target.__battle.skyDropBy) { delete target.__battle.skyDropBy; twoTurn.clear(other,target,battleState.turn); }
                if (move.ename !== 'Gravity') target.__battle.grounded = true;
                target.__battle.chargeInterruptedTurn = battleState.turn;
                moveResult.messages.push(`${getPokemonDisplayName(target)} est ramené au sol.`);
            }
        }
    }
    const reactionContext={...effectContext,result:moveResult,hpBefore:hpBeforeMove};
    if(!perHitSecondaries && !effects.some(e=>['status_chance','flinch'].includes(e.kind)))reactions.secondaryEffects(reactionContext,helper,moveResult.messages);
    reactions.afterMove(reactionContext,helper,moveResult.messages);
    if(defender.currentHp<=0 && hpBeforeMove>0)abilityForms.sync(attacker,'ko',moveResult.messages,null,battleState,defender);
    if(defender.currentHp<=0 && attacker.currentHp>0 && hpBeforeMove>0 && hasPassiveAbility(attacker,'Soul-Heart'))applyStageChange(attacker,'specialAttack',1,moveResult.messages,attacker);

    const moveRecoil = getMoveFlags(move).recoil;
    if (moveResult.damage + moveResult.substituteDamage > 0 && Array.isArray(moveRecoil) && moveRecoil.length === 2
        && !hasPassiveAbility(attacker, 'Rock Head') && !hasPassiveAbility(attacker,'Magic Guard') && safeNumber(attacker.currentHp, 0) > 0) {
        const recoil = Math.max(1, Math.floor((moveResult.damage + moveResult.substituteDamage) * safeNumber(moveRecoil[0], 0) / Math.max(1, safeNumber(moveRecoil[1], 1))));
        const recoilResult = applyDamage(attacker, recoil, { allowEndure: false });
        if (recoilResult.damageToHp > 0) {
            moveResult.messages.push(`${getPokemonDisplayName(attacker)} subit ${recoilResult.damageToHp} PV de contrecoup.`);
        }
    }

    if (move.ename === 'Struggle' && moveResult.damage + moveResult.substituteDamage > 0 && safeNumber(attacker.currentHp, 0) > 0) {
        const recoil = Math.max(1, Math.floor(safeNumber(attacker.maxHp, 1) / 4));
        const recoilResult = applyDamage(attacker, recoil, { allowEndure: false });
        moveResult.messages.push(`${getPokemonDisplayName(attacker)} subit ${recoilResult.damageToHp} PV de contrecoup.`);
    }

    const itemDamage = moveResult.damage + moveResult.substituteDamage;
    if (itemDamage > 0 && attacker.currentHp > 0) {
        const itemEffect = heldItems.effect(attacker, battleState);
        if (itemEffect === 'life_orb' && !sheerForce && !hasPassiveAbility(attacker, 'Magic Guard')) {
            const recoil = applyDamage(attacker, Math.max(1, Math.floor(attacker.maxHp / 10)), { allowEndure:false });
            moveResult.messages.push(`L’Orbe Vie coûte ${recoil.damageToHp} PV à ${getPokemonDisplayName(attacker)}.`);
        }
        if (itemEffect === 'shell_bell') {
            const healed = healPokemon(attacker, Math.max(1, Math.floor(itemDamage / 8)));
            if (healed) moveResult.messages.push(`Le Grelot Coque restaure ${healed} PV.`);
        }
    }
    activateHeldItem(attacker, battleState, moveResult.messages, 'immediate',defender);
    activateHeldItem(defender, battleState, moveResult.messages, 'immediate',attacker);
    if(moveResult.success && reactions.traits.moves[move.ename]?.dance && !options.danced && defender.currentHp>0 && hasPassiveAbility(defender,'Dancer')) {
        const copied=useattack(move.ename,defender,attacker,{battleState,attackerSide:defenderSide,defenderSide:attackerSide,
            attackerTeam:defenderTeam,defenderTeam:attackerTeam,consumePp:false,skipTurnStart:true,danced:true});
        moveResult.messages.push(`${getPokemonDisplayName(defender)} copie la danse avec Danseuse.`,...copied.messages);
    }

    attackerData.lastMoveUsed = move.ename;
    defenderData.lastMoveUsed = defenderData.lastMoveUsed || null;

    return moveResult;
}

module.exports = {
    canKnockOffItem,
    knockOffHeldItem,
    movePhase,
    PARTIAL_EFFECT_KINDS,
    applyStatus,
    applyStageChange,
    getEffectiveness,
    getBattleSpeed,
    getMoveByName,
    resolveWeatherMove,
    weatherMoveAccuracy,
    battleMoveTypes,
    getMovePriority,
    orderBattleActions,
    resolveRedirectedTarget,
    calculateDamage,
    estimateDamage,
    estimateDamageOnCopies,
    getSpecialMoveResolution,
    createBattleState,
    createSideState,
    ensureBattleData,
    processTurnStart,
    processEndOfRound,
    applySwitchInEffects,
    canSwitchOut,
    useattack
};
