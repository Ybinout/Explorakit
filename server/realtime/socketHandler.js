const { getMapWeather, battleWeatherForMap } = require('../game/world/mapWeather');
const { getPokemonCenterEntryReturn, getPokemonCenterExit } = require('../game/world/pokemonCenterTravel');
const { startPnjMovement } = require('../game/world/pnjMovement');
const { loadCollisionData, changeMapData, getNextMap, battleMapData, InteractMapData } = require('../game/world/mapRepository');
const { loadEquipe, editEquipe } = require('../persistence/teamRepository');
const CreatePokemon = require('../game/world/wildPokemonFactory');
const startBattle = require('../game/battle/wildBattle');
const startTeamBattle = require('../game/battle/trainerBattle');
const { getSentenceForMapAndPosition, getSentenceForName, getEndSentenceInformation, getTeamInformation } = require('../game/world/interactionRepository');
const { getPnjTeam } = require('../game/world/pnjTeamFactory');
const {
    loadUserPosition,
    saveUserPosition,
    saveUserRespawnPoint,
    sanitizeSpriteName
} = require('../persistence/playerRepository');
const { getPnjsForMap, getPnjAtTile, isPnjBlockingTile } = require('../game/world/pnjStore');
const { startPvpBattle, hasAlivePokemon } = require('../game/battle/pvpBattle');
const { emitPvpBattleEnd } = require('../game/battle/battleOutcome');
const {
    createDialogueAuthorization,
    isDialogueCompletionAllowed
} = require('../game/world/interactionAuthorization');
const {
    getPokemonCenterRespawnPoint,
    hasConsciousPokemon,
    healTeam,
    resolveRespawnPoint
} = require('../game/world/playerRecovery');
const {
    DEFAULT_MAP,
    DEFAULT_POSITION,
    TILE_SIZE,
    arePlayersCloseEnough,
    buildPositionSnapshot,
    getDirectionFromAction,
    getPlayerDisplayName,
    getPlayerTilePosition,
    getPlayersInMap,
    getTileDistance,
    positionsAreEqual,
    resolveMapName,
    sanitizeSpawnPosition,
    toPublicPlayer
} = require('./playerState');
const { DEFAULT_SPRITE, registerPlayerProfileHandlers } = require('./handlers/playerProfileHandlers');
const { registerChatHandlers } = require('./handlers/chatHandlers');
const {registerMedicineHandlers}=require('./handlers/medicineHandlers');
const { registerEvolutionHandlers } = require('./handlers/evolutionHandlers');
const { registerMoveLearningHandlers } = require('./handlers/moveLearningHandlers');
const { registerTeamOrderHandlers } = require('./handlers/teamOrderHandlers');
const { registerShopHandlers } = require('./handlers/shopHandlers');
const {
    completeNpcBattle,
    completeStoryEvent,
    getNpcBattleDefinition,
    isNpcBattleCompleted,
    loadPokedex,
    loadProgressState,
    synchronizeCaughtPokemon
} = require('../persistence/progressionRepository');

const { meetsRequirements } = require('../game/world/storyProgression');

const MOVE_DELAY = 130;
const POSITION_SAVE_DELAY_MS = 4000;
const INTERACTION_REQUEST_TIMEOUT_MS = 25000;

let players = {};
const pendingInteractionRequests = new Map();
const activeChatSessions = new Map();
const socketToChatSession = new Map();
const blackoutHandlers = new Map();

