const presentation = require('./presentationState');
const { rewardTraining } = require('../models/training');
const {
    useattack,
    getEffectiveness,
    getMoveByName,
    orderBattleActions,
    calculateDamage,
    createBattleState,
    processEndOfRound,
    applySwitchInEffects,
    canSwitchOut
} = require('./battleEngine');
const { getUsableMoveIndexes } = require('./battleResources');
const { calculateBattleExperience, BATTLE_EXPERIENCE_MULTIPLIERS } = require('../models/progression');
const { emitSoloBattleEnd, createBattleSummaryTracker } = require('./battleOutcome');
const { emitFieldState, emitSoloMoveResult } = require('./battleEvents');
const {
    autoSwitchPokemon,
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

function loadMovesData() {
    return require('../../../data/game/moves.json');
}

function getPokemonDisplayName(pokemon) {
    if (!pokemon) return 'Pokemon';
    return pokemon.truename || pokemon.name || 'Pokemon';
}

function getMoveName(pokemon, moveIndex) {
    if (!pokemon || typeof pokemon.getAtkName !== 'function') {
        return 'une attaque';
    }

    const moveName = pokemon.getAtkName(moveIndex);
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

function displayIntroAnimation(player, currentEnemy, io) {
    io.to(player.id).emit('introAnimation', { player, wildPokemon: currentEnemy, transitions:presentation.transitions(player,player.equipe.pokemons[0],currentEnemy) });
}

function displayMoveAnimation(player, attacker, moveName, io) {
    const move = getMoveByName(moveName);
    io.to(player.id).emit('battleMoveAnimation', {
        actor: attacker === player?.equipe?.pokemons?.[0] ? 'player' : 'opponent',
        moveName,
        moveType: move?.type || 'Normal',
        damageClass: move?.combat?.damage_class || 'status'
    });
}

function decideMoveOrder(playerPokemon, playerMoveName, enemyPokemon, enemyMoveName, battleState) {
    return orderBattleActions([
        { key: 'player', pokemon: playerPokemon, moveName: playerMoveName, side: battleState?.sides?.player },
        { key: 'enemy', pokemon: enemyPokemon, moveName: enemyMoveName, side: battleState?.sides?.enemy }
    ], battleState)[0]?.key === 'player';
}

function performAttack(attacker, defender, moveIndex, battleContext) {
    return useattack(attacker.getAtkName(moveIndex), attacker, defender, battleContext);
}

async function performAttackWithNarration(attacker, defender, moveIndex, player, currentEnemy, io, battleContext) {
    const attackerName = getPokemonDisplayName(attacker);
    const defenderName = getPokemonDisplayName(defender);
    const moveName = getMoveName(attacker, moveIndex);

    displayMoveAnimation(player, attacker, moveName, io);
    await narrate(player, io, `${attackerName} utilise ${moveName} !`);
    const result = performAttack(attacker, defender, moveIndex, battleContext);
    emitSoloMoveResult(io, player, attacker, result, battleContext?.battleState);
    displayIntroAnimation(player, currentEnemy, io);
    await sleep(SHORT_DELAY_MS);
    await narrateMessages(player, io, result.messages, 950);

    const switches = resolveMoveSwitches(
        result,
        battleContext?.attackerTeam,
        battleContext?.defenderTeam
    );
    result.switches = switches;

    if (switches.defender?.incoming) {
        await narrate(player, io, `${getPokemonDisplayName(switches.defender.incoming)} est force d'entrer en combat !`, 900);
        await applySwitchInNarration(
            player, switches.defender.incoming, io, switches.defender.incoming,
            battleContext.defenderSide, battleContext.attackerSide, battleContext.battleState
        );
    }

    if (switches.attacker?.incoming) {
        await narrate(player, io, `${getPokemonDisplayName(switches.attacker.incoming)} prend le relais !`, 900);
        await applySwitchInNarration(
            player, switches.attacker.incoming, io, switches.attacker.incoming,
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
    const enemyPokemon = switchedPokemon === currentEnemy
        ? player?.equipe?.pokemons?.[0]
        : currentEnemy;
    const switchMessages = applySwitchInEffects(switchedPokemon, ownSide, enemySide, battleState, enemyPokemon);
    emitFieldState(io, player?.id, battleState);
    if (switchMessages.length === 0) return;

    displayIntroAnimation(player, currentEnemy, io);
    await sleep(SHORT_DELAY_MS);
    await narrateMessages(player, io, switchMessages, 950);
}

async function resolveRoundEnd(player, currentEnemy, io, battleState, playerSide, enemySide) {
    const playerPokemon = player.equipe.pokemons[0];
    const roundMessages = processEndOfRound(playerPokemon, currentEnemy, playerSide, enemySide, battleState);
    emitFieldState(io, player?.id, battleState);

    if (roundMessages.length > 0) {
        displayIntroAnimation(player, currentEnemy, io);
        await sleep(SHORT_DELAY_MS);
        await narrateMessages(player, io, roundMessages, 950);
    }

    if (currentEnemy.currentHp <= 0) return 'enemy_ko';
    if (playerPokemon.currentHp <= 0) return 'player_ko';
    return 'continue';
}

function resolveEnemyMoveIndex(playerPokemon, currentEnemy, moves) {
    const bestAttack = getBestAttack(playerPokemon, currentEnemy, moves);
    if (Number.isInteger(bestAttack) && bestAttack >= 0) {
        return bestAttack;
    }

    return getRandomNumber(currentEnemy);
}

function getRandomNumber(pokemon) {
    const indexes = getUsableMoveIndexes(pokemon);
    if (indexes.length === 0) return 0;
    return indexes[Math.floor(Math.random() * indexes.length)];
}

function playerChangePokemonByIndex(equipe, index) {
    return switchPokemonByIndex(equipe, index);
}

function playerChangePokemon(equipe) {
    return autoSwitchPokemon(equipe);
}

function playerTurn(player, io) {
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


function determineIfSwap(currentEnemy, enemyTeam, playerPokemon) {
    let currentEffectiveness = getEffectiveness(playerPokemon.type1, currentEnemy.type1) *
        (currentEnemy.type2 ? getEffectiveness(playerPokemon.type1, currentEnemy.type2) : 1);

    if (playerPokemon.type2) {
        currentEffectiveness *= getEffectiveness(playerPokemon.type2, currentEnemy.type1) *
            (currentEnemy.type2 ? getEffectiveness(playerPokemon.type2, currentEnemy.type2) : 1);
    }

    let bestSwap = false;
    let bestEffectiveness = currentEffectiveness;

    enemyTeam.pokemons.forEach((pokemon, index) => {
        if (pokemon.uuid === currentEnemy.uuid || pokemon.currentHp <= 0) return;

        let swapEffectiveness = getEffectiveness(playerPokemon.type1, pokemon.type1) *
            (pokemon.type2 ? getEffectiveness(playerPokemon.type1, pokemon.type2) : 1);

        if (playerPokemon.type2) {
            swapEffectiveness *= getEffectiveness(playerPokemon.type2, pokemon.type1) *
                (pokemon.type2 ? getEffectiveness(playerPokemon.type2, pokemon.type2) : 1);
        }

        if (swapEffectiveness < bestEffectiveness) {
            bestEffectiveness = swapEffectiveness;
            bestSwap = index;
        }
    });

    return bestSwap !== false && bestEffectiveness < currentEffectiveness ? bestSwap : false;
}

function enemySwapPokemon(enemyTeam, index, usedPokemons) {
    if (index < 0 || index >= enemyTeam.pokemons.length) return false;
    if (enemyTeam.pokemons[index].currentHp <= 0) return false;

    [enemyTeam.pokemons[0], enemyTeam.pokemons[index]] = [enemyTeam.pokemons[index], enemyTeam.pokemons[0]];

    if (!usedPokemons.includes(enemyTeam.pokemons[0].uuid)) {
        usedPokemons.push(enemyTeam.pokemons[0].uuid);
    }

    return true;
}

function getBestAttack(me, enemy, moves) {
    if (!enemy || !Array.isArray(enemy.abilities) || enemy.abilities.length === 0) {
        return -1;
    }

    return enemy.abilities
        .map((ability, index) => {
            const move = moves.find((m) => m.ename === ability);
            if (!move) {
                return { index, score: -Infinity };
            }

            const stab = (move.type === enemy.type1 || (enemy.type2 && move.type === enemy.type2)) ? 1.5 : 1;
            const effectiveness1 = getEffectiveness(move.type, me.type1) || 1;
            const effectiveness2 = me.type2 ? (getEffectiveness(move.type, me.type2) || 1) : 1;
            const totalEffectiveness = effectiveness1 * effectiveness2;
            const score = Number(move.power || 0) * totalEffectiveness * stab;

            return { index, score };
        })
        .reduce((best, move) => (move.score > best.score ? move : best), { index: -1, score: -Infinity })
        .index;
}

function findDmgAtk(attackName, pokemon1, pokemon2) {
    const move = getMoveByName(attackName);
    if (!move) return 0;
    return calculateDamage(pokemon1, pokemon2, move);
}

async function startTeamBattle(player, enemyTeam, io, userId, options = {}) {
    presentation.reset(player);
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
                    await narrate(player, io, `Tu reçois ${progressionReward.money} Pokédollars !`, 900);
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
        await narrate(player, io, 'Victoire !', 700);
        await finalizeVictory();
        endBattle(true);
        await editEquipe(userId, player.equipe);
        return true;
    }

    const moves = loadMovesData();
    const usedPokemons = [];
    const battleState = createBattleState();
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
        await narrate(player, io, `Tu remportes ${reward} Pokédollars !`, 900);
        return reward;
    };

    try {
        await Promise.all(enemyTeam.pokemons.map((pokemon) => markPokemonSeen(userId, pokemon)));
        io.to(player.id).emit('pokedexChanged', { reason: 'trainer_seen' });
    } catch (error) {
        console.error(`Erreur Pokédex combat dresseur user ${userId}:`, error.message);
    }

    const initialEnemyIndex = enemyTeam.pokemons.findIndex((pokemon) => pokemon.currentHp > 0);
    if (initialEnemyIndex === -1) {
        await narrate(player, io, 'Victoire !', 700);
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
        const recipient = player.equipe.pokemons[0];
        if (!recipient || recipient.currentHp <= 0 || typeof recipient.gainExperience !== 'function') return;
        // Inclut le dernier K.O. et ceux survenus lors d'un changement forcé.
        // Les instances sont suivies même si leur ordre dans l'équipe change.
        for (const defeated of enemyTeam.pokemons) {
            if (defeated.currentHp > 0 || rewardedEnemies.has(defeated)) continue;
            rewardedEnemies.add(defeated);
            const xp = calculateBattleExperience(defeated, experienceMultiplier, recipient);
            rewardTraining(recipient, defeated, xp, io, player.id);
            await narrate(player, io, `${getPokemonDisplayName(recipient)} gagne ${xp} XP !`, 900);
        }
    };

    const handleForcedPlayerSwitch = async () => {
        const switched = playerChangePokemon(player.equipe);
        if (!switched || !hasAlivePokemon(player.equipe.pokemons)) {
            await narrate(player, io, 'Tu as perdu le combat...');
            endBattle(false);
            await editEquipe(userId, player.equipe);
            return false;
        }

        displayIntroAnimation(player, currentEnemy, io);
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

    displayIntroAnimation(player, currentEnemy, io);
    await narrate(player, io, `Le dresseur envoie ${getPokemonDisplayName(currentEnemy)} !`, 900);
    await applySwitchInNarration(player, currentEnemy, io, player.equipe.pokemons[0], playerSide, enemySide, battleState);
    await applySwitchInNarration(player, currentEnemy, io, currentEnemy, enemySide, playerSide, battleState);

    while (hasAlivePokemon(enemyTeam.pokemons) && hasAlivePokemon(player.equipe.pokemons)) {
        currentEnemy = enemyTeam.pokemons[0];
        await grantDefeatedExperience();

        if (player.equipe.pokemons[0].currentHp <= 0) {
            const canContinue = await handleForcedPlayerSwitch();
            if (!canContinue) return false;
        }

        if (currentEnemy.currentHp <= 0) {
            const nextEnemyIndex = enemyTeam.pokemons.findIndex((pokemon) => pokemon.currentHp > 0);
            if (nextEnemyIndex === -1) {
                await narrate(player, io, 'Victoire !');
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
            displayIntroAnimation(player, currentEnemy, io);
            await narrate(player, io, `Le dresseur envoie ${getPokemonDisplayName(currentEnemy)} !`, 900);
            await applySwitchInNarration(player, currentEnemy, io, currentEnemy, enemySide, playerSide, battleState);
            continue;
        }

        let response;
        try {
            response = await playerTurn(player, io);
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

            const changed = playerChangePokemonByIndex(player.equipe, Number.parseInt(response.number, 10));
            if (!changed) {
                await narrate(player, io, 'Changement impossible.');
                continue;
            }

            displayIntroAnimation(player, currentEnemy, io);
            await narrate(player, io, `${getPokemonDisplayName(player.equipe.pokemons[0])} est maintenant en combat !`, 900);
            await applySwitchInNarration(player, currentEnemy, io, player.equipe.pokemons[0], playerSide, enemySide, battleState);

            if (currentEnemy.currentHp > 0 && player.equipe.pokemons[0].currentHp > 0) {
                const enemyMove = resolveEnemyMoveIndex(player.equipe.pokemons[0], currentEnemy, moves);
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

            if (currentEnemy.currentHp > 0 && player.equipe.pokemons[0].currentHp > 0) {
                const roundResult = await resolveRoundEnd(player, currentEnemy, io, battleState, playerSide, enemySide);
                if (roundResult === 'player_ko') {
                    const canContinue = await handleForcedPlayerSwitch();
                    if (!canContinue) return false;
                }
            }

            continue;
        }

        if (actionPlayer !== 'attack') {
            continue;
        }

        const playerMove = Number.isInteger(response.number) ? response.number : getRandomNumber(playerPokemon);
        const playerMoveName = playerPokemon.getAtkName(playerMove);
        let enemyMove = resolveEnemyMoveIndex(playerPokemon, currentEnemy, moves);
        let enemyMoveName = currentEnemy.getAtkName(enemyMove);

        const haveToSwap = determineIfSwap(currentEnemy, enemyTeam, playerPokemon);
        const enemyDamagePreview = findDmgAtk(enemyMoveName, currentEnemy, playerPokemon);

        if (haveToSwap !== false && enemyDamagePreview < playerPokemon.currentHp) {
            const previousEnemyName = getPokemonDisplayName(currentEnemy);
            const swapped = enemySwapPokemon(enemyTeam, haveToSwap, usedPokemons);
            if (swapped) {
                currentEnemy = enemyTeam.pokemons[0];
                displayIntroAnimation(player, currentEnemy, io);
                await narrate(
                    player,
                    io,
                    `Le dresseur rappelle ${previousEnemyName} et envoie ${getPokemonDisplayName(currentEnemy)} !`,
                    900
                );
                await applySwitchInNarration(player, currentEnemy, io, currentEnemy, enemySide, playerSide, battleState);
                enemyMove = resolveEnemyMoveIndex(playerPokemon, currentEnemy, moves);
                enemyMoveName = currentEnemy.getAtkName(enemyMove);
            }
        }

        const playerActsFirst = decideMoveOrder(playerPokemon, playerMoveName, currentEnemy, enemyMoveName, battleState);

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

            if (!playerResult?.switches?.defender
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

            if (!enemyResult?.switches?.defender
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

        if (currentEnemy.currentHp > 0 && player.equipe.pokemons[0].currentHp > 0) {
            const roundResult = await resolveRoundEnd(player, currentEnemy, io, battleState, playerSide, enemySide);
            if (roundResult === 'player_ko') {
                const canContinue = await handleForcedPlayerSwitch();
                if (!canContinue) return false;
            }
        }
    }

    await grantDefeatedExperience();
    const playerHasPokemonAlive = hasAlivePokemon(player.equipe.pokemons);
    const enemyHasPokemonAlive = hasAlivePokemon(enemyTeam.pokemons);

    if (!enemyHasPokemonAlive) {
        await narrate(player, io, 'Victoire !');
        await grantMoneyReward();
        await finalizeVictory();
        endBattle(true);
    } else if (!playerHasPokemonAlive) {
        await narrate(player, io, 'Tu as perdu le combat...');
        endBattle(false);
    } else {
        endBattle(false, { interrupted: true });
    }

    await editEquipe(userId, player.equipe);
    return true;
}

module.exports = startTeamBattle;
