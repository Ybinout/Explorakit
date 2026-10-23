const { requestReplacement } = require('./replacementChoice');
const presentation = require('./presentationState');
const { effortYield } = require('../models/training');
const { AdventureExperience } = require('./adventureExperience');
const { canFleeWildBattle } = require('./wildEscape');
const { planTurnActions } = require('./turnActions');
const {
    useattack,
    getMoveByName,
    resolveWeatherMove,
    battleMoveTypes,
    movePhase,
    createBattleState,
    orderBattleActions,
    processEndOfRound,
    applySwitchInEffects,
    canSwitchOut
} = require('./battleEngine');
const { getUsableMoveIndexes, getForcedMove, selectedMoveName } = require('./battleResources');
const { BATTLE_EXPERIENCE_MULTIPLIERS } = require('../models/progression');
const { emitSoloBattleEnd, createBattleSummaryTracker, clearBattleTransientState } = require('./battleOutcome');
const { emitFieldState, emitSoloMoveResult } = require('./battleEvents');
const {
    hasAlivePokemon,
    resolveMoveSwitches,
    switchPokemonByIndex: playerSwitchByIndex
} = require('./battleTeam');
const { editEquipe } = require('../../persistence/teamRepository');
const { awardUserMoney } = require('../../persistence/userRepository');
const { adventureMoneyReward } = require('./wildReward');
const { loadUserItems, consumeUserItem } = require('../../persistence/itemRepository');
const { markPokemonCaught, markPokemonSeen, loadProgressState } = require('../../persistence/progressionRepository');
const {captureAssessment, captureBaseChance} = require('./captureProgression');
const pokemonStorage=require('../../persistence/pokemonStorageRepository');
const itemsCatalog = require('../../../data/game/items.json');

const CAPTURE_ANIMATION_DURATION_MS = 2800;
const TEXT_DELAY_MS = 1400;
const SHORT_DELAY_MS = 500;
const DEFAULT_CATCH_MULTIPLIER = itemsCatalog.items.find(item => item.key === 'pokeball').catch_multiplier;

const ballItemsByKey = (itemsCatalog.items || []).reduce((accumulator, item) => {
    if (!item || item.category !== 'ball' || !item.key) return accumulator;
    accumulator[item.key] = item;
    return accumulator;
}, {});

