const { requestReplacement } = require('./replacementChoice');
const presentation = require('./presentationState');
const {
    useattack,
    getMoveByName,
    resolveWeatherMove,
    battleMoveTypes,
    createBattleState,
    orderBattleActions,
    processEndOfRound,
    applySwitchInEffects,
    canSwitchOut
} = require('./battleEngine');
const { getUsableMoveIndexes } = require('./battleResources');
const { editEquipe } = require('../../persistence/teamRepository');
const { emitPvpBattleEnd } = require('./battleOutcome');
const { emitFieldState, emitPvpMoveResult } = require('./battleEvents');
const {
    getFirstAliveIndex,
    hasAlivePokemon,
    resolveMoveSwitches,
    switchPokemonByIndex: swapToIndex
} = require('./battleTeam');
const { markPokemonSeen } = require('../../persistence/progressionRepository');

const TEXT_DELAY_MS = 1250;
const SHORT_DELAY_MS = 500;
const ACTION_TIMEOUT_MS = 90000;

function sleep(ms) {
    const configuredScale = Number(process.env.BATTLE_DELAY_SCALE);
    const scale = process.env.NODE_ENV === 'test' && Number.isFinite(configuredScale)
        ? Math.max(0, configuredScale)
        : 1;
    return new Promise((resolve) => setTimeout(resolve, Math.round(ms * scale)));
}

function getTrainerName(player) {
    if (!player) return 'Joueur';
    if (typeof player.username === 'string' && player.username.trim()) {
        return player.username.trim();
    }
    return `Joueur ${player.userId ?? ''}`.trim();
}

function getPokemonDisplayName(pokemon) {
    if (!pokemon) return 'Pokemon';
    return pokemon.truename || pokemon.name || 'Pokemon';
}

function getRandomMoveIndex(pokemon) {
    const indexes = getUsableMoveIndexes(pokemon);
    if (indexes.length === 0) return 0;
    return indexes[Math.floor(Math.random() * indexes.length)];
}

function decideMoveOrder(pokemonA, moveAName, pokemonB, moveBName, battleState) {
    return orderBattleActions([
        { key: 'A', pokemon: pokemonA, moveName: moveAName, side: battleState?.sides?.player },
        { key: 'B', pokemon: pokemonB, moveName: moveBName, side: battleState?.sides?.enemy }
    ], battleState)[0]?.key || 'A';
}

function getPlayerSocket(io, player) {
    if (!player?.id) return null;
    return io.sockets.sockets.get(player.id) || null;
}

async function narrateToPlayer(io, player, message, delayMs = TEXT_DELAY_MS) {
    if (!player?.id || !message) return;
    io.to(player.id).emit('battleText', { message });
    if (delayMs > 0) {
        await sleep(delayMs);
    }
}

async function narrateToBoth(io, playerA, playerB, message, delayMs = TEXT_DELAY_MS) {
    if (!message) return;
    if (playerA?.id) io.to(playerA.id).emit('battleText', { message });
    if (playerB?.id) io.to(playerB.id).emit('battleText', { message });
    if (delayMs > 0) {
        await sleep(delayMs);
    }
}

function emitBattleStateForBoth(io, playerA, playerB, battleState) {
    if (!playerA || !playerB) return;

    io.to(playerA.id).emit('introAnimation', {
        moveTypes:battleMoveTypes(playerA.equipe.pokemons[0],playerB.equipe.pokemons[0],battleState),
        player: playerA,
        transitions:presentation.transitions(playerA,playerA.equipe.pokemons[0],playerB.equipe.pokemons[0]),
        wildPokemon: playerB?.equipe?.pokemons?.[0] || null,
        battleType: 'pvp',
        enemyPlayer: {
            id: playerB.id,
            userId: playerB.userId
        }
    });

    io.to(playerB.id).emit('introAnimation', {
        moveTypes:battleMoveTypes(playerB.equipe.pokemons[0],playerA.equipe.pokemons[0],battleState),
        player: playerB,
        transitions:presentation.transitions(playerB,playerB.equipe.pokemons[0],playerA.equipe.pokemons[0]),
        wildPokemon: playerA?.equipe?.pokemons?.[0] || null,
        battleType: 'pvp',
        enemyPlayer: {
            id: playerA.id,
            userId: playerA.userId
        }
    });
}

