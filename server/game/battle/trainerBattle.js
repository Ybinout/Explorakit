const { requestReplacement } = require('./replacementChoice');
const { rewardText } = require('./rewardText');
const presentation = require('./presentationState');
const { partyIndicator } = require('./partyIndicator');
const trainerTactics = require('./trainerTactics');
const { effortYield } = require('../models/training');
const { AdventureExperience } = require('./adventureExperience');
const { planTurnActions } = require('./turnActions');
const {
    useattack,
    battleMoveTypes,
    orderBattleActions,
    createBattleState,
    processEndOfRound,
    applySwitchInEffects,
    canSwitchOut
} = require('./battleEngine');
const { getUsableMoveIndexes, getForcedMove, selectedMoveName, isMoveSelectionValid } = require('./battleResources');
const { BATTLE_EXPERIENCE_MULTIPLIERS } = require('../models/progression');
const { emitSoloBattleEnd, createBattleSummaryTracker } = require('./battleOutcome');
const { emitFieldState, emitSoloMoveResult, prepareMoveAnimation, afterActionMessages } = require('./battleEvents');
const {
    hasAlivePokemon,
    resolveMoveSwitches,
    switchPokemonByIndex
} = require('./battleTeam');
const { editEquipe } = require('../../persistence/teamRepository');
const { awardUserMoney } = require('../../persistence/userRepository');
const { markPokemonSeen } = require('../../persistence/progressionRepository');

const TEXT_DELAY_MS = 1300;
const SHORT_DELAY_MS = 500;