function sleep(ms) {
    const configuredScale = Number(process.env.BATTLE_DELAY_SCALE);
    const scale = process.env.NODE_ENV === 'test' && Number.isFinite(configuredScale)
        ? Math.max(0, configuredScale)
        : 1;
    return new Promise((resolve) => setTimeout(resolve, Math.round(ms * scale)));
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function getRandomNumber(pokemon) {
    const indexes = getUsableMoveIndexes(pokemon);
    if (indexes.length === 0) return 0;
    return indexes[Math.floor(Math.random() * indexes.length)];
}

function getPokemonDisplayName(pokemon) {
    if (!pokemon) return 'Pokemon';
    return pokemon.truename || pokemon.name || 'Pokemon';
}

function getMoveName(pokemon, moveIndex) {
    if (!pokemon || typeof pokemon.getAtkName !== 'function') {
        return 'une attaque';
    }
    const moveName = selectedMoveName(pokemon, moveIndex);
    return moveName || 'une attaque';
}

async function narrate(player, io, message, delayMs = TEXT_DELAY_MS) {
    io.to(player.id).emit('battleText', { message });
    if (delayMs > 0) {
        await sleep(delayMs);
    }
}

function displayIntroAnimation(player, wildPokemon, io, battleState) {
    io.to(player.id).emit('introAnimation', { player, wildPokemon, capturePolicy:captureAssessment(battleState?.captureProgress,wildPokemon?.level), moveTypes:battleMoveTypes(player.equipe.pokemons[0],wildPokemon,battleState), effortYield:effortYield(wildPokemon), transitions:presentation.transitions(player,player.equipe.pokemons[0],wildPokemon) });
}

function displayMoveAnimation(player, attacker, defender, moveName, io, battleState) {
    const move = resolveWeatherMove(getMoveByName(moveName),attacker,defender,battleState);
    io.to(player.id).emit('battleMoveAnimation', {
        actor: attacker === player?.equipe?.pokemons?.[0] ? 'player' : 'opponent',
        moveName,
        phase: movePhase(attacker,moveName,battleState,defender),
        moveType: move?.type || 'Normal',
        moveTarget: move?.combat?.target || 'opponent',
        damageClass: move?.combat?.damage_class || 'status'
    });
}

async function narrateMessages(player, io, messages = [], delayMs = TEXT_DELAY_MS) {
    if (!Array.isArray(messages) || messages.length === 0) return;
    for (const message of messages) {
        if (!message) continue;
        await narrate(player, io, message, delayMs);
    }
}

function decideMoveOrder(playerPokemon, playerMoveName, wildPokemon, wildMoveName, battleState) {
    return orderBattleActions([
        { key: 'player', pokemon: playerPokemon, moveName: playerMoveName, side: battleState?.sides?.player },
        { key: 'wild', pokemon: wildPokemon, moveName: wildMoveName, side: battleState?.sides?.enemy }
    ], battleState)[0]?.key === 'player';
}

function performAttack(attacker, defender, moveIndex, battleContext) {
    return useattack(selectedMoveName(attacker, moveIndex), attacker, defender, battleContext);
}

async function performAttackWithNarration(attacker, defender, moveIndex, player, wildPokemon, io, battleContext) {
    const attackerName = getPokemonDisplayName(attacker);
    const defenderName = getPokemonDisplayName(defender);
    const moveName = getMoveName(attacker, moveIndex);

    displayMoveAnimation(player, attacker, defender, moveName, io, battleContext.battleState);
    await narrate(player, io, `${attackerName} utilise ${moveName} !`);
    const attackResult = performAttack(attacker, defender, moveIndex, battleContext);
    emitSoloMoveResult(io, player, attacker, attackResult, battleContext?.battleState);
    displayIntroAnimation(player, wildPokemon, io, battleContext.battleState);
    await sleep(SHORT_DELAY_MS);
    await narrateMessages(player, io, attackResult.messages, 950);

    const switches = resolveMoveSwitches(
        attackResult,
        battleContext?.attackerTeam,
        battleContext?.defenderTeam
    );
    attackResult.switches = switches;

    if (switches.defender?.incoming) {
        await narrate(player, io, `${getPokemonDisplayName(switches.defender.incoming)} est force d'entrer en combat !`, 900);
        await applySwitchInNarration(
            player, wildPokemon, io, switches.defender.incoming,
            battleContext.defenderSide, battleContext.attackerSide, battleContext.battleState
        );
    }

    if (switches.attacker?.incoming) {
        await narrate(player, io, `${getPokemonDisplayName(switches.attacker.incoming)} prend le relais !`, 900);
        await applySwitchInNarration(
            player, wildPokemon, io, switches.attacker.incoming,
            battleContext.attackerSide, battleContext.defenderSide, battleContext.battleState
        );
    }

    if (attacker.currentHp <= 0) {
        await narrate(player, io, `${attackerName} tombe K.O. !`);
    }

    if (defender.currentHp <= 0) {
        await narrate(player, io, `${defenderName} tombe K.O. !`);
    }

    return attackResult;
}

async function applySwitchInNarration(player, wildPokemon, io, switchedPokemon, ownSide, enemySide, battleState) {
    battleState.adventureExperience?.enter(player.equipe.pokemons[0], wildPokemon);
    const enemyPokemon = switchedPokemon === wildPokemon
        ? player?.equipe?.pokemons?.[0]
        : wildPokemon;
    displayIntroAnimation(player, wildPokemon, io, battleState);
    const switchMessages = applySwitchInEffects(switchedPokemon, ownSide, enemySide, battleState, enemyPokemon);
    emitFieldState(io, player?.id, battleState);
    if (switchMessages.length === 0) return;

    displayIntroAnimation(player, wildPokemon, io, battleState);
    await sleep(SHORT_DELAY_MS);
    await narrateMessages(player, io, switchMessages, 950);
}

async function resolveRoundEnd(player, wildPokemon, io, battleState, playerSide, enemySide) {
    const playerPokemon = player.equipe.pokemons[0];
    const endTurnMessages = processEndOfRound(playerPokemon, wildPokemon, playerSide, enemySide, battleState);
    emitFieldState(io, player?.id, battleState);

    if (endTurnMessages.length > 0) {
        displayIntroAnimation(player, wildPokemon, io, battleState);
        await sleep(SHORT_DELAY_MS);
        await narrateMessages(player, io, endTurnMessages, 950);
    }

    if (wildPokemon.currentHp <= 0) return hasAlivePokemon(player.equipe.pokemons) ? 'wild_ko' : 'player_ko';
    if (playerPokemon.currentHp <= 0) return 'player_ko';
    return 'continue';
}

function calculateCaptureChance(playerPokemon, wildPokemon, ballMultiplier = DEFAULT_CATCH_MULTIPLIER, progress = null) {
    const baseChance = captureBaseChance(wildPokemon);

    const playerLevel = Number(playerPokemon?.level) || 1;
    const wildLevel = Number(wildPokemon.level) || 1;
    const levelFactor = clamp(1 + (playerLevel - wildLevel) * 0.012, 0.72, 1.35);

    const chance = baseChance * levelFactor * (Number(ballMultiplier) || DEFAULT_CATCH_MULTIPLIER);
    // Apply after the ordinary floor/cap: the 5% floor must not make distant
    // endgame targets easy to obtain by throwing a few more Balls.
    return clamp(chance, 0.05, 0.95) * (captureAssessment(progress,wildLevel)?.multiplier ?? 1);
}

function resolveCaptureShakes(success, chance) {
    if (success) return 3;
    if (chance < 0.2) return 0;
    if (chance < 0.45) return 1;
    return 2;
}

async function emitBagUpdate(player, io, userId) {
    try {
        const items = await loadUserItems(userId);
        io.to(player.id).emit('bagUpdated', { items });
    } catch (error) {
        console.error(`Erreur bagUpdated pour user ${userId}:`, error.message);
    }
}

async function handleBagAction(player, wildPokemon, io, userId, itemKey, progress, participation) {
    const ball = ballItemsByKey[itemKey];
    if (!ball) {
        await narrate(player, io, 'Cet objet ne peut pas etre utilise en combat.');
        return { turnConsumed: false, caught: false };
    }

    if(player.equipe?.pokemons?.length>=6 && !await pokemonStorage.hasRoom(userId)){
        await narrate(player,io,'Ton équipe et ton PC sont pleins. Libère une place dans un Centre Pokémon.');
        return {turnConsumed:false,caught:false};
    }
    const consumeResult = await consumeUserItem(userId, itemKey, 1);
    if (!consumeResult.success) {
        await narrate(player, io, `Tu n'as plus de ${ball.name}.`);
        await emitBagUpdate(player, io, userId);
        return { turnConsumed: false, caught: false };
    }

    await emitBagUpdate(player, io, userId);
    await narrate(player, io, `${getPokemonDisplayName(player.equipe.pokemons[0])} utilise ${ball.name} !`, 900);

    const playerPokemon = player?.equipe?.pokemons?.[0];
    const chance = calculateCaptureChance(playerPokemon, wildPokemon, ball.catch_multiplier, progress);
    const success = Math.random() < chance;
    const shakes = resolveCaptureShakes(success, chance);

    io.to(player.id).emit('captureAnimation', {
        itemKey,
        itemName: ball.name,
        success,
        shakes,
        chance,
        wildPokemonName: wildPokemon.truename
    });

    await sleep(CAPTURE_ANIMATION_DURATION_MS);

    if (!success) {
        await narrate(player, io, `${getPokemonDisplayName(wildPokemon)} s'est libere !`);
        return { turnConsumed: true, caught: false };
    }


    if (!wildPokemon.name || wildPokemon.name === 'test') {
        wildPokemon.name = wildPokemon.truename || 'Pokemon';
    }
    if (wildPokemon.currentHp <= 0) {
        wildPokemon.currentHp = 1;
    }

    clearBattleTransientState([wildPokemon]);
    let stored=null;
    if(player.equipe.pokemons.length>=6)stored=await pokemonStorage.storeCapturedPokemon(userId,wildPokemon);
    else player.equipe.pokemons.push(wildPokemon);
    participation.rewardEffort(player, wildPokemon);
    try {
        if(!stored)await markPokemonCaught(userId, wildPokemon);
        io.to(player.id).emit('pokedexChanged', { reason: 'captured', pokemonId: wildPokemon?.data?.id });
    } catch (error) {
        console.error(`Erreur Pokédex après capture user ${userId}:`, error.message);
    }
    await narrate(player, io, stored?`${getPokemonDisplayName(wildPokemon)} est capturé et envoyé dans la Boîte ${stored.box+1} du PC !`:`${getPokemonDisplayName(wildPokemon)} est capturé et rejoint ton équipe !`);
    return { turnConsumed: true, caught: true };
}

async function runAttackTurn(player, wildPokemon, response, io, battleState, playerSide, enemySide) {
    const playerPokemon = player.equipe.pokemons[0];
    const playerMoveIndex = Number.isInteger(response?.number) ? response.number : getRandomNumber(playerPokemon);
    const wildMoveIndex = getRandomNumber(wildPokemon);

    const playerMoveName = selectedMoveName(playerPokemon, playerMoveIndex);
    const wildMoveName = selectedMoveName(wildPokemon, wildMoveIndex);
    planTurnActions(battleState, [
        { pokemon: playerPokemon, action: 'attack', moveName: playerMoveName },
        { pokemon: wildPokemon, action: 'attack', moveName: wildMoveName }
    ]);
    const playerActsFirst = decideMoveOrder(playerPokemon, playerMoveName, wildPokemon, wildMoveName, battleState);

    if (playerActsFirst) {
        await performAttackWithNarration(
            playerPokemon,
            wildPokemon,
            playerMoveIndex,
            player,
            wildPokemon,
            io,
            {
                battleState,
                attackerSide: playerSide,
                defenderSide: enemySide,
                attackerTeam: player.equipe.pokemons,
                defenderTeam: [wildPokemon]
            }
        );
        if (wildPokemon.currentHp <= 0) return hasAlivePokemon(player.equipe.pokemons) ? 'wild_ko' : 'player_ko';
        if (player.equipe.pokemons[0].currentHp <= 0) return 'player_ko';

        await performAttackWithNarration(
            wildPokemon,
            player.equipe.pokemons[0],
            wildMoveIndex,
            player,
            wildPokemon,
            io,
            {
                battleState,
                attackerSide: enemySide,
                defenderSide: playerSide,
                attackerTeam: [wildPokemon],
                defenderTeam: player.equipe.pokemons
            }
        );

        if (player.equipe.pokemons[0].currentHp <= 0) return 'player_ko';
        if (wildPokemon.currentHp <= 0) return hasAlivePokemon(player.equipe.pokemons) ? 'wild_ko' : 'player_ko';
        return resolveRoundEnd(player, wildPokemon, io, battleState, playerSide, enemySide);
    }

    const wildResult = await performAttackWithNarration(
        wildPokemon,
        playerPokemon,
        wildMoveIndex,
        player,
        wildPokemon,
        io,
        {
            battleState,
            attackerSide: enemySide,
            defenderSide: playerSide,
            attackerTeam: [wildPokemon],
            defenderTeam: player.equipe.pokemons
        }
    );
    if (player.equipe.pokemons[0].currentHp <= 0) return 'player_ko';
    if (wildPokemon.currentHp <= 0) return hasAlivePokemon(player.equipe.pokemons) ? 'wild_ko' : 'player_ko';
    if (wildResult?.switches?.defender) {
        return resolveRoundEnd(player, wildPokemon, io, battleState, playerSide, enemySide);
    }

    await performAttackWithNarration(
        player.equipe.pokemons[0],
        wildPokemon,
        playerMoveIndex,
        player,
        wildPokemon,
        io,
        {
            battleState,
            attackerSide: playerSide,
            defenderSide: enemySide,
            attackerTeam: player.equipe.pokemons,
            defenderTeam: [wildPokemon]
        }
    );

    if (wildPokemon.currentHp <= 0) return hasAlivePokemon(player.equipe.pokemons) ? 'wild_ko' : 'player_ko';
    if (player.equipe.pokemons[0].currentHp <= 0) return 'player_ko';
    return resolveRoundEnd(player, wildPokemon, io, battleState, playerSide, enemySide);
}

function playerTurn(player, io) {
    if (getForcedMove(player.equipe?.pokemons?.[0])) return Promise.resolve({ action:'attack', number:getUsableMoveIndexes(player.equipe.pokemons[0])[0] });
    return new Promise((resolve) => {
        const playerSocket = io.sockets.sockets.get(player.id);
        if (!playerSocket) {
            resolve({ action: 'disconnect', reason: 'socket_missing' });
            return;
        }

        playerSocket.emit('requestAction', { message: 'Quelle est votre prochaine action ?' });

        let timeoutId = null;
        let settled = false;
        const cleanup = () => {
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
            playerSocket.off('actionResponse', responseListener);
            playerSocket.off('disconnect', disconnectListener);
        };

        const finish = (response) => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(response);
        };

        const responseListener = (response = {}) => {
            if (response?.replacementId) return; // A delayed replacement must not consume the next turn.
            switch (response.action) {
                case 'attack':
                case 'flee':
                case 'change':
                case 'bag':
                    finish(response);
                    break;
                default:
                    finish({ action: 'invalid', reason: 'unknown_action' });
            }
        };

        const disconnectListener = () => {
            finish({ action: 'disconnect', reason: 'player_disconnected' });
        };

        playerSocket.on('actionResponse', responseListener);
        playerSocket.once('disconnect', disconnectListener);

        timeoutId = setTimeout(() => {
            finish({ action: 'timeout', reason: 'action_timeout' });
        }, 60000);
    });
}