function emitMoveAnimationForBoth(io, attackerPlayer, defenderPlayer, moveName, battleState) {
    const move = resolveWeatherMove(getMoveByName(moveName),attackerPlayer.equipe.pokemons[0],defenderPlayer.equipe.pokemons[0],battleState);
    const movePayload = {
        moveName,
        moveType: move?.type || 'Normal',
        moveTarget: move?.combat?.target || 'opponent',
        damageClass: move?.combat?.damage_class || 'status'
    };

    io.to(attackerPlayer.id).emit('battleMoveAnimation', {
        ...movePayload,
        actor: 'player'
    });
    io.to(defenderPlayer.id).emit('battleMoveAnimation', {
        ...movePayload,
        actor: 'opponent'
    });
}

async function requestPlayerAction(io, player, message = 'Quelle est votre prochaine action ?') {
    const socket = getPlayerSocket(io, player);
    if (!socket) {
        return {
            action: 'flee',
            disconnected: true
        };
    }

    socket.emit('requestAction', { message });

    return new Promise((resolve) => {
        let timeoutId = null;

        const cleanup = () => {
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
            socket.off('actionResponse', onResponse);
            socket.off('disconnect', onDisconnect);
        };

        const onResponse = (response = {}) => {
            if (response?.replacementId) return;
            cleanup();
            resolve(response);
        };

        const onDisconnect = () => {
            cleanup();
            resolve({
                action: 'flee',
                disconnected: true
            });
        };

        socket.on('actionResponse', onResponse);
        socket.once('disconnect', onDisconnect);

        timeoutId = setTimeout(() => {
            cleanup();
            resolve({
                action: 'attack',
                timedOut: true
            });
        }, ACTION_TIMEOUT_MS);
    });
}

function normalizeAction(rawAction, player) {
    const pokemon = player?.equipe?.pokemons?.[0];
    const normalizedAction = typeof rawAction?.action === 'string'
        ? rawAction.action.toLowerCase()
        : 'attack';

    if (normalizedAction === 'flee') {
        return { action: 'flee' };
    }

    if (normalizedAction === 'bag') {
        return {
            action: 'invalid_bag',
            moveIndex: getRandomMoveIndex(pokemon)
        };
    }

    if (normalizedAction === 'change') {
        const changeIndex = Number.parseInt(rawAction?.number, 10);
        return {
            action: 'change',
            index: Number.isInteger(changeIndex) ? changeIndex : -1
        };
    }

    const moveIndex = Number.isInteger(rawAction?.number)
        ? rawAction.number
        : Number.parseInt(rawAction?.number, 10);

    return {
        action: 'attack',
        moveIndex: Number.isInteger(moveIndex) && moveIndex >= 0
            ? moveIndex
            : getRandomMoveIndex(pokemon)
    };
}

async function applySwitchInNarration(io, actorPlayer, enemyPlayer, switchedPokemon, ownSide, enemySide, battleState) {
    const enemyPokemon = enemyPlayer?.equipe?.pokemons?.[0] || null;
    const switchMessages = applySwitchInEffects(switchedPokemon, ownSide, enemySide, battleState, enemyPokemon);
    emitFieldState(io, [actorPlayer?.id, enemyPlayer?.id], battleState);
    if (!Array.isArray(switchMessages) || switchMessages.length === 0) return;

    emitBattleStateForBoth(io, actorPlayer, enemyPlayer, battleState);
    await sleep(SHORT_DELAY_MS);

    for (const message of switchMessages) {
        if (!message) continue;
        await narrateToBoth(io, actorPlayer, enemyPlayer, message, 900);
    }
}