function sleep(ms) {
    const configuredScale = Number(process.env.BATTLE_DELAY_SCALE);
    const scale = process.env.NODE_ENV === 'test' && Number.isFinite(configuredScale)
        ? Math.max(0, configuredScale)
        : 1;
    return new Promise((resolve) => setTimeout(resolve, Math.round(ms * scale)));
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

async function narrateMessages(player, io, messages = [], delayMs = TEXT_DELAY_MS) {
    if (!Array.isArray(messages) || messages.length === 0) return;
    for (const message of messages) {
        if (!message) continue;
        await narrate(player, io, message, delayMs);
    }
}

function displayIntroAnimation(player, currentEnemy, io, battleState) {
    // Forecast is a weather form, not an entry hazard: reveal the correct sprite
    // from the first send-out frame, before narrating entry damage/abilities.
    require('../abilities/abilityForms').syncWeatherForms(player.equipe.pokemons[0],currentEnemy,battleState);
    io.to(player.id).emit('introAnimation', { player, wildPokemon: currentEnemy, genders:presentation.genders(player.equipe.pokemons[0],currentEnemy), opponentParty:partyIndicator(battleState.trainerTeam?.pokemons), usableMoveIndexes:getUsableMoveIndexes(player.equipe.pokemons[0],battleState), moveTypes:battleMoveTypes(player.equipe.pokemons[0],currentEnemy,battleState), effortYield:effortYield(currentEnemy), transitions:trainerTactics.decorateTransitions(presentation.transitions(player,player.equipe.pokemons[0],currentEnemy,{initial:true}),battleState.trainerTeam,battleState.trainerMemory) });
}

function displayMoveAnimation(player, attacker, io, details) {
    io.to(player.id).emit('battleMoveAnimation', {
        ...details, actor: attacker === player?.equipe?.pokemons?.[0] ? 'player' : 'opponent'
    });
}

function decideMoveOrder(playerPokemon, playerMoveName, enemyPokemon, enemyMoveName, battleState) {
    return orderBattleActions([
        { key: 'player', pokemon: playerPokemon, moveName: playerMoveName, side: battleState?.sides?.player },
        { key: 'enemy', pokemon: enemyPokemon, moveName: enemyMoveName, side: battleState?.sides?.enemy }
    ], battleState)[0]?.key === 'player';
}

function performAttack(attacker, defender, moveIndex, battleContext) {
    return useattack(selectedMoveName(attacker, moveIndex), attacker, defender, battleContext);
}

async function performAttackWithNarration(attacker, defender, moveIndex, player, currentEnemy, io, battleContext) {
    const attackerName = getPokemonDisplayName(attacker);
    const defenderName = getPokemonDisplayName(defender);
    const moveName = getMoveName(attacker, moveIndex);

    const animation = prepareMoveAnimation(attacker, defender, moveName, battleContext.battleState);
    const own=attacker===player.equipe.pokemons[0],ppBefore=require('./voidCharge').totalPp(attacker);
    const result = performAttack(attacker, defender, moveIndex, battleContext);
    if(own)await battleContext.battleState.voidCharge?.(result,ppBefore,attacker);
    await narrateMessages(player, io, result.beforeActionMessages, 950);
    if (!result.actionPrevented) {
        displayMoveAnimation(player, attacker, io, animation);
        await narrate(player, io, `${attackerName} utilise ${animation.moveName} !`);
    }
    const field = battleContext.battleState;
    if (!result.actionPrevented && attacker === player.equipe.pokemons[0]) trainerTactics.observe(field.trainerTeam, field.trainerMemory, attacker, moveName);
    else if (!result.actionPrevented && attacker !== player.equipe.pokemons[0]) trainerTactics.observe(field.trainerTeam, field.trainerMemory, defender, moveName, result, attacker);
    emitSoloMoveResult(io, player, attacker, result, battleContext?.battleState);
    displayIntroAnimation(player, currentEnemy, io, battleContext.battleState);
    await sleep(SHORT_DELAY_MS);
    await narrateMessages(player, io, afterActionMessages(result), 950);

    let attackerIndex;
    if (result.chooseSwitch && result.switchSelf && attacker.currentHp > 0) {
        if (own) {
            const response = await requestReplacement(io, player);
            if (response.action === 'change') attackerIndex = response.number;
            else battleContext.battleState.switchDisconnected = player.id;
        } else attackerIndex = trainerTactics.pivotIndex(battleContext.battleState.trainerTeam, {
            opponentTeam: player.equipe.pokemons, field, ownSide:battleContext.attackerSide,
            enemySide:battleContext.defenderSide, memory:field.trainerMemory
        });
    }
    const switches = resolveMoveSwitches(
        result,
        battleContext?.attackerTeam,
        battleContext?.defenderTeam, { attackerIndex }
    );
    result.switches = switches;
    const opponentTeam = attacker === player.equipe.pokemons[0] || battleContext.attackerTeam === player.equipe.pokemons
        ? battleContext.defenderTeam : battleContext.attackerTeam;
    currentEnemy = opponentTeam?.[0] || currentEnemy;

    if (switches.defender?.incoming) {
        await narrate(player, io, `${getPokemonDisplayName(switches.defender.incoming)} est force d'entrer en combat !`, 900);
        await applySwitchInNarration(
            player, currentEnemy, io, switches.defender.incoming,
            battleContext.defenderSide, battleContext.attackerSide, battleContext.battleState
        );
    }

    if (switches.attacker?.incoming) {
        await narrate(player, io, `${getPokemonDisplayName(switches.attacker.incoming)} prend le relais !`, 900);
        await applySwitchInNarration(
            player, currentEnemy, io, switches.attacker.incoming,
            battleContext.attackerSide, battleContext.defenderSide, battleContext.battleState
        );
    }

    if (attacker.currentHp <= 0) {
        await narrate(player, io, `${attackerName} tombe K.O. !`);
    }

    if (defender.currentHp <= 0) {
        await narrate(player, io, `${defenderName} tombe K.O. !`);
    }

    return result;
}

async function applySwitchInNarration(player, currentEnemy, io, switchedPokemon, ownSide, enemySide, battleState) {
    battleState.adventureExperience?.enter(player.equipe.pokemons[0], currentEnemy);
    const enemyPokemon = switchedPokemon === currentEnemy
        ? player?.equipe?.pokemons?.[0]
        : currentEnemy;
    displayIntroAnimation(player, currentEnemy, io, battleState);
    const switchMessages = applySwitchInEffects(switchedPokemon, ownSide, enemySide, battleState, enemyPokemon);
    emitFieldState(io, player?.id, battleState);
    if (switchMessages.length === 0) return;

    displayIntroAnimation(player, currentEnemy, io, battleState);
    await sleep(SHORT_DELAY_MS);
    await narrateMessages(player, io, switchMessages, 950);
}

async function resolveRoundEnd(player, currentEnemy, io, battleState, playerSide, enemySide) {
    const playerPokemon = player.equipe.pokemons[0];
    const roundMessages = processEndOfRound(playerPokemon, currentEnemy, playerSide, enemySide, battleState);
    emitFieldState(io, player?.id, battleState);

    if (roundMessages.length > 0) {
        displayIntroAnimation(player, currentEnemy, io, battleState);
        await sleep(SHORT_DELAY_MS);
        await narrateMessages(player, io, roundMessages, 950);
    }

    if (currentEnemy.currentHp <= 0) return 'enemy_ko';
    if (playerPokemon.currentHp <= 0) return 'player_ko';
    return 'continue';
}

function getRandomNumber(pokemon) {
    const indexes = getUsableMoveIndexes(pokemon);
    if (indexes.length === 0) return 0;
    return indexes[Math.floor(Math.random() * indexes.length)];
}

function playerChangePokemonByIndex(equipe, index) {
    return switchPokemonByIndex(equipe, index);
}

function playerTurn(player, io, battleState) {
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
            if (response.action === 'attack' && !isMoveSelectionValid(player.equipe.pokemons[0], response.number, battleState)) {
                playerSocket.emit('requestAction', { message:'Cette capacité n’est pas disponible. Choisis une autre action.' });
                return;
            }
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
        }, 120000);
    });
}