async function startBattle(player, wildPokemon, io, userId) {
    presentation.reset(player);
    require('./partyOrder').rememberPartyOrder(player.equipe);
    require('./battleTeam').autoSwitchPokemon(player.equipe);
    const resultTracker = createBattleSummaryTracker(player?.equipe?.pokemons);
    let wildMoneyGranted = false, wildLootAttempted = false;
    const endBattle = async (playerWon = false, extra = {}) => {
        // A simultaneous K.O. cannot award victory with no surviving companion.
        if (playerWon && !hasAlivePokemon(player.equipe.pokemons)) playerWon = false;
        if (playerWon && !extra.captured && wildPokemon.currentHp <= 0 && !wildLootAttempted) {
            wildLootAttempted = true;
            const item = await require('../../persistence/wildLootRepository').awardWildLoot(userId);
            if (item) {
                resultTracker.loot.push(item.name);
                io.to(player.id).emit('bagUpdated', {items:await loadUserItems(userId)});
                await narrate(player,io,`Objet trouvé : ${item.name}${item.unique?' · unique':''} !`,900);
            }
        }
        if (playerWon && (extra.captured || wildPokemon.currentHp <= 0) && !wildMoneyGranted) {
            const money = await awardUserMoney(userId, adventureMoneyReward(wildPokemon, playerSide.rewardMultiplier));
            wildMoneyGranted = true;
            resultTracker.money += money;
        }
        return emitSoloBattleEnd(player, io, playerWon, {
            ...extra,
            summary: resultTracker.snapshot(player.equipe.pokemons, extra.captured ? wildPokemon : null)
        }, 'wild');
    };
    const battleState = createBattleState({ mapName: player.currentmap });
    try {
        // Snapshot earned SQL badges for this Adventure battle. No client
        // count, map, active Pokémon level or profile payload can unlock it.
        battleState.captureProgress = (await loadProgressState(userId)).capture;
    } catch (error) {
        console.error('Progression de capture indisponible:', error.message);
        await endBattle(false,{interrupted:true,reason:'progress_unavailable'});
        return false;
    }
    battleState.adventureExperience = new AdventureExperience({expShare:await require('../../persistence/wildLootRepository').hasExpShare(userId)});
    require('../abilities/abilityForms').attachTeam(player.equipe.pokemons);
    const playerSide = battleState.sides.player;
    const enemySide = battleState.sides.enemy;

    try {
        await markPokemonSeen(userId, wildPokemon);
        io.to(player.id).emit('pokedexChanged', { reason: 'wild_seen', pokemonId: wildPokemon?.data?.id });
    } catch (error) {
        console.error(`Erreur Pokédex combat sauvage user ${userId}:`, error.message);
    }

    const grantWildXp = async () => {
        const awards = battleState.adventureExperience.reward(player, wildPokemon, BATTLE_EXPERIENCE_MULTIPLIERS.wild, io);
        for (const {pokemon, xp} of awards) await narrate(player, io, `${getPokemonDisplayName(pokemon)} gagne ${xp} XP !`, 900);
    };

    const handleForcedSwitch = async () => {
        const response = await requestReplacement(io, player);
        if (response.action === 'disconnect') {
            await endBattle(false, { interrupted: true, reason: response.reason });
            await editEquipe(userId, player.equipe);
            return false;
        }
        const switched = response.action === 'change' && playerSwitchByIndex(player.equipe, response.number);
        if (!switched) {
            await narrate(player, io, 'Tu as perdu le combat...');
            await endBattle(false);
            await editEquipe(userId, player.equipe);
            return false;
        }

        displayIntroAnimation(player, wildPokemon, io, battleState);
        await narrate(player, io, `${getPokemonDisplayName(player.equipe.pokemons[0])} entre en combat !`, 900);
        await applySwitchInNarration(
            player,
            wildPokemon,
            io,
            player.equipe.pokemons[0],
            playerSide,
            enemySide,
            battleState
        );

        if (player.equipe.pokemons[0].currentHp <= 0 && !hasAlivePokemon(player.equipe.pokemons)) {
            await narrate(player, io, 'Tu as perdu le combat...');
            await endBattle(false);
            await editEquipe(userId, player.equipe);
            return false;
        }

        return true;
    };

    displayIntroAnimation(player, wildPokemon, io, battleState);
    emitFieldState(io, player.id, battleState);
    await emitBagUpdate(player, io, userId);
    await narrate(player, io, `Un ${getPokemonDisplayName(wildPokemon)} sauvage apparait !`);
    await applySwitchInNarration(
        player,
        wildPokemon,
        io,
        player.equipe.pokemons[0],
        playerSide,
        enemySide,
        battleState
    );
    await applySwitchInNarration(
        player,
        wildPokemon,
        io,
        wildPokemon,
        enemySide,
        playerSide,
        battleState
    );

    while (wildPokemon.currentHp > 0) {
        if (!hasAlivePokemon(player.equipe.pokemons)) {
            await narrate(player, io, 'Tu as perdu le combat...');
            await endBattle(false);
            await editEquipe(userId, player.equipe);
            return false;
        }

        if (player.equipe.pokemons[0].currentHp <= 0) {
            const canContinue = await handleForcedSwitch();
            if (!canContinue) {
                return false;
            }
            continue; // Entry hazards can require another choice before a normal turn.
        }

        try {
            const response = await playerTurn(player, io);
            const actionPlayer = response.action;

            if (actionPlayer === 'disconnect' || actionPlayer === 'timeout') {
                await endBattle(false, {
                    interrupted: true,
                    reason: response.reason || actionPlayer
                });
                await editEquipe(userId, player.equipe);
                return false;
            }

            const currentPokemon = player.equipe.pokemons[0];
            planTurnActions(battleState, [{ pokemon: currentPokemon, action: actionPlayer,
                moveName: selectedMoveName(currentPokemon, response.number) }]);

            if (actionPlayer === 'flee') {
                if (!canFleeWildBattle(currentPokemon, wildPokemon, battleState)) {
                    await narrate(player, io, `${getPokemonDisplayName(currentPokemon)} est piege et ne peut pas fuir.`);
                    continue;
                }

                await narrate(player, io, 'Tu prends la fuite !');
                await endBattle(false, { fled: true });
                await editEquipe(userId, player.equipe);
                return true;
            }

            if (actionPlayer === 'bag') {
                const bagResult = await handleBagAction(player, wildPokemon, io, userId, response.itemKey, battleState.captureProgress, battleState.adventureExperience);

                if (bagResult.caught) {
                    await narrate(player, io, 'Victoire !');
                    await endBattle(true, { captured: true });
                    await editEquipe(userId, player.equipe);
                    return true;
                }

                if (!bagResult.turnConsumed) {
                    continue;
                }

                if (wildPokemon.currentHp > 0 && player.equipe.pokemons[0].currentHp > 0) {
                    await performAttackWithNarration(
                        wildPokemon,
                        player.equipe.pokemons[0],
                        getRandomNumber(wildPokemon),
                        player,
                        wildPokemon,
                        io,
                        {
                            battleState,
                            attackerSide: enemySide,
                            defenderSide: playerSide,
                            attackerTeam: [wildPokemon],
                            defenderTeam: player.equipe.pokemons
                        }
                    );
                }

                if (wildPokemon.currentHp > 0 && player.equipe.pokemons[0].currentHp > 0) {
                    const roundResult = await resolveRoundEnd(player, wildPokemon, io, battleState, playerSide, enemySide);
                    if (roundResult === 'wild_ko') {
                        await grantWildXp();
                        await narrate(player, io, 'Victoire !');
                        await endBattle(true);
                        await editEquipe(userId, player.equipe);
                        return true;
                    }
                }

                if (player.equipe.pokemons[0].currentHp <= 0) {
                    const canContinue = await handleForcedSwitch();
                    if (!canContinue) return false;
                }
                continue;
            }

            if (actionPlayer === 'change') {
                if (!canSwitchOut(currentPokemon, wildPokemon, battleState, { escape: actionPlayer === 'flee' })) {
                    await narrate(player, io, `${getPokemonDisplayName(currentPokemon)} est piege et ne peut pas changer.`);
                    continue;
                }

                const changeIndex = Number.parseInt(response.number, 10);
                const switched = playerSwitchByIndex(player.equipe, changeIndex);

                if (!switched) {
                    await narrate(player, io, 'Changement impossible.');
                    continue;
                }

                await narrate(player, io, `${getPokemonDisplayName(player.equipe.pokemons[0])} est maintenant en combat !`, 900);
                displayIntroAnimation(player, wildPokemon, io, battleState);
                await applySwitchInNarration(
                    player,
                    wildPokemon,
                    io,
                    player.equipe.pokemons[0],
                    playerSide,
                    enemySide,
                    battleState
                );

                if (player.equipe.pokemons[0].currentHp <= 0) {
                    const canContinue = await handleForcedSwitch();
                    if (!canContinue) return false;
                    continue;
                }

                if (wildPokemon.currentHp > 0 && player.equipe.pokemons[0].currentHp > 0) {
                    await performAttackWithNarration(
                        wildPokemon,
                        player.equipe.pokemons[0],
                        getRandomNumber(wildPokemon),
                        player,
                        wildPokemon,
                        io,
                        {
                            battleState,
                            attackerSide: enemySide,
                            defenderSide: playerSide,
                            attackerTeam: [wildPokemon],
                            defenderTeam: player.equipe.pokemons
                        }
                    );
                }

                if (wildPokemon.currentHp > 0 && player.equipe.pokemons[0].currentHp > 0) {
                    const roundResult = await resolveRoundEnd(player, wildPokemon, io, battleState, playerSide, enemySide);
                    if (roundResult === 'wild_ko') {
                        await grantWildXp();
                        await narrate(player, io, 'Victoire !');
                        await endBattle(true);
                        await editEquipe(userId, player.equipe);
                        return true;
                    }
                }

                if (player.equipe.pokemons[0].currentHp <= 0) {
                    const canContinue = await handleForcedSwitch();
                    if (!canContinue) return false;
                }

                continue;
            }

            if (actionPlayer === 'attack') {
                const attackResult = await runAttackTurn(player, wildPokemon, response, io, battleState, playerSide, enemySide);

                if (attackResult === 'wild_ko') {
                    await grantWildXp();
                    await narrate(player, io, 'Victoire !');
                    await endBattle(true);
                    await editEquipe(userId, player.equipe);
                    return true;
                }

                if (attackResult === 'player_ko') {
                    const canContinue = await handleForcedSwitch();
                    if (!canContinue) return false;
                }
            }
        } catch (error) {
            console.log('Erreur pendant le tour du joueur :', error.message);
        }
    }

    await grantWildXp();
    await narrate(player, io, 'Victoire !');
    await endBattle(true);
    await editEquipe(userId, player.equipe);
    return true;
}

module.exports = require('./partyOrder').preservePartyOrder(startBattle);
module.exports.calculateCaptureChance = calculateCaptureChance;