async function ensureActivePokemonAlive(io, actorPlayer, enemyPlayer, ownSide, enemySide, battleState) {
    const team = actorPlayer?.equipe?.pokemons;
    if (!Array.isArray(team) || !hasAlivePokemon(team)) {
        return false;
    }

    const activePokemon = team[0];
    if (activePokemon && Number(activePokemon.currentHp || 0) > 0) {
        return true;
    }

    // Hazards may knock out several entrants; each replacement is chosen separately.
    while (Number(team[0]?.currentHp || 0) <= 0 && hasAlivePokemon(team)) {
        const response = await requestReplacement(io, actorPlayer, { timeoutMs: ACTION_TIMEOUT_MS });
        if (response.action !== 'change' || !swapToIndex(team, response.number)) return false;
        const nextPokemon = team[0];
        await narrateToBoth(
            io,
            actorPlayer,
            enemyPlayer,
            `${getTrainerName(actorPlayer)} envoie ${getPokemonDisplayName(nextPokemon)} !`,
            900
        );
        emitBattleStateForBoth(io, actorPlayer, enemyPlayer, battleState);
        await applySwitchInNarration(io, actorPlayer, enemyPlayer, nextPokemon, ownSide, enemySide, battleState);

    }
    return Number(team[0]?.currentHp || 0) > 0;
}

async function performAttack(io, attackerPlayer, defenderPlayer, moveIndex, attackerSide, defenderSide, battleState) {
    const attackerPokemon = attackerPlayer?.equipe?.pokemons?.[0];
    const defenderPokemon = defenderPlayer?.equipe?.pokemons?.[0];

    if (!attackerPokemon || !defenderPokemon) {
        return;
    }

    if (Number(attackerPokemon.currentHp || 0) <= 0 || Number(defenderPokemon.currentHp || 0) <= 0) {
        return;
    }

    const selectedMoveIndex = Number.isInteger(moveIndex)
        ? moveIndex
        : getRandomMoveIndex(attackerPokemon);
    const moveName = attackerPokemon.getAtkName(selectedMoveIndex) || 'une attaque';

    emitMoveAnimationForBoth(io, attackerPlayer, defenderPlayer, moveName, battleState);

    await narrateToBoth(
        io,
        attackerPlayer,
        defenderPlayer,
        `${getTrainerName(attackerPlayer)}: ${getPokemonDisplayName(attackerPokemon)} utilise ${moveName} !`
    );

    const attackResult = useattack(moveName, attackerPokemon, defenderPokemon, {
        battleState,
        attackerSide,
        defenderSide,
        attackerTeam: attackerPlayer.equipe.pokemons,
        defenderTeam: defenderPlayer.equipe.pokemons
    });

    emitPvpMoveResult(io, attackerPlayer, defenderPlayer, attackResult, battleState);

    emitBattleStateForBoth(io, attackerPlayer, defenderPlayer, battleState);
    await sleep(SHORT_DELAY_MS);

    if (Array.isArray(attackResult?.messages)) {
        for (const message of attackResult.messages) {
            if (!message) continue;
            await narrateToBoth(io, attackerPlayer, defenderPlayer, message, 900);
        }
    }

    const switches = resolveMoveSwitches(
        attackResult,
        attackerPlayer.equipe.pokemons,
        defenderPlayer.equipe.pokemons
    );
    attackResult.switches = switches;

    if (switches.defender?.incoming) {
        await narrateToBoth(
            io, attackerPlayer, defenderPlayer,
            `${getTrainerName(defenderPlayer)} est force d'envoyer ${getPokemonDisplayName(switches.defender.incoming)} !`, 900
        );
        emitBattleStateForBoth(io, attackerPlayer, defenderPlayer, battleState);
        await applySwitchInNarration(
            io, defenderPlayer, attackerPlayer, switches.defender.incoming,
            defenderSide, attackerSide, battleState
        );
    }

    if (switches.attacker?.incoming) {
        await narrateToBoth(
            io, attackerPlayer, defenderPlayer,
            `${getTrainerName(attackerPlayer)} envoie ${getPokemonDisplayName(switches.attacker.incoming)} !`, 900
        );
        emitBattleStateForBoth(io, attackerPlayer, defenderPlayer, battleState);
        await applySwitchInNarration(
            io, attackerPlayer, defenderPlayer, switches.attacker.incoming,
            attackerSide, defenderSide, battleState
        );
    }

    if (Number(attackerPokemon.currentHp || 0) <= 0) {
        await narrateToBoth(
            io,
            attackerPlayer,
            defenderPlayer,
            `${getPokemonDisplayName(attackerPokemon)} tombe K.O. !`
        );
    }

    if (Number(defenderPokemon.currentHp || 0) <= 0) {
        await narrateToBoth(
            io,
            attackerPlayer,
            defenderPlayer,
            `${getPokemonDisplayName(defenderPokemon)} tombe K.O. !`
        );
    }

    return attackResult;
}