function enemySwapPokemon(enemyTeam, index, usedPokemons) {
    if (index < 0 || index >= enemyTeam.pokemons.length) return false;
    if (enemyTeam.pokemons[index].currentHp <= 0) return false;

    switchPokemonByIndex(enemyTeam, index);

    if (!usedPokemons.includes(enemyTeam.pokemons[0].uuid)) {
        usedPokemons.push(enemyTeam.pokemons[0].uuid);
    }

    return true;
}

async function startTeamBattle(player, enemyTeam, io, userId, options = {}) {
    presentation.reset(player);
    require('./partyOrder').rememberPartyOrder(player.equipe);
    require('./battleTeam').autoSwitchPokemon(player.equipe);
    const resultTracker = createBattleSummaryTracker(player?.equipe?.pokemons);
    const endBattle = (playerWon = false, extra = {}) => emitSoloBattleEnd(player, io, playerWon, {
        ...extra, summary: resultTracker.snapshot(player.equipe.pokemons)
    }, 'trainer');
    let victoryFinalized = false;
    const finalizeVictory = async () => {
        if (victoryFinalized) return null;
        victoryFinalized = true;

        let progressionReward = null;
        if (typeof options.onVictory === 'function') {
            try {
                progressionReward = await options.onVictory();
                if (progressionReward?.granted && progressionReward.money > 0) {
                    resultTracker.money += progressionReward.money;
                    await rewardText(player, io, `Tu reçois ${progressionReward.money} Pokédollars !`, sleep);
                }
            } catch (error) {
                console.error(`Erreur récompense de progression user ${userId}:`, error.message);
                await narrate(
                    player,
                    io,
                    "La victoire est acquise, mais sa sauvegarde a échoué. Tu pourras reparler au dresseur pour réessayer.",
                    900
                );
            }
        }
        return progressionReward;
    };

    if (!enemyTeam || !Array.isArray(enemyTeam.pokemons) || enemyTeam.pokemons.length === 0) {
        await narrate(player, io, "Le dresseur n'a aucun Pokemon valide.");
        await rewardText(player, io, 'Victoire !', sleep, 700);
        await finalizeVictory();
        endBattle(true);
        await editEquipe(userId, player.equipe);
        return true;
    }

    const arenaRewards = options.experienceKind === 'arena' || options.arenaBattleKey
        ? require('./arenaExperience').createArenaExperience(options.arenaBattleKey, enemyTeam.pokemons) : null;
    const usedPokemons = [];
    const battleState = createBattleState({ mapName: player.currentmap, battleType: options.experienceKind === 'arena' ? 'arena' : 'trainer' });
    Object.defineProperty(battleState,'voidCharge',{value:require('./voidCharge').recorder(userId,player,io)});
    battleState.adventureExperience = new AdventureExperience({expShare:'equipped'});
    battleState.trainerTeam = enemyTeam;
    battleState.trainerMemory = trainerTactics.createMemory();
    let round = 0;
    let committedDecision = null;
    const enemyDecision = () => trainerTactics.chooseAction(enemyTeam, player.equipe.pokemons[0], battleState, battleState.trainerMemory, round + 1, player.equipe.pokemons);
    require('../abilities/abilityForms').attachTeam(player.equipe.pokemons);
    require('../abilities/abilityForms').attachTeam(enemyTeam.pokemons);
    const playerSide = battleState.sides.player;
    const enemySide = battleState.sides.enemy;
    const baseMoneyReward = enemyTeam.pokemons.reduce(
        (total, pokemon) => total + Math.max(1, Number(pokemon?.level) || 1) * 20,
        0
    );
    let moneyRewardGranted = false;
    const grantMoneyReward = async () => {
        if (options.grantBaseMoney === false) return 0;
        if (moneyRewardGranted || baseMoneyReward <= 0) return 0;
        const reward = Math.max(1, Math.floor(baseMoneyReward * 1.5 * Number(playerSide.rewardMultiplier || 1)));
        moneyRewardGranted = true;
        await awardUserMoney(userId, reward);
        resultTracker.money += reward;
        await rewardText(player, io, `Tu remportes ${reward} Pokédollars !`, sleep);
        return reward;
    };

    try {
        if(options.recordPokedex!==false){
            await Promise.all(enemyTeam.pokemons.map((pokemon) => markPokemonSeen(userId, pokemon)));
            io.to(player.id).emit('pokedexChanged', { reason: 'trainer_seen' });
        }
    } catch (error) {
        console.error(`Erreur Pokédex combat dresseur user ${userId}:`, error.message);
    }

    const initialEnemyIndex = trainerTactics.replacementIndex(enemyTeam);
    if (initialEnemyIndex === -1) {
        await rewardText(player, io, 'Victoire !', sleep, 700);
        await finalizeVictory();
        endBattle(true);
        await editEquipe(userId, player.equipe);
        return true;
    }

    if (initialEnemyIndex !== 0) {
        [enemyTeam.pokemons[0], enemyTeam.pokemons[initialEnemyIndex]] = [enemyTeam.pokemons[initialEnemyIndex], enemyTeam.pokemons[0]];
    }

    let currentEnemy = enemyTeam.pokemons[0];
    const rewardedEnemies = new Set(enemyTeam.pokemons.filter((pokemon) => pokemon.currentHp <= 0));
    const experienceMultiplier = options.experienceKind === 'arena'
        ? BATTLE_EXPERIENCE_MULTIPLIERS.arena : BATTLE_EXPERIENCE_MULTIPLIERS.trainer;
    const grantDefeatedExperience = async () => {
        if (options.testRematch || options.grantExperience===false) return; // Narrative mirrors and owner replays grant no training rewards.
        // Inclut le dernier K.O. et ceux survenus lors d'un changement forcé.
        // Les instances sont suivies même si leur ordre dans l'équipe change.
        for (const defeated of enemyTeam.pokemons) {
            if (defeated.currentHp > 0 || rewardedEnemies.has(defeated)) continue;
            rewardedEnemies.add(defeated);
            let awards;
            try {
                awards = arenaRewards
                    ? await arenaRewards.reward(userId, player, defeated, experienceMultiplier, io, battleState.adventureExperience)
                    : battleState.adventureExperience.reward(player, defeated, experienceMultiplier, io);
            } catch (error) {
                // A failed atomic reward must not leave the client inside a dead battle.
                endBattle(false, { interrupted: true, reason: 'error' });
                throw error;
            }
            if (arenaRewards && awards.alreadyClaimed) await rewardText(player, io, `${getPokemonDisplayName(defeated)} a déjà donné son XP lors d’un précédent défi.`, sleep);
            for (const {pokemon, xp} of awards) await rewardText(player, io, `${getPokemonDisplayName(pokemon)} gagne ${xp} XP !`, sleep);
        }
    };

    const narrateDefeat = async () => {
        if (enemyTeam.__trainerPlan?.defeatLine) await narrate(player, io, enemyTeam.__trainerPlan.defeatLine, 2600);
        await narrate(player, io, 'Tu as perdu le combat...');
    };

    const handleForcedPlayerSwitch = async () => {
        const response = await requestReplacement(io, player);
        if (response.action === 'disconnect') {
            endBattle(false, { interrupted: true, reason: response.reason });
            await editEquipe(userId, player.equipe);
            return false;
        }
        const switched = response.action === 'change' && playerChangePokemonByIndex(player.equipe, response.number);
        if (!switched || !hasAlivePokemon(player.equipe.pokemons)) {
            await narrateDefeat();
            endBattle(false);
            await editEquipe(userId, player.equipe);
            return false;
        }

        displayIntroAnimation(player, currentEnemy, io, battleState);
        await narrate(player, io, `${getPokemonDisplayName(player.equipe.pokemons[0])} prend le relais !`, 900);
        await applySwitchInNarration(
            player,
            currentEnemy,
            io,
            player.equipe.pokemons[0],
            playerSide,
            enemySide,
            battleState
        );

        return true;
    };

    const executeEnemySwitch = async decision => {
        if (decision.action !== 'change' || !canSwitchOut(currentEnemy, player.equipe.pokemons[0], battleState)) return false;
        const previousEnemyName = getPokemonDisplayName(currentEnemy);
        if (!enemySwapPokemon(enemyTeam, decision.number, usedPokemons)) return false;
        battleState.trainerMemory.lastSwitchRound = round;
        currentEnemy = enemyTeam.pokemons[0];
        displayIntroAnimation(player, currentEnemy, io, battleState);
        await narrate(player, io, `Le dresseur rappelle ${previousEnemyName} et envoie ${getPokemonDisplayName(currentEnemy)} !`, 900);
        await applySwitchInNarration(player, currentEnemy, io, currentEnemy, enemySide, playerSide, battleState);
        return true;
    };

    displayIntroAnimation(player, currentEnemy, io, battleState);
    emitFieldState(io, player.id, battleState);
    await narrate(player, io, `Le dresseur envoie ${getPokemonDisplayName(currentEnemy)} !`, 900);
    await applySwitchInNarration(player, currentEnemy, io, player.equipe.pokemons[0], playerSide, enemySide, battleState);
    await applySwitchInNarration(player, currentEnemy, io, currentEnemy, enemySide, playerSide, battleState);

    while (hasAlivePokemon(enemyTeam.pokemons) && hasAlivePokemon(player.equipe.pokemons)) {
        currentEnemy = enemyTeam.pokemons[0];
        await grantDefeatedExperience();

        if (player.equipe.pokemons[0].currentHp <= 0) {
            const canContinue = await handleForcedPlayerSwitch();
            if (!canContinue) return false;
            continue; // A hazard K.O. must open a new replacement choice.
        }

        if (currentEnemy.currentHp <= 0) {
            const nextEnemyIndex = trainerTactics.replacementIndex(enemyTeam,{opponentTeam:player.equipe.pokemons,
                field:battleState,ownSide:enemySide,enemySide:playerSide,memory:battleState.trainerMemory,round:round+1});
            if (nextEnemyIndex === -1) {
                await rewardText(player, io, 'Victoire !', sleep, TEXT_DELAY_MS);
                await grantMoneyReward();
                await finalizeVictory();
                endBattle(true);
                await editEquipe(userId, player.equipe);
                return true;
            }

            if (nextEnemyIndex !== 0) {
                [enemyTeam.pokemons[0], enemyTeam.pokemons[nextEnemyIndex]] = [enemyTeam.pokemons[nextEnemyIndex], enemyTeam.pokemons[0]];
            }

            currentEnemy = enemyTeam.pokemons[0];
            displayIntroAnimation(player, currentEnemy, io, battleState);
            await narrate(player, io, `Le dresseur envoie ${getPokemonDisplayName(currentEnemy)} !`, 900);
            await applySwitchInNarration(player, currentEnemy, io, currentEnemy, enemySide, playerSide, battleState);
            continue;
        }

        // Commit against the pre-choice board. Invalid commands keep this choice.
        committedDecision ||= enemyDecision();
        let response;
        try {
            response = await playerTurn(player, io, battleState);
        } catch (error) {
            console.log('Erreur pendant le tour du joueur :', error.message);
            break;
        }

        const actionPlayer = response.action;

        if (actionPlayer === 'disconnect' || actionPlayer === 'timeout') {
            endBattle(false, {
                interrupted: true,
                reason: response.reason || actionPlayer
            });
            await editEquipe(userId, player.equipe);
            return false;
        }

        const playerPokemon = player.equipe.pokemons[0];
        if (actionPlayer === 'attack' && getUsableMoveIndexes(playerPokemon, battleState).length
            && !getUsableMoveIndexes(playerPokemon, battleState).includes(response.number)) continue;
        planTurnActions(battleState, [{ pokemon: playerPokemon, action: actionPlayer,
            moveName: selectedMoveName(playerPokemon, response.number) }]);

        if (actionPlayer === 'flee') {
            if (!canSwitchOut(playerPokemon, enemyTeam.pokemons[0], battleState, {escape:actionPlayer==='flee'})) {
                await narrate(player, io, `${getPokemonDisplayName(playerPokemon)} est piege et ne peut pas fuir.`);
                continue;
            }

            await narrate(player, io, 'Tu prends la fuite !', 800);
            endBattle(false, { fled: true });
            await editEquipe(userId, player.equipe);
            return true;
        }

        if (actionPlayer === 'bag') {
            await narrate(player, io, 'Les objets de capture sont seulement utilisables contre les Pokemon sauvages.');
            continue;
        }

        if (actionPlayer === 'change') {
            if (!canSwitchOut(playerPokemon, enemyTeam.pokemons[0], battleState, {escape:actionPlayer==='flee'})) {
                await narrate(player, io, `${getPokemonDisplayName(playerPokemon)} est piege et ne peut pas changer.`);
                continue;
            }

            const outgoingUuid = playerPokemon.uuid;
            const changed = playerChangePokemonByIndex(player.equipe, Number.parseInt(response.number, 10));
            if (!changed) {
                await narrate(player, io, 'Changement impossible.');
                continue;
            }

            round++;
            const decision = committedDecision; committedDecision = null;
            planTurnActions(battleState, [
                {pokemon:playerPokemon,action:'change'},
                {pokemon:currentEnemy,action:decision.action,moveName:decision.action==='attack'?selectedMoveName(currentEnemy,decision.number):null}
            ]);
            displayIntroAnimation(player, currentEnemy, io, battleState);
            await narrate(player, io, `${getPokemonDisplayName(player.equipe.pokemons[0])} est maintenant en combat !`, 900);
            await applySwitchInNarration(player, currentEnemy, io, player.equipe.pokemons[0], playerSide, enemySide, battleState);

            await executeEnemySwitch(decision);
            if (decision.action === 'attack' && currentEnemy.currentHp > 0 && player.equipe.pokemons[0].currentHp > 0) {
                const enemyMove = decision.number;
                await performAttackWithNarration(
                    currentEnemy,
                    player.equipe.pokemons[0],
                    enemyMove,
                    player,
                    currentEnemy,
                    io,
                    {
                        battleState,
                        attackerSide: enemySide,
                        defenderSide: playerSide,
                        attackerTeam: enemyTeam.pokemons,
                        defenderTeam: player.equipe.pokemons
                    }
                );
                currentEnemy = enemyTeam.pokemons[0];
            }

            require('./humanTrainerAI').observeTurn(battleState.trainerMemory,outgoingUuid,player.equipe.pokemons[0],'change');

            const roundResult = await resolveRoundEnd(player, currentEnemy, io, battleState, playerSide, enemySide);
            if (roundResult === 'player_ko') {
                const canContinue = await handleForcedPlayerSwitch();
                if (!canContinue) return false;
            }

            continue;
        }

        if (actionPlayer !== 'attack') {
            continue;
        }

        const playerMove = Number.isInteger(response.number) ? response.number : getRandomNumber(playerPokemon);
        const playerMoveName = selectedMoveName(playerPokemon, playerMove);
        round++;
        const decision = committedDecision; committedDecision = null;
        const enemyMove = decision.action === 'attack' ? decision.number : -1;
        const enemyMoveName = selectedMoveName(currentEnemy, enemyMove);
        const enemySwitched = await executeEnemySwitch(decision);
        require('./humanTrainerAI').observeTurn(battleState.trainerMemory,playerPokemon.uuid,playerPokemon,'attack');

        if (currentEnemy.currentHp <= 0 || playerPokemon.currentHp <= 0) {
            await resolveRoundEnd(player, currentEnemy, io, battleState, playerSide, enemySide);
            continue;
        }
        planTurnActions(battleState, [
            { pokemon: playerPokemon, action: 'attack', moveName: playerMoveName },
            { pokemon: currentEnemy, action: decision.action, moveName: enemyMoveName }
        ]);
        const playerActsFirst = decision.action === 'change' || decideMoveOrder(playerPokemon, playerMoveName, currentEnemy, enemyMoveName, battleState);

        if (playerActsFirst) {
            const playerResult = await performAttackWithNarration(
                playerPokemon,
                currentEnemy,
                playerMove,
                player,
                currentEnemy,
                io,
                {
                    battleState,
                    attackerSide: playerSide,
                    defenderSide: enemySide,
                    attackerTeam: player.equipe.pokemons,
                    defenderTeam: enemyTeam.pokemons
                }
            );
            currentEnemy = enemyTeam.pokemons[0];

            if (!battleState.switchDisconnected && decision.action === 'attack' && !enemySwitched && !playerResult?.switches?.defender
                && currentEnemy.currentHp > 0
                && player.equipe.pokemons[0].currentHp > 0) {
                await performAttackWithNarration(
                    currentEnemy,
                    player.equipe.pokemons[0],
                    enemyMove,
                    player,
                    currentEnemy,
                    io,
                    {
                        battleState,
                        attackerSide: enemySide,
                        defenderSide: playerSide,
                        attackerTeam: enemyTeam.pokemons,
                        defenderTeam: player.equipe.pokemons
                    }
                );
                currentEnemy = enemyTeam.pokemons[0];
            }
        } else {
            const enemyResult = await performAttackWithNarration(
                currentEnemy,
                playerPokemon,
                enemyMove,
                player,
                currentEnemy,
                io,
                {
                    battleState,
                    attackerSide: enemySide,
                    defenderSide: playerSide,
                    attackerTeam: enemyTeam.pokemons,
                    defenderTeam: player.equipe.pokemons
                }
            );
            currentEnemy = enemyTeam.pokemons[0];

            if (!battleState.switchDisconnected && !enemyResult?.switches?.defender
                && player.equipe.pokemons[0].currentHp > 0
                && currentEnemy.currentHp > 0) {
                await performAttackWithNarration(
                    player.equipe.pokemons[0],
                    currentEnemy,
                    playerMove,
                    player,
                    currentEnemy,
                    io,
                    {
                        battleState,
                        attackerSide: playerSide,
                        defenderSide: enemySide,
                        attackerTeam: player.equipe.pokemons,
                        defenderTeam: enemyTeam.pokemons
                    }
                );
                currentEnemy = enemyTeam.pokemons[0];
            }
        }

        if (battleState.switchDisconnected) {
            endBattle(false, { interrupted:true, reason:'player_disconnected' });
            await editEquipe(userId, player.equipe);
            return false;
        }
        const roundResult = await resolveRoundEnd(player, currentEnemy, io, battleState, playerSide, enemySide);
        if (roundResult === 'player_ko') {
            const canContinue = await handleForcedPlayerSwitch();
            if (!canContinue) return false;
        }
    }

    await grantDefeatedExperience();
    const playerHasPokemonAlive = hasAlivePokemon(player.equipe.pokemons);
    const enemyHasPokemonAlive = hasAlivePokemon(enemyTeam.pokemons);

    if (!enemyHasPokemonAlive && playerHasPokemonAlive) {
        await rewardText(player, io, 'Victoire !', sleep, TEXT_DELAY_MS);
        await grantMoneyReward();
        await finalizeVictory();
        endBattle(true);
    } else if (!playerHasPokemonAlive) {
        await narrateDefeat();
        endBattle(false);
    } else {
        endBattle(false, { interrupted: true });
    }

    await editEquipe(userId, player.equipe);
    return true;
}

module.exports = require('./partyOrder').preservePartyOrder(startTeamBattle);