function buildId(prefix = 'id') {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function canPlayerEnterPvp(player) {
    return hasAlivePokemon(player?.equipe?.pokemons);
}

function hasPendingRequestForSocket(socketId) {
    for (const request of pendingInteractionRequests.values()) {
        if (request.fromId === socketId || request.toId === socketId) {
            return true;
        }
    }
    return false;
}

function findNearbyInteractablePlayer(sourceSocketId) {
    const sourcePlayer = players[sourceSocketId];
    if (!sourcePlayer) return null;

    const candidates = [];
    for (const id in players) {
        if (id === sourceSocketId) continue;
        const targetPlayer = players[id];
        if (!targetPlayer) continue;
        if (targetPlayer.currentmap !== sourcePlayer.currentmap) continue;

        const distance = getTileDistance(sourcePlayer, targetPlayer);
        if (distance <= 1) {
            candidates.push({ id, player: targetPlayer, distance });
        }
    }

    if (candidates.length === 0) return null;

    candidates.sort((left, right) => {
        if (left.distance !== right.distance) return left.distance - right.distance;
        return left.id.localeCompare(right.id);
    });

    return candidates[0];
}

const socketHandler = (io) => {
    startPnjMovement(io, () => players);
    const clearPendingRequest = (requestId, reason = 'cancelled', { notify = false } = {}) => {
        const request = pendingInteractionRequests.get(requestId);
        if (!request) return null;

        pendingInteractionRequests.delete(requestId);
        if (request.timeoutId) {
            clearTimeout(request.timeoutId);
        }

        if (notify) {
            if (request.fromId && players[request.fromId]) {
                io.to(request.fromId).emit('interactionRequestCancelled', {
                    requestId,
                    type: request.type,
                    reason
                });
            }

            if (request.toId && players[request.toId]) {
                io.to(request.toId).emit('interactionRequestCancelled', {
                    requestId,
                    type: request.type,
                    reason
                });
            }
        }

        return request;
    };

    const cancelPendingRequestsForSocket = (socketId, reason = 'player_unavailable') => {
        const idsToClear = [];
        for (const [requestId, request] of pendingInteractionRequests.entries()) {
            if (request.fromId === socketId || request.toId === socketId) {
                idsToClear.push(requestId);
            }
        }

        idsToClear.forEach((requestId) => {
            clearPendingRequest(requestId, reason, { notify: true });
        });
    };

    const closeChatSession = (chatId, reason = 'closed', actorId = null) => {
        const session = activeChatSessions.get(chatId);
        if (!session) return;

        activeChatSessions.delete(chatId);

        session.participants.forEach((participantId) => {
            socketToChatSession.delete(participantId);
            if (!players[participantId]) return;
            io.to(participantId).emit('chatSessionEnded', {
                chatId,
                reason,
                actorId
            });
        });
    };

    const closeChatSessionForSocket = (socketId, reason = 'left_chat') => {
        const chatId = socketToChatSession.get(socketId);
        if (!chatId) return;
        closeChatSession(chatId, reason, socketId);
    };

    const launchPvpBattle = (socketIdA, socketIdB) => {
        const playerA = players[socketIdA];
        const playerB = players[socketIdB];
        if (!playerA || !playerB) return;

        playerA.inbattle = true;
        playerB.inbattle = true;
        closeChatSessionForSocket(socketIdA, 'battle_started');
        closeChatSessionForSocket(socketIdB, 'battle_started');

        const field = { weather: battleWeatherForMap(playerA.currentmap, playerB.currentmap ?? null) };
        io.to(socketIdA).emit('battletrigger', { message: 'Combat PVP lance !', battleType: 'pvp', field });
        io.to(socketIdB).emit('battletrigger', { message: 'Combat PVP lance !', battleType: 'pvp', field });

        (async () => {
            try {
                await startPvpBattle(playerA, playerB, io);
            } catch (error) {
                console.error('Erreur pendant le combat PVP:', error?.message || error);
                emitPvpBattleEnd(io, playerA, playerB, null, 'error');
            } finally {
                const recoveryTasks = [];
                if (players[socketIdA] && !hasConsciousPokemon(players[socketIdA].equipe)) {
                    const recoverPlayerA = blackoutHandlers.get(socketIdA);
                    if (recoverPlayerA) recoveryTasks.push(recoverPlayerA());
                }
                if (players[socketIdB] && !hasConsciousPokemon(players[socketIdB].equipe)) {
                    const recoverPlayerB = blackoutHandlers.get(socketIdB);
                    if (recoverPlayerB) recoveryTasks.push(recoverPlayerB());
                }
                if (recoveryTasks.length > 0) {
                    await Promise.allSettled(recoveryTasks);
                }

                if (players[socketIdA]) {
                    players[socketIdA].inbattle = false;
                    io.to(socketIdA).emit('teamStateChanged', {
                        reason: 'pvp_battle_end',
                        equipe: players[socketIdA].equipe
                    });
                }
                if (players[socketIdB]) {
                    players[socketIdB].inbattle = false;
                    io.to(socketIdB).emit('teamStateChanged', {
                        reason: 'pvp_battle_end',
                        equipe: players[socketIdB].equipe
                    });
                }
            }
        })();
    };

    io.on('connection', async (socket) => {
        const userId = Number.parseInt(socket.data.user?.id, 10);
        if (!Number.isInteger(userId) || userId <= 0) {
            socket.disconnect(true);
            return;
        }
        const requestedUsername = typeof socket.data.user?.username === 'string'
            ? socket.data.user.username.trim()
            : '';

        const [equipe, loadedSavedPosition] = await Promise.all([
            loadEquipe(userId),
            loadUserPosition(userId)
        ]);
        await synchronizeCaughtPokemon(userId, equipe?.pokemons).catch((error) => {
            console.error(`Erreur réconciliation Pokédex user ${userId}:`, error.message);
        });

        let savedPosition = loadedSavedPosition;
        const hasLegacyZeroPosition =
            savedPosition &&
            Number(savedPosition.x) === 0 &&
            Number(savedPosition.y) === 0;
        const hasLegacyMap =
            savedPosition &&
            (savedPosition.map === 'default_map' || !savedPosition.map);

        if (hasLegacyZeroPosition || hasLegacyMap) {
            savedPosition = {
                sprite: savedPosition?.sprite
            };
        }

        let currentmap = resolveMapName(savedPosition?.map || DEFAULT_MAP);
        let collisionData2D = loadCollisionData(currentmap);
        let changemap2D = changeMapData(currentmap);
        let battlemap2D = battleMapData(currentmap);
        let interactmap = InteractMapData(currentmap);
        let currentPnjs = getPnjsForMap(currentmap);

        const spawnPosition = sanitizeSpawnPosition(savedPosition?.x, savedPosition?.y, collisionData2D, currentmap);

        players[socket.id] = {
            id: socket.id,
            userId,
            username: requestedUsername || null,
            x: spawnPosition.x,
            y: spawnPosition.y,
            sprite: sanitizeSpriteName(savedPosition?.sprite || DEFAULT_SPRITE),
            direction: 'down',
            isMoving: false,
            animationFrame: 0,
            isInteracting: false,
            interactionAsset: null,
            currentmap,
            equipe,
            respawnPoint: savedPosition?.respawnPoint || null,
            centerReturnPoint: savedPosition?.centerReturnPoint || null,
            inbattle: false
        };

        let canMove = true;
        let transitionBusy = false;
        let saveTimer = null;
        let activePositionSave = null;
        let savePending = false;
        let pendingDialogue = null;
        let interactionBusy = false;
        const guardInteraction = (handler) => async (data) => {
            if (interactionBusy) return;
            interactionBusy = true;
            try {
                await handler(data);
            } catch (error) {
                console.error('Erreur interaction:', error?.message || error);
                socket.emit('interactionRejected', { reason: 'interaction_unavailable' });
            } finally {
                interactionBusy = false;
            }
        };
        let lastSavedPosition = savedPosition
            ? {
                x: Number(savedPosition.x),
                y: Number(savedPosition.y),
                map: savedPosition.map,
                centerReturnPoint: savedPosition.centerReturnPoint || null
            }
            : null;

        if (
            lastSavedPosition &&
            (!Number.isFinite(lastSavedPosition.x) ||
                !Number.isFinite(lastSavedPosition.y) ||
                typeof lastSavedPosition.map !== 'string')
        ) {
            lastSavedPosition = null;
        }

        const flushPositionSave = async () => {
            if (activePositionSave) return activePositionSave;
            if (!savePending) return true;

            activePositionSave = (async () => {
                try {
                    // Drain newer snapshots queued while MySQL is writing the previous one.
                    while (savePending) {
                        const player = players[socket.id];
                        if (!player) return false;
                        const positionToSave = buildPositionSnapshot(player);
                        if (!positionsAreEqual(positionToSave, lastSavedPosition)) {
                            await saveUserPosition(userId, positionToSave);
                            lastSavedPosition = positionToSave;
                        }
                        savePending = !positionsAreEqual(buildPositionSnapshot(player), lastSavedPosition);
                    }
                    return true;
                } catch (error) {
                    console.error(`Erreur de sauvegarde position user ${userId}:`, error.message);
                    return false;
                }
            })().finally(() => { activePositionSave = null; });
            return activePositionSave;
        };

        const schedulePositionSave = ({ immediate = false } = {}) => {
            savePending = true;

            if (immediate) {
                if (saveTimer) {
                    clearTimeout(saveTimer);
                    saveTimer = null;
                }

                flushPositionSave().then(() => {
                    if (savePending && !saveTimer) {
                        schedulePositionSave();
                    }
                });
                return;
            }

            if (saveTimer) return;

            saveTimer = setTimeout(async () => {
                saveTimer = null;
                await flushPositionSave();

                if (savePending) {
                    schedulePositionSave();
                }
            }, POSITION_SAVE_DELAY_MS);
        };

        const emitProgressionSnapshot = async () => {
            const [progression, pokedex] = await Promise.all([
                loadProgressState(userId),
                loadPokedex(userId)
            ]);
            socket.emit('progressionState', progression);
            socket.emit('pokedexState', pokedex);
            return { progression, pokedex };
        };

        const savePokemonCenterCheckpoint = async () => {
            const player = players[socket.id];
            if (!player || player.currentmap !== 'centre') return;

            const checkpoint = getPokemonCenterRespawnPoint();
            player.respawnPoint = checkpoint;
            try {
                await saveUserRespawnPoint(userId, checkpoint);
            } catch (error) {
                console.error(`Erreur sauvegarde point de soin user ${userId}:`, error.message);
            }
        };

        const relocatePlayer = async (destination, { reason = 'relocation', saveCheckpoint = false } = {}) => {
            const player = players[socket.id];
            if (!player) return false;

            const oldMap = currentmap;
            currentmap = resolveMapName(destination?.map);
            collisionData2D = loadCollisionData(currentmap);
            changemap2D = changeMapData(currentmap);
            battlemap2D = battleMapData(currentmap);
            interactmap = InteractMapData(currentmap);
            currentPnjs = getPnjsForMap(currentmap);

            const safeDestination = sanitizeSpawnPosition(
                destination?.x,
                destination?.y,
                collisionData2D,
                currentmap
            );

            player.x = safeDestination.x;
            player.y = safeDestination.y;
            player.currentmap = currentmap;
            player.isMoving = false;

            for (const id in players) {
                if (id === socket.id) continue;
                if (players[id].currentmap === oldMap) {
                    io.to(id).emit('playerLeft', { id: socket.id });
                }
                if (players[id].currentmap === currentmap) {
                    io.to(id).emit('playerJoined', { id: socket.id, player: toPublicPlayer(player) });
                }
            }

            const sameMapPlayers = getPlayersInMap(players, currentmap);
            socket.emit('newmap', { mapname: currentmap, playersList: sameMapPlayers, reason });
            socket.emit('mapWeatherState', getMapWeather(currentmap));
            socket.emit('pnjsList', { mapname: currentmap, pnjs: currentPnjs });
            schedulePositionSave({ immediate: true });

            if (saveCheckpoint && currentmap === 'centre') {
                await savePokemonCenterCheckpoint();
            }

            return true;
        };

        const handleBlackout = async () => {
            const player = players[socket.id];
            if (!player || !Array.isArray(player.equipe?.pokemons) || player.equipe.pokemons.length === 0) {
                return false;
            }
            if (hasConsciousPokemon(player.equipe)) return false;

            healTeam(player.equipe);
            await editEquipe(userId, player.equipe);

            const destination = resolveRespawnPoint(player.respawnPoint);
            await relocatePlayer(destination, { reason: 'blackout' });
            socket.emit('blackout', {
                message: player.respawnPoint
                    ? 'Ton equipe a ete soignee. Tu reprends conscience au dernier Centre Pokemon visite.'
                    : 'Ton equipe a ete soignee. Tu reprends conscience chez toi.',
                mapname: player.currentmap,
                equipe: player.equipe
            });
            return true;
        };

        blackoutHandlers.set(socket.id, handleBlackout);

        if (currentmap === 'centre') {
            await savePokemonCenterCheckpoint();
        }
        if (Array.isArray(equipe?.pokemons) && equipe.pokemons.length > 0 && !hasConsciousPokemon(equipe)) {
            await handleBlackout().catch((error) => {
                console.error(`Erreur recuperation a la connexion user ${userId}:`, error.message);
            });
        }

        if (!positionsAreEqual(buildPositionSnapshot(players[socket.id]), lastSavedPosition)) {
            schedulePositionSave({ immediate: true });
        }

        const sameMapPlayers = getPlayersInMap(players, currentmap);
        socket.emit('playersList', sameMapPlayers);
        socket.emit('mapWeatherState', getMapWeather(currentmap));
        socket.emit('pnjsList', { mapname: currentmap, pnjs: currentPnjs });
        emitProgressionSnapshot().catch((error) => {
            console.error(`Erreur chargement progression user ${userId}:`, error.message);
        });

        for (const id in players) {
            if (players[id].currentmap === currentmap) {
                io.to(id).emit('newPlayer', { id: socket.id, player: toPublicPlayer(players[socket.id]) });
            }
        }

        registerPlayerProfileHandlers({ socket, io, players, userId });
        registerTeamOrderHandlers({socket,userId,getPlayer:()=>players[socket.id],canUse:()=>!interactionBusy&&!transitionBusy});
        registerMedicineHandlers({socket,userId,getPlayer:()=>players[socket.id],canUse:()=>!interactionBusy&&!transitionBusy});
        registerMoveLearningHandlers({socket,userId,getPlayer:()=>players[socket.id],canUse:()=>!interactionBusy&&!transitionBusy});
        registerEvolutionHandlers({socket,userId,getPlayer:()=>players[socket.id],canUse:()=>!interactionBusy&&!transitionBusy});
        const shopHandlers = registerShopHandlers({
            socket,
            userId,
            getPlayer: () => players[socket.id] || null
        });

        socket.on('requestGameSave', async (acknowledge) => {
            const reply = typeof acknowledge === 'function' ? acknowledge : () => {};
            const player = players[socket.id];
            if (!player) {
                reply({ success: false, message: 'Joueur introuvable.' });
                return;
            }
            if (player.inbattle || player.inventoryBusy) {
                reply({ success: false, message: 'La sauvegarde manuelle est indisponible pendant un combat.' });
                return;
            }

            player.inventoryBusy = true;
            try {
                if (saveTimer) {
                    clearTimeout(saveTimer);
                    saveTimer = null;
                }
                savePending = true;
                const positionSaved = await flushPositionSave();
                if (!positionSaved) throw new Error('La position ne peut pas être sauvegardée.');
                await editEquipe(userId, player.equipe);
                const snapshot = await emitProgressionSnapshot();
                const syncedAt = new Date().toISOString();
                socket.emit('saveSyncState', { status: 'synced', syncedAt });
                reply({ success: true, syncedAt, ...snapshot });
            } catch (error) {
                console.error(`Erreur sauvegarde manuelle user ${userId}:`, error.message);
                socket.emit('saveSyncState', { status: 'error', message: 'Échec de la synchronisation.' });
                reply({ success: false, message: 'Échec de la synchronisation.' });
            } finally {
                player.inventoryBusy = false;
            }
        });

        socket.on('playerInteractionChoice', (payload = {}) => {
            const player = players[socket.id];
            if (!player) return;
            if (player.inbattle || player.inventoryBusy) {
                socket.emit('interactionRequestFailed', { reason: 'already_in_battle' });
                return;
            }
            if (socketToChatSession.has(socket.id)) {
                socket.emit('interactionRequestFailed', { reason: 'chat_active' });
                return;
            }
            if (hasPendingRequestForSocket(socket.id)) {
                socket.emit('interactionRequestFailed', { reason: 'pending_request' });
                return;
            }

            const targetId = typeof payload.targetId === 'string' ? payload.targetId : '';
            if (!targetId || targetId === socket.id) {
                socket.emit('interactionRequestFailed', { reason: 'invalid_target' });
                return;
            }

            const targetPlayer = players[targetId];
            if (!targetPlayer) {
                socket.emit('interactionRequestFailed', { reason: 'target_not_found' });
                return;
            }

            if (targetPlayer.inbattle) {
                socket.emit('interactionRequestFailed', { reason: 'target_in_battle' });
                return;
            }

            if (socketToChatSession.has(targetId)) {
                socket.emit('interactionRequestFailed', { reason: 'target_chat_active' });
                return;
            }

            if (hasPendingRequestForSocket(targetId)) {
                socket.emit('interactionRequestFailed', { reason: 'target_pending_request' });
                return;
            }

            if (!arePlayersCloseEnough(player, targetPlayer)) {
                socket.emit('interactionRequestFailed', { reason: 'target_too_far' });
                return;
            }

            const requestedType = typeof payload.type === 'string' ? payload.type.toLowerCase() : '';
            const interactionType = requestedType === 'combat' ? 'battle' : requestedType;
            if (!['chat', 'battle'].includes(interactionType)) {
                socket.emit('interactionRequestFailed', { reason: 'invalid_type' });
                return;
            }

            if (interactionType === 'battle') {
                if (!canPlayerEnterPvp(player)) {
                    socket.emit('interactionRequestFailed', { reason: 'requester_no_pokemon' });
                    return;
                }
                if (!canPlayerEnterPvp(targetPlayer)) {
                    socket.emit('interactionRequestFailed', { reason: 'target_no_pokemon' });
                    return;
                }
            }

            const requestId = buildId('ireq');
            const requestTimeout = setTimeout(() => {
                const request = pendingInteractionRequests.get(requestId);
                if (!request) return;

                pendingInteractionRequests.delete(requestId);
                if (players[request.fromId]) {
                    io.to(request.fromId).emit('interactionRequestExpired', {
                        requestId,
                        type: request.type
                    });
                }
                if (players[request.toId]) {
                    io.to(request.toId).emit('interactionRequestExpired', {
                        requestId,
                        type: request.type
                    });
                }
            }, INTERACTION_REQUEST_TIMEOUT_MS);

            pendingInteractionRequests.set(requestId, {
                id: requestId,
                type: interactionType,
                fromId: socket.id,
                toId: targetId,
                timeoutId: requestTimeout,
                createdAt: Date.now()
            });

            socket.emit('interactionRequestSent', {
                requestId,
                type: interactionType,
                targetId,
                targetName: getPlayerDisplayName(targetPlayer)
            });

            io.to(targetId).emit('incomingInteractionRequest', {
                requestId,
                type: interactionType,
                fromId: socket.id,
                fromName: getPlayerDisplayName(player),
                expiresInMs: INTERACTION_REQUEST_TIMEOUT_MS
            });
        });

        socket.on('interactionRequestDecision', (payload = {}) => {
            const requestId = typeof payload.requestId === 'string' ? payload.requestId : '';
            if (!requestId) return;

            const request = pendingInteractionRequests.get(requestId);
            if (!request) return;
            if (request.toId !== socket.id) return;

            clearPendingRequest(requestId);

            const sourcePlayer = players[request.fromId];
            const targetPlayer = players[request.toId];
            if (!sourcePlayer || !targetPlayer) {
                if (sourcePlayer) {
                    io.to(sourcePlayer.id).emit('interactionRequestFailed', { reason: 'target_not_available' });
                }
                return;
            }

            const accepted = payload.accept === true;
            if (!accepted) {
                io.to(request.fromId).emit('interactionRequestDeclined', {
                    requestId,
                    type: request.type,
                    targetId: request.toId,
                    targetName: getPlayerDisplayName(targetPlayer)
                });
                io.to(request.toId).emit('interactionRequestResolved', {
                    requestId,
                    type: request.type,
                    accepted: false
                });
                return;
            }

            if (!arePlayersCloseEnough(sourcePlayer, targetPlayer)) {
                io.to(request.fromId).emit('interactionRequestFailed', { reason: 'target_too_far' });
                io.to(request.toId).emit('interactionRequestFailed', { reason: 'target_too_far' });
                return;
            }

            if (sourcePlayer.inbattle || targetPlayer.inbattle || sourcePlayer.inventoryBusy || targetPlayer.inventoryBusy) {
                io.to(request.fromId).emit('interactionRequestFailed', { reason: 'already_in_battle' });
                io.to(request.toId).emit('interactionRequestFailed', { reason: 'already_in_battle' });
                return;
            }

            if (request.type === 'chat') {
                if (socketToChatSession.has(sourcePlayer.id) || socketToChatSession.has(targetPlayer.id)) {
                    io.to(request.fromId).emit('interactionRequestFailed', { reason: 'chat_active' });
                    io.to(request.toId).emit('interactionRequestFailed', { reason: 'chat_active' });
                    return;
                }

                const chatId = buildId('chat');
                const participants = [sourcePlayer.id, targetPlayer.id];
                activeChatSessions.set(chatId, {
                    id: chatId,
                    participants,
                    createdAt: Date.now()
                });
                socketToChatSession.set(sourcePlayer.id, chatId);
                socketToChatSession.set(targetPlayer.id, chatId);

                io.to(sourcePlayer.id).emit('chatSessionStarted', {
                    chatId,
                    peerId: targetPlayer.id,
                    peerName: getPlayerDisplayName(targetPlayer)
                });
                io.to(targetPlayer.id).emit('chatSessionStarted', {
                    chatId,
                    peerId: sourcePlayer.id,
                    peerName: getPlayerDisplayName(sourcePlayer)
                });
                return;
            }

            if (!canPlayerEnterPvp(sourcePlayer)) {
                io.to(sourcePlayer.id).emit('interactionRequestFailed', { reason: 'requester_no_pokemon' });
                io.to(targetPlayer.id).emit('interactionRequestFailed', { reason: 'requester_no_pokemon' });
                return;
            }

            if (!canPlayerEnterPvp(targetPlayer)) {
                io.to(sourcePlayer.id).emit('interactionRequestFailed', { reason: 'target_no_pokemon' });
                io.to(targetPlayer.id).emit('interactionRequestFailed', { reason: 'target_no_pokemon' });
                return;
            }

            io.to(sourcePlayer.id).emit('interactionRequestAccepted', {
                requestId,
                type: 'battle',
                targetId: targetPlayer.id,
                targetName: getPlayerDisplayName(targetPlayer)
            });
            io.to(targetPlayer.id).emit('interactionRequestAccepted', {
                requestId,
                type: 'battle',
                targetId: sourcePlayer.id,
                targetName: getPlayerDisplayName(sourcePlayer)
            });

            launchPvpBattle(sourcePlayer.id, targetPlayer.id);
        });

        registerChatHandlers({
            socket,
            io,
            players,
            activeChatSessions,
            socketToChatSession,
            closeChatSession,
            closeChatSessionForSocket
        });

        socket.on('onEndDialogue', guardInteraction(async (data) => {
            const player = players[socket.id];
            if (!player) return;
            if (player.inbattle || player.inventoryBusy) return;

            const dialogueName = typeof data === 'string' ? data : '';
            const playerTile = getPlayerTilePosition(player);
            const dialogueIsValid = isDialogueCompletionAllowed(pendingDialogue, {
                name: dialogueName,
                map: player.currentmap,
                playerX: playerTile.x,
                playerY: playerTile.y
            });

            if (!dialogueIsValid) {
                socket.emit('interactionRejected', { reason: 'invalid_or_expired_dialogue' });
                return;
            }
            const authorization = pendingDialogue;
            pendingDialogue = null;

            const dialogueAction = getEndSentenceInformation(dialogueName);
            if (dialogueAction === 'battle') {
                const battleDefinition = getNpcBattleDefinition(dialogueName);
                const progress = await loadProgressState(userId);
                if (!players[socket.id] || player.inbattle || player.inventoryBusy) return;
                if (!meetsRequirements(battleDefinition, progress)) {
                    socket.emit('interactionRejected', { reason: 'story_requirements_not_met' });
                    return;
                }
                if (battleDefinition?.once && await isNpcBattleCompleted(userId, dialogueName)) {
                    socket.emit('progressionNotice', {
                        type: 'already_completed',
                        message: 'Ce dresseur a déjà été vaincu.'
                    });
                    socket.emit('progressionState', await loadProgressState(userId));
                    return;
                }
                const getFightTeamName = getTeamInformation(dialogueName);
                const enemyteam = getPnjTeam(getFightTeamName);
                if (!enemyteam || !Array.isArray(enemyteam.pokemons) || enemyteam.pokemons.length === 0) {
                    socket.emit('interactionRejected', { reason: 'trainer_team_unavailable' });
                    return;
                }

                let victoryProgress = null;
                player.inbattle = true;
                socket.emit('battletrigger', { message: 'Le duel commence !', battleType: battleDefinition?.experienceKind || 'trainer', field: { weather: battleWeatherForMap(player.currentmap) } });
                startTeamBattle(player, enemyteam, io, userId, {
                    grantBaseMoney: !battleDefinition,
                    experienceKind: battleDefinition?.experienceKind || 'trainer',
                    onVictory: battleDefinition
                        ? async () => {
                            const completion = await completeNpcBattle(userId, dialogueName);
                            if (completion.granted) victoryProgress = completion.progress;
                            socket.emit('progressionState', completion.progress);
                            socket.emit('progressionNotice', {
                                type: completion.granted ? 'reward' : 'already_completed',
                                message: completion.granted
                                    ? 'Victoire enregistrée et récompense obtenue.'
                                    : 'Cette récompense avait déjà été récupérée.'
                            });
                            return completion;
                        }
                        : null
                })
                    .catch((error) => {
                        console.error('Erreur combat dresseur:', error?.message || error);
                    })
                    .finally(async () => {
                        if (players[socket.id]) {
                            await handleBlackout().catch((error) => {
                                console.error(`Erreur recuperation apres combat user ${userId}:`, error.message);
                            });
                            players[socket.id].inbattle = false;
                            io.to(socket.id).emit('teamStateChanged', {
                                reason: 'trainer_battle_end',
                                equipe: players[socket.id].equipe
                            });
                            const tile = getPlayerTilePosition(players[socket.id]);
                            // Une nouvelle scène peut suivre un combat plus long que le TTL du dialogue initial.
                            const followUpAuthorization = createDialogueAuthorization(authorization);
                            if (victoryProgress && isDialogueCompletionAllowed(followUpAuthorization, {
                                name: dialogueName, map: players[socket.id].currentmap,
                                playerX: tile.x, playerY: tile.y
                            })) {
                                const sentence = getSentenceForName(dialogueName, victoryProgress);
                                if (sentence && sentence[1] !== dialogueName) {
                                    pendingDialogue = createDialogueAuthorization({ ...authorization, name: sentence[1] });
                                    socket.emit('dialogue', sentence);
                                }
                            }
                        }
                    });
            } else if (dialogueAction === 'heal') {
                if (!player.equipe || !Array.isArray(player.equipe.pokemons)) {
                    return;
                }

                healTeam(player.equipe);

                try {
                    await Promise.all([
                        editEquipe(userId, player.equipe),
                        savePokemonCenterCheckpoint()
                    ]);
                } catch (error) {
                    console.error(`Erreur sauvegarde soin user ${userId}:`, error?.message || error);
                }

                io.to(socket.id).emit('teamStateChanged', {
                    reason: 'heal',
                    equipe: player.equipe
                });

                console.log("Tous les Pokémon de l'équipe ont été soignés !");
            } else if (dialogueAction === 'story') {
                const completion = await completeStoryEvent(userId, dialogueName);
                socket.emit('progressionState', completion.progress);
                if (completion.granted) socket.emit('progressionNotice', {
                    type: 'reward', message: completion.progress.objective?.text || 'Ton carnet de quêtes a été mis à jour.'
                });
            } else if (dialogueAction === 'shop') {
                await shopHandlers.openShop();
            }
        }));

        socket.on('Space', guardInteraction(async () => {
            const player = players[socket.id];
            if (!player) return;
            if (player.inbattle || player.inventoryBusy) return;

            if (!socketToChatSession.has(socket.id) && !hasPendingRequestForSocket(socket.id)) {
                const nearbyPlayer = findNearbyInteractablePlayer(socket.id);
                if (nearbyPlayer && nearbyPlayer.player && !nearbyPlayer.player.inbattle) {
                    socket.emit('interactionChoice', {
                        targetId: nearbyPlayer.id,
                        targetName: getPlayerDisplayName(nearbyPlayer.player),
                        distance: nearbyPlayer.distance,
                        battleAvailable: canPlayerEnterPvp(player) && canPlayerEnterPvp(nearbyPlayer.player),
                        requesterCanBattle: canPlayerEnterPvp(player),
                        targetCanBattle: canPlayerEnterPvp(nearbyPlayer.player)
                    });
                    return;
                }
            }

            const progress = await loadProgressState(userId);
            if (!players[socket.id] || player.inbattle || player.inventoryBusy) return;
            const matrixX = Math.floor(player.x / TILE_SIZE);
            const matrixY = Math.floor(player.y / TILE_SIZE);

            const adjacentPositions = [
                { x: matrixX, y: matrixY - 1 },
                { x: matrixX, y: matrixY + 1 },
                { x: matrixX - 1, y: matrixY },
                { x: matrixX + 1, y: matrixY }
            ];

            let interactionDetected = false;

            for (const pos of adjacentPositions) {
                const pnj = getPnjAtTile(currentmap, pos.x, pos.y);
                if (pnj) {
                    interactionDetected = true;
                    const sentence = getSentenceForName(pnj.interactionName || pnj.name, progress);
                    if (sentence) {
                        pendingDialogue = createDialogueAuthorization({
                            name: sentence[1],
                            map: currentmap,
                            x: pos.x,
                            y: pos.y
                        });
                        io.to(socket.id).emit('dialogue', sentence);
                    } else {
                        console.log(`No dialogue found for PNJ "${pnj.name}".`);
                    }
                    break;
                }

                if (Array.isArray(interactmap) && interactmap.length > 0 && Array.isArray(interactmap[0])) {
                    if (pos.x >= 0 && pos.x < interactmap[0].length && pos.y >= 0 && pos.y < interactmap.length) {
                        if (interactmap[pos.y][pos.x] !== 0) {
                            interactionDetected = true;
                            const sentence = getSentenceForMapAndPosition(currentmap, pos.x, pos.y, progress);

                            if (sentence) {
                                pendingDialogue = createDialogueAuthorization({
                                    name: sentence[1],
                                    map: currentmap,
                                    x: pos.x,
                                    y: pos.y
                                });
                                io.to(socket.id).emit('dialogue', sentence);
                            } else {
                                console.log('No dialogue found for this position.');
                            }
                            break;
                        }
                    } else {
                        console.log('Position en dehors des limites de la carte.');
                    }
                } else {
                    console.log('No dialogue found (interactmap invalide ou vide).');
                }
            }

            if (!interactionDetected) {
                console.log('No interaction detected near the player.');
            }
        }));

        socket.on('playerAction', async (action) => {
            if (!canMove || interactionBusy || transitionBusy) return;
            const player = players[socket.id];
            if (!player) return;
            if (player.inbattle || player.inventoryBusy) return;
            const direction = getDirectionFromAction(action);
            if (!direction) return;

            player.direction = direction;
            player.isMoving = true;
            if (typeof player.animationFrame !== 'number') {
                player.animationFrame = 0;
            }

            let newPlayerX = player.x;
            let newPlayerY = player.y;

            switch (action) {
                case 'move_z':
                    newPlayerY -= TILE_SIZE;
                    break;
                case 'move_s':
                    newPlayerY += TILE_SIZE;
                    break;
                case 'move_q':
                    newPlayerX -= TILE_SIZE;
                    break;
                case 'move_d':
                    newPlayerX += TILE_SIZE;
                    break;
                default:
                    return;
            }

            const matrixX = Math.floor(newPlayerX / TILE_SIZE);
            const matrixY = Math.floor(newPlayerY / TILE_SIZE);

            const previousPosition = { x: player.x, y: player.y };
            const blockedByPnj = isPnjBlockingTile(currentmap, matrixX, matrixY);
            if (collisionData2D[matrixY] && collisionData2D[matrixY][matrixX] === 0 && !blockedByPnj) {
                player.x = newPlayerX;
                player.y = newPlayerY;

                for (const id in players) {
                    if (players[id].currentmap === currentmap) {
                        io.to(id).emit('playerMoved', { id: socket.id, player: toPublicPlayer(player) });
                    }
                }

                schedulePositionSave();

                canMove = false;
                setTimeout(() => {
                    canMove = true;
                }, MOVE_DELAY);
            } else {
                player.isMoving = false;
                return;
            }

            if (battlemap2D[matrixY] && battlemap2D[matrixY][matrixX] != 0 && !changemap2D[matrixY]?.[matrixX] && !player.inbattle) {
                const randomNumber = Math.floor(Math.random() * 15);
                if (randomNumber === 0) {
                    player.inbattle = true;

                    async function utiliserCreatePokemon() {
                        try {
                            const pokemonsauvage = await CreatePokemon(currentmap);
                            if (!pokemonsauvage) {
                                return null;
                            }
                            return pokemonsauvage;
                        } catch (erreur) {
                            console.error(erreur);
                            return null;
                        }
                    }

                    utiliserCreatePokemon()
                        .then((pokemonsauvage) => {
                            if (!pokemonsauvage) {
                                if (players[socket.id]) {
                                    players[socket.id].inbattle = false;
                                }
                                return;
                            }
                            socket.emit('battletrigger', { message: 'Un Pokémon sauvage apparaît !', battleType: 'wild', field: { weather: battleWeatherForMap(player.currentmap) } });
                            return startBattle(player, pokemonsauvage, io, userId, equipe)
                                .catch((erreur) => {
                                    console.error(erreur);
                                })
                                .finally(async () => {
                                    if (players[socket.id]) {
                                        await handleBlackout().catch((error) => {
                                            console.error(`Erreur recuperation apres combat user ${userId}:`, error.message);
                                        });
                                        players[socket.id].inbattle = false;
                                        io.to(socket.id).emit('teamStateChanged', {
                                            reason: 'wild_battle_end',
                                            equipe: players[socket.id].equipe
                                        });
                                    }
                                });
                        })
                        .catch((erreur) => {
                            console.error(erreur);
                            if (players[socket.id]) {
                                players[socket.id].inbattle = false;
                            }
                        });
                }
            }

            if (changemap2D[matrixY] && changemap2D[matrixY][matrixX] != 0) {
                const nextMapData = getNextMap(currentmap, matrixX, matrixY);
                if (nextMapData) {
                    let destination = { map: nextMapData.nextMap, x: nextMapData.nextX, y: nextMapData.nextY };
                    if (currentmap === 'centre') {
                        destination = getPokemonCenterExit(player.centerReturnPoint);
                    } else if (destination.map === 'centre') {
                        player.centerReturnPoint = getPokemonCenterEntryReturn(currentmap, matrixX, matrixY, previousPosition);
                    }
                    transitionBusy = true;
                    try {
                        await relocatePlayer(destination, { reason: 'map_transition', saveCheckpoint: true });
                    } finally {
                        transitionBusy = false;
                    }
                }
            }
        });

        socket.on('disconnect', async () => {
            if (saveTimer) {
                clearTimeout(saveTimer);
                saveTimer = null;
            }

            savePending = true;
            await flushPositionSave();

            cancelPendingRequestsForSocket(socket.id, 'player_disconnected');
            closeChatSessionForSocket(socket.id, 'player_disconnected');
            blackoutHandlers.delete(socket.id);

            delete players[socket.id];
            io.emit('playerDisconnected', { id: socket.id });
        });
    });
};

module.exports = socketHandler;