async function persistTeams(playerA, playerB) {
    const saveTasks = [];

    if (Number.isInteger(playerA?.userId) && playerA?.equipe) {
        saveTasks.push(editEquipe(playerA.userId, playerA.equipe));
    }

    if (Number.isInteger(playerB?.userId) && playerB?.equipe) {
        saveTasks.push(editEquipe(playerB.userId, playerB.equipe));
    }

    if (saveTasks.length === 0) return;

    try {
        await Promise.all(saveTasks);
    } catch (error) {
        console.error('Erreur sauvegarde equipe PVP:', error?.message || error);
    }
}

function emitBattleEnd(io, playerA, playerB, winnerId = null, reason = 'finished') {
    return emitPvpBattleEnd(io, playerA, playerB, winnerId, reason);
}

async function startPvpBattle(playerA, playerB, io) {
    presentation.reset(playerA);presentation.reset(playerB);
    if (!playerA || !playerB) {
        return {
            winnerId: null,
            reason: 'invalid_players'
        };
    }

    const teamA = playerA?.equipe?.pokemons;
    const teamB = playerB?.equipe?.pokemons;

    if (!Array.isArray(teamA) || !Array.isArray(teamB)) {
        emitBattleEnd(io, playerA, playerB, null, 'invalid_team');
        return {
            winnerId: null,
            reason: 'invalid_team'
        };
    }

    try {
        const trackingTasks = [];
        if (Number.isInteger(playerA.userId) && playerA.userId > 0) {
            trackingTasks.push(...teamB.map((pokemon) => markPokemonSeen(playerA.userId, pokemon)));
        }
        if (Number.isInteger(playerB.userId) && playerB.userId > 0) {
            trackingTasks.push(...teamA.map((pokemon) => markPokemonSeen(playerB.userId, pokemon)));
        }
        if (trackingTasks.length > 0) {
            await Promise.all(trackingTasks);
            io.to(playerA.id).emit('pokedexChanged', { reason: 'pvp_seen' });
            io.to(playerB.id).emit('pokedexChanged', { reason: 'pvp_seen' });
        }
    } catch (error) {
        console.error('Erreur Pokédex combat PVP:', error.message);
    }

    const battleState = createBattleState({ mapName: playerA.currentmap, opponentMap: playerB.currentmap ?? null });
    require('../abilities/abilityForms').attachTeam(teamA);
    require('../abilities/abilityForms').attachTeam(teamB);
    const sideA = battleState.sides.player;
    const sideB = battleState.sides.enemy;

    const firstAliveA = getFirstAliveIndex(teamA);
    const firstAliveB = getFirstAliveIndex(teamB);

    if (firstAliveA >= 0) {
        swapToIndex(teamA, firstAliveA);
    }

    if (firstAliveB >= 0) {
        swapToIndex(teamB, firstAliveB);
    }

    if (!hasAlivePokemon(teamA) && !hasAlivePokemon(teamB)) {
        await narrateToBoth(io, playerA, playerB, 'Aucun Pokemon en etat de combattre.');
        emitBattleEnd(io, playerA, playerB, null, 'no_pokemon');
        await persistTeams(playerA, playerB);
        return {
            winnerId: null,
            reason: 'no_pokemon'
        };
    }

    if (!hasAlivePokemon(teamA)) {
        await narrateToBoth(io, playerA, playerB, `${getTrainerName(playerA)} ne peut pas combattre.`);
        emitBattleEnd(io, playerA, playerB, playerB.id, 'opponent_no_pokemon');
        await persistTeams(playerA, playerB);
        return {
            winnerId: playerB.id,
            reason: 'opponent_no_pokemon'
        };
    }

    if (!hasAlivePokemon(teamB)) {
        await narrateToBoth(io, playerA, playerB, `${getTrainerName(playerB)} ne peut pas combattre.`);
        emitBattleEnd(io, playerA, playerB, playerA.id, 'opponent_no_pokemon');
        await persistTeams(playerA, playerB);
        return {
            winnerId: playerA.id,
            reason: 'opponent_no_pokemon'
        };
    }

    emitBattleStateForBoth(io, playerA, playerB, battleState);
    emitFieldState(io, [playerA.id, playerB.id], battleState);
    await narrateToBoth(io, playerA, playerB, `${getTrainerName(playerA)} defie ${getTrainerName(playerB)} !`, 900);
    await applySwitchInNarration(io, playerA, playerB, teamA[0], sideA, sideB, battleState);
    await applySwitchInNarration(io, playerB, playerA, teamB[0], sideB, sideA, battleState);

    while (hasAlivePokemon(teamA) && hasAlivePokemon(teamB)) {
        const socketA = getPlayerSocket(io, playerA);
        const socketB = getPlayerSocket(io, playerB);

        if (!socketA && !socketB) {
            emitBattleEnd(io, playerA, playerB, null, 'both_disconnected');
            await persistTeams(playerA, playerB);
            return { winnerId: null, reason: 'both_disconnected' };
        }

        if (!socketA) {
            await narrateToPlayer(io, playerB, `${getTrainerName(playerA)} s'est deconnecte.`);
            emitBattleEnd(io, playerA, playerB, playerB.id, 'opponent_disconnected');
            await persistTeams(playerA, playerB);
            return { winnerId: playerB.id, reason: 'opponent_disconnected' };
        }

        if (!socketB) {
            await narrateToPlayer(io, playerA, `${getTrainerName(playerB)} s'est deconnecte.`);
            emitBattleEnd(io, playerA, playerB, playerA.id, 'opponent_disconnected');
            await persistTeams(playerA, playerB);
            return { winnerId: playerA.id, reason: 'opponent_disconnected' };
        }

        const canContinueA = await ensureActivePokemonAlive(io, playerA, playerB, sideA, sideB, battleState);
        if (!canContinueA) {
            await narrateToBoth(io, playerA, playerB, `${getTrainerName(playerA)} n'a plus de Pokemon en etat de combattre.`);
            emitBattleEnd(io, playerA, playerB, playerB.id, 'no_pokemon');
            await persistTeams(playerA, playerB);
            return { winnerId: playerB.id, reason: 'no_pokemon' };
        }

        const canContinueB = await ensureActivePokemonAlive(io, playerB, playerA, sideB, sideA, battleState);
        if (!canContinueB) {
            await narrateToBoth(io, playerA, playerB, `${getTrainerName(playerB)} n'a plus de Pokemon en etat de combattre.`);
            emitBattleEnd(io, playerA, playerB, playerA.id, 'no_pokemon');
            await persistTeams(playerA, playerB);
            return { winnerId: playerA.id, reason: 'no_pokemon' };
        }

        const [rawActionA, rawActionB] = await Promise.all([
            requestPlayerAction(io, playerA),
            requestPlayerAction(io, playerB)
        ]);

        let actionA = normalizeAction(rawActionA, playerA);
        let actionB = normalizeAction(rawActionB, playerB);

        if (actionA.action === 'invalid_bag') {
            await narrateToPlayer(io, playerA, 'Les objets ne sont pas utilisables en combat PVP.', 900);
            actionA = {
                action: 'attack',
                moveIndex: actionA.moveIndex
            };
        }

        if (actionB.action === 'invalid_bag') {
            await narrateToPlayer(io, playerB, 'Les objets ne sont pas utilisables en combat PVP.', 900);
            actionB = {
                action: 'attack',
                moveIndex: actionB.moveIndex
            };
        }

        if (actionA.action === 'flee' && actionB.action === 'flee') {
            await narrateToBoth(io, playerA, playerB, 'Les deux dresseurs abandonnent le combat.');
            emitBattleEnd(io, playerA, playerB, null, 'both_fled');
            await persistTeams(playerA, playerB);
            return { winnerId: null, reason: 'both_fled' };
        }

        if (actionA.action === 'flee') {
            await narrateToBoth(io, playerA, playerB, `${getTrainerName(playerA)} abandonne le combat !`);
            emitBattleEnd(io, playerA, playerB, playerB.id, 'fled');
            await persistTeams(playerA, playerB);
            return { winnerId: playerB.id, reason: 'fled' };
        }

        if (actionB.action === 'flee') {
            await narrateToBoth(io, playerA, playerB, `${getTrainerName(playerB)} abandonne le combat !`);
            emitBattleEnd(io, playerA, playerB, playerA.id, 'fled');
            await persistTeams(playerA, playerB);
            return { winnerId: playerA.id, reason: 'fled' };
        }

        const activeA = teamA[0];
        const activeB = teamB[0];

        let canSwitchA = false;
        if (actionA.action === 'change') {
            if (!canSwitchOut(activeA, activeB, battleState)) {
                await narrateToPlayer(io, playerA, `${getPokemonDisplayName(activeA)} est piege et ne peut pas changer.`);
                actionA = { action: 'attack', moveIndex: getRandomMoveIndex(activeA) };
            } else if (!Number.isInteger(actionA.index) || actionA.index <= 0 || actionA.index >= teamA.length) {
                await narrateToPlayer(io, playerA, 'Changement impossible.');
                actionA = { action: 'attack', moveIndex: getRandomMoveIndex(activeA) };
            } else if (Number(teamA[actionA.index]?.currentHp || 0) <= 0) {
                await narrateToPlayer(io, playerA, 'Ce Pokemon ne peut pas combattre.');
                actionA = { action: 'attack', moveIndex: getRandomMoveIndex(activeA) };
            } else {
                canSwitchA = true;
            }
        }

        let canSwitchB = false;
        if (actionB.action === 'change') {
            if (!canSwitchOut(activeB, activeA, battleState)) {
                await narrateToPlayer(io, playerB, `${getPokemonDisplayName(activeB)} est piege et ne peut pas changer.`);
                actionB = { action: 'attack', moveIndex: getRandomMoveIndex(activeB) };
            } else if (!Number.isInteger(actionB.index) || actionB.index <= 0 || actionB.index >= teamB.length) {
                await narrateToPlayer(io, playerB, 'Changement impossible.');
                actionB = { action: 'attack', moveIndex: getRandomMoveIndex(activeB) };
            } else if (Number(teamB[actionB.index]?.currentHp || 0) <= 0) {
                await narrateToPlayer(io, playerB, 'Ce Pokemon ne peut pas combattre.');
                actionB = { action: 'attack', moveIndex: getRandomMoveIndex(activeB) };
            } else {
                canSwitchB = true;
            }
        }

        if (canSwitchA) {
            const previousName = getPokemonDisplayName(teamA[0]);
            swapToIndex(teamA, actionA.index);
            await narrateToBoth(
                io,
                playerA,
                playerB,
                `${getTrainerName(playerA)} rappelle ${previousName} et envoie ${getPokemonDisplayName(teamA[0])} !`,
                900
            );
            emitBattleStateForBoth(io, playerA, playerB, battleState);
            await applySwitchInNarration(io, playerA, playerB, teamA[0], sideA, sideB, battleState);
        }

        if (canSwitchB) {
            const previousName = getPokemonDisplayName(teamB[0]);
            swapToIndex(teamB, actionB.index);
            await narrateToBoth(
                io,
                playerA,
                playerB,
                `${getTrainerName(playerB)} rappelle ${previousName} et envoie ${getPokemonDisplayName(teamB[0])} !`,
                900
            );
            emitBattleStateForBoth(io, playerA, playerB, battleState);
            await applySwitchInNarration(io, playerB, playerA, teamB[0], sideB, sideA, battleState);
        }

        if (!canSwitchA && !canSwitchB) {
            const moveNameA = teamA[0]?.getAtkName?.(actionA.moveIndex);
            const moveNameB = teamB[0]?.getAtkName?.(actionB.moveIndex);
            const firstActor = decideMoveOrder(teamA[0], moveNameA, teamB[0], moveNameB, battleState);

            if (firstActor === 'A') {
                const resultA = await performAttack(io, playerA, playerB, actionA.moveIndex, sideA, sideB, battleState);
                if (!resultA?.switches?.defender && Number(teamB[0]?.currentHp || 0) > 0) {
                    await performAttack(io, playerB, playerA, actionB.moveIndex, sideB, sideA, battleState);
                }
            } else {
                const resultB = await performAttack(io, playerB, playerA, actionB.moveIndex, sideB, sideA, battleState);
                if (!resultB?.switches?.defender && Number(teamA[0]?.currentHp || 0) > 0) {
                    await performAttack(io, playerA, playerB, actionA.moveIndex, sideA, sideB, battleState);
                }
            }
        } else if (canSwitchA && actionB.action === 'attack') {
            if (Number(teamA[0]?.currentHp || 0) > 0 && Number(teamB[0]?.currentHp || 0) > 0) {
                await performAttack(io, playerB, playerA, actionB.moveIndex, sideB, sideA, battleState);
            }
        } else if (canSwitchB && actionA.action === 'attack') {
            if (Number(teamA[0]?.currentHp || 0) > 0 && Number(teamB[0]?.currentHp || 0) > 0) {
                await performAttack(io, playerA, playerB, actionA.moveIndex, sideA, sideB, battleState);
            }
        }

        if (hasAlivePokemon(teamA) && hasAlivePokemon(teamB)) {
            const activeAfterTurnA = teamA[0];
            const activeAfterTurnB = teamB[0];

            if (Number(activeAfterTurnA?.currentHp || 0) > 0 && Number(activeAfterTurnB?.currentHp || 0) > 0) {
                const endTurnMessages = processEndOfRound(activeAfterTurnA, activeAfterTurnB, sideA, sideB, battleState);
                emitFieldState(io, [playerA?.id, playerB?.id], battleState);
                if (Array.isArray(endTurnMessages) && endTurnMessages.length > 0) {
                    emitBattleStateForBoth(io, playerA, playerB, battleState);
                    await sleep(SHORT_DELAY_MS);
                    for (const message of endTurnMessages) {
                        if (!message) continue;
                        await narrateToBoth(io, playerA, playerB, message, 900);
                    }
                }
            }
        }
    }

    const aliveA = hasAlivePokemon(teamA);
    const aliveB = hasAlivePokemon(teamB);

    if (aliveA && !aliveB) {
        await narrateToBoth(io, playerA, playerB, `${getTrainerName(playerA)} remporte le combat !`);
        emitBattleEnd(io, playerA, playerB, playerA.id, 'finished');
        await persistTeams(playerA, playerB);
        return { winnerId: playerA.id, reason: 'finished' };
    }

    if (!aliveA && aliveB) {
        await narrateToBoth(io, playerA, playerB, `${getTrainerName(playerB)} remporte le combat !`);
        emitBattleEnd(io, playerA, playerB, playerB.id, 'finished');
        await persistTeams(playerA, playerB);
        return { winnerId: playerB.id, reason: 'finished' };
    }

    await narrateToBoth(io, playerA, playerB, 'Combat termine sans vainqueur.');
    emitBattleEnd(io, playerA, playerB, null, 'draw');
    await persistTeams(playerA, playerB);
    return { winnerId: null, reason: 'draw' };
}

module.exports = {
    startPvpBattle,
    hasAlivePokemon
};
