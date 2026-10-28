const { exclusiveAccountConnection, trackAccountTask } = require('./accountConnection');
const { getMapWeather, battleWeatherForMap } = require('../game/world/mapWeather');
const { getPokemonCenterEntryReturn, getPokemonCenterExit } = require('../game/world/pokemonCenterTravel');
const { startPnjMovement } = require('../game/world/pnjMovement');
const { loadCollisionData, changeMapData, getNextMap, battleMapData, InteractMapData } = require('../game/world/mapRepository');
const stairways=require('../game/world/stairways');
const { loadEquipe, editEquipe } = require('../persistence/teamRepository');
const CreatePokemon = require('../game/world/wildPokemonFactory');
const { applyEncounterGuarantee } = require('../persistence/adventureEncounterRepository');
const { WILD_ENCOUNTER_CHANCE } = require('../game/world/encounterRate');
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
const defaultPnjStore = require('../game/world/pnjStore');
const raphTrial = require('../game/world/raphTrial');
const raphTrialRepository = require('../persistence/raphTrialRepository');
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
const {devicesForMap,isNearComputer}=require('../game/world/pokemonComputer');
const {registerPokemonComputerHandlers}=require('./handlers/pokemonComputerHandlers');
const {registerRepelHandlers}=require('./handlers/repelHandlers');
const {remainingRepel,stepRepel,repelsWild}=require('../game/items/repel');
const { registerEvolutionHandlers } = require('./handlers/evolutionHandlers');
const { registerMoveLearningHandlers } = require('./handlers/moveLearningHandlers');
const { registerTeamOrderHandlers } = require('./handlers/teamOrderHandlers');
const arenaTests = require('../game/world/arenaTests');
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
const storyGates = require('../game/world/storyGates');

const MOVE_DELAY = 130;
const POSITION_SAVE_DELAY_MS = 4000;
const INTERACTION_REQUEST_TIMEOUT_MS = 25000;

let players = {};
const pendingInteractionRequests = new Map();
const activeChatSessions = new Map();
const socketToChatSession = new Map();
const blackoutHandlers = new Map();
const replaySessions = new Map();

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
    startPnjMovement(io, () => players, player=>replaySessions.get(player.id)?.pnjsForMap?.(player.currentmap)||defaultPnjStore.getPnjsForMap(player.currentmap));
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

        const battleTask = (async () => {
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
        for (const id of [socketIdA,socketIdB]) trackAccountTask(io.sockets.sockets.get(id),battleTask);
    };

    io.on('connection', exclusiveAccountConnection(async (socket, account) => {
        const userId = Number.parseInt(socket.data.user?.id, 10);
        if (!Number.isInteger(userId) || userId <= 0) {
            socket.disconnect(true);
            return;
        }
        require('./worldClock').registerWorldClock(socket);
        const requestedUsername = typeof socket.data.user?.username === 'string'
            ? socket.data.user.username.trim()
            : '';

        const [equipe, loadedSavedPosition, spritePalette] = await Promise.all([
            loadEquipe(userId),
            loadUserPosition(userId),
            require('../persistence/playerRepository').loadUserSpritePalette(userId)
        ]);
        if (!account.active()) return;
        await synchronizeCaughtPokemon(userId, equipe?.pokemons).catch((error) => {
            console.error(`Erreur réconciliation Pokédex user ${userId}:`, error.message);
        });

        if (!account.active()) return;
        let savedPosition = loadedSavedPosition;
        const hasLegacyMap =
            savedPosition &&
            (savedPosition.map === 'default_map' || !savedPosition.map);

        if (hasLegacyMap) {
            savedPosition = {
                sprite: savedPosition?.sprite,
                repel_steps: savedPosition?.repel_steps
            };
        }

        let currentmap = resolveMapName(savedPosition?.map || DEFAULT_MAP);
        const mirrorRift=require('../game/world/mirrorRift');
        const supportsMirrorRift=socket.handshake?.auth?.mirrorRift===true;
        // A won duel survives a lost socket or restart during the closing cinematic.
        if(['route2_maison','maison',mirrorRift.config.wake.map].includes(currentmap)){
            const pending=await require('../persistence/mirrorRiftRepository').read(userId);
            if(pending.state.stage==='won'){
                healTeam(equipe);await editEquipe(userId,equipe);
                await require('../persistence/mirrorRiftRepository').completeWake(userId);
                savedPosition={...savedPosition,...mirrorRift.config.wake};currentmap=mirrorRift.config.wake.map;
            }
        }
        let raphTrialState = currentmap === raphTrial.config.map ? await raphTrialRepository.ensure(userId,savedPosition) : null;
        const lucieScene=require('../game/world/lucieDeparture');
        const labStory=require('../game/world/labStory');
        const voidEnding=require('../game/world/voidEnding');
        let initialStoryProgress=labStory.maps.has(currentmap)||storyGates.gates.some(g=>g.map===currentmap&&g.actor)?await loadProgressState(userId):null;
        if (!account.active()) return;
        let personalProgress=initialStoryProgress||{flags:{}},lucieLeaving=false;
        const {getPnjsForMap,getPnjAtTile,isPnjBlockingTile}=lucieScene.scopedStore(voidEnding.scopedStore(labStory.scopedStore(raphTrial.scopedStore(defaultPnjStore,()=>raphTrialState),()=>personalProgress),()=>personalProgress),()=>personalProgress,()=>lucieLeaving);
        const personalTileBlocked=(map,x,y)=>isPnjBlockingTile(map,x,y)||mirrorRift.blocked(map,x,y,personalProgress)||Boolean(storyGates.actorAtTile(map,x,y,personalProgress));
        let collisionData2D = loadCollisionData(currentmap);
        let changemap2D = changeMapData(currentmap);
        let battlemap2D = battleMapData(currentmap);
        let interactmap = InteractMapData(currentmap);
        let currentPnjs = getPnjsForMap(currentmap);

        const spawnPosition = sanitizeSpawnPosition(savedPosition?.x, savedPosition?.y, collisionData2D, currentmap,{blocked:personalTileBlocked});

        players[socket.id] = {
            id: socket.id,
            userId,
            username: requestedUsername || null,
            x: spawnPosition.x,
            y: spawnPosition.y,
            sprite: sanitizeSpriteName(savedPosition?.sprite || DEFAULT_SPRITE),
            spritePalette,
            direction: 'down',
            isMoving: false,
            animationFrame: 0,
            isInteracting: false,
            interactionAsset: null,
            currentmap,
            equipe,
            respawnPoint: savedPosition?.respawnPoint || null,
            repelSteps: remainingRepel({repelSteps:savedPosition?.repel_steps}),
            centerReturnPoint: savedPosition?.centerReturnPoint || null,
            inbattle: false
        };

        const fishing = require('../game/world/fishingController').createFishingController({
            ownsRod: async () => (await require('../persistence/itemRepository').loadUserItems(userId)).some(i => i.key === 'fishing_rod' && i.quantity > 0),
            available: p => players[socket.id] === p && socket.connected && !p.inbattle && !p.inventoryBusy && !transitionBusy && hasConsciousPokemon(p.equipe),
            emit: (p,event,payload) => socket.emit(event,payload),
            onHook: async p => {
                if (players[socket.id] !== p || p.inbattle || !socket.connected) return;
                const encounter = require('../game/world/fishingEncounters').fishingEncounter(p.currentmap);
                if (!encounter) return;
                p.inbattle = true;
                try {
                    const wild = await CreatePokemon.createAtLevel(encounter.id,encounter.level);
                    if (players[socket.id] !== p || !socket.connected) return;
                    socket.emit('battletrigger',{message:'Ça mord !',battleType:'wild',environment:'lake',field:{weather:battleWeatherForMap(p.currentmap)}});
                    await account.track(startBattle(p,wild,io,userId,p.equipe));
                } finally {
                    if (players[socket.id] === p) {
                        await handleBlackout().catch(error => console.error('Récupération après pêche :',error.message));
                        p.inbattle = false;
                        socket.emit('teamStateChanged',{reason:'wild_battle_end',equipe:p.equipe});
                    }
                }
            }
        });
        for (const [event, operation] of Object.entries({
            'fishing:start': (p,data) => fishing.start(p,data?.id),
            'fishing:reel': (p,data) => fishing.reel(p,data?.id),
            'fishing:cancel': p => fishing.cancel(p)
        })) account.on(event,(data,ack) => {
            const p=players[socket.id];
            const success=Boolean(p && operation(p,data));
            if (typeof ack === 'function') ack({success});
        });
        let arenaCollapse = null;
        let canMove = true;
        let transitionBusy = false;
        let saveTimer = null;
        let activePositionSave = null;
        let savePending = false;
        let pendingDialogue = null;
        const syncRaphTrial = (state,teleport=null,reset=false) => {
            raphTrialState=state;
            if(currentmap!==raphTrial.config.map || !socket.connected)return;
            currentPnjs=getPnjsForMap(currentmap);
            socket.emit('pnjsList',{mapname:currentmap,pnjs:currentPnjs,...(teleport?{teleport}: {}),...(reset?{teleportReset:true}: {})});
        };
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
                repelSteps: remainingRepel({repelSteps:savedPosition.repel_steps}),
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
                            // Inactive/stale tabs must not clear a newer protection when only their position changes.
                            const repelChanged = remainingRepel(positionToSave) !== remainingRepel(lastSavedPosition);
                            await saveUserPosition(userId, {...positionToSave, repelSteps:repelChanged ? positionToSave.repelSteps : undefined});
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
            if (!account.active()) return;
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

        account.onClose(async () => {
            arenaCollapse?.stop();
            replaySessions.delete(socket.id);
            fishing.stop();
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

        const emitPlayerProgression = (progression) => {
            personalProgress=progression;
            socket.emit('voidEndingState',voidEnding.state(progression));
            socket.emit('mirrorRiftState',mirrorRift.state(progression));
            socket.emit('progressionState', progression);
            socket.emit('storyGatesState', { gates: storyGates.snapshot(progression) });
            socket.emit('adminArenaState', arenaTests.publicState(socket.data.user, progression));
            if(labStory.maps.has(currentmap)){currentPnjs=getPnjsForMap(currentmap);socket.emit('pnjsList',{mapname:currentmap,pnjs:currentPnjs});}
        };
        let roomEntryShown = false;
        const showRoomEntry = async (progression) => {
            const player = players[socket.id];
            if (!player || player.inbattle || pendingDialogue) return;
            const pendingDeparture=lucieScene.profiles.find(scene=>player.currentmap===scene.map&&lucieScene.pending(progression||personalProgress,scene));
            if(pendingDeparture) {
                const name=pendingDeparture.dialogue,sentence=getSentenceForName(name);
                pendingDialogue={...createDialogueAuthorization({name,map:player.currentmap,x:Math.floor(player.x/32),y:Math.floor(player.y/32)}),lucieDeparture:true};
                socket.emit('dialogue',[...sentence,{entryMap:player.currentmap}]);return;
            }
            if(player.currentmap===voidEnding.config.map){
                const map=player.currentmap,progress=progression||await loadProgressState(userId);
                if(!socket.connected||players[socket.id]!==player||player.currentmap!==map||player.inbattle||pendingDialogue)return;
                const scene=voidEnding.entryDialogue(progress);if(!scene)return;
                pendingDialogue={...createDialogueAuthorization({name:scene.name,map,x:Math.floor(player.x/32),y:Math.floor(player.y/32)}),arenaEntry:true,voidEntry:scene.name===voidEnding.dialogues.entry.name,voidPardon:scene.name===voidEnding.dialogues.pardon.name};
                socket.emit('dialogue',[scene.sentences,scene.name,{entryMap:map}]);return;
            }
            const arenaScenes = require('../game/world/arenaScenes');
            if (arenaScenes.scenes.some(s => s.map === player.currentmap)) {
                const map = player.currentmap;
                const progress = progression || await loadProgressState(userId);
                if (!socket.connected || players[socket.id] !== player || player.currentmap !== map || player.inbattle || pendingDialogue) return;
                const scene = arenaScenes.entry(player, progress.flags);
                if (!scene) return;
                pendingDialogue = {...createDialogueAuthorization({name:scene.name,map,x:Math.floor(player.x/32),y:Math.floor(player.y/32)}), arenaEntry:true};
                socket.emit('dialogue', [scene.sentences,scene.name,{entryMap:map}]);
                return;
            }
            if (roomEntryShown || player.currentmap !== 'route2_maison') return;
            const progress = progression || await loadProgressState(userId);
            if (!socket.connected || players[socket.id] !== player || player.inbattle || pendingDialogue) return;
            const name = require('../game/world/roomObstacles').entryDialogue(player, progress);
            if (!name) return;
            const sentence = getSentenceForName(name);
            if (!sentence) return;
            roomEntryShown = true;
            pendingDialogue = createDialogueAuthorization({name, map:player.currentmap, x:Math.floor(player.x/32), y:Math.floor(player.y/32)});
            socket.emit('dialogue', [...sentence, {entryMap:player.currentmap}]);
        };
        let lastGateAttempt = 0;
        let lastGateNotice = 0;

        const emitProgressionSnapshot = async () => {
            const cached=initialStoryProgress;initialStoryProgress=null;
            const [progression, pokedex] = await Promise.all([
                cached||loadProgressState(userId),
                loadPokedex(userId)
            ]);
            emitPlayerProgression(progression);
            socket.emit('pokedexState', pokedex);
            await showRoomEntry(progression);
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

        const recordFlightVisit = async () => {
            const player=players[socket.id];if(!player)return;
            const flights=require('../persistence/flightRepository');
            try {
                if(await flights.recordTownVisit(userId,player.currentmap,player.centerReturnPoint))socket.emit('flightState',await flights.loadFlightState(userId));
            } catch(error) { console.error('Enregistrement visite:',error.message); }
        };

        const relocatePlayer = async (destination, { reason = 'relocation', saveCheckpoint = false } = {}) => {
            if (players[socket.id]) fishing.cancel(players[socket.id]);
            const player = players[socket.id];
            if (!player) return false;
            stairways.clear(player);

            const oldMap = currentmap;
            let storyExit=false;
            if(oldMap==='route2_maison'&&destination?.map==='route2'){
                storyExit=await require('../persistence/labStoryRepository').noteExit(userId);
                if(storyExit)personalProgress=await loadProgressState(userId);
            }
            currentmap = resolveMapName(destination?.map);
            if (oldMap !== currentmap) roomEntryShown = false;
            collisionData2D = loadCollisionData(currentmap);
            changemap2D = changeMapData(currentmap);
            battlemap2D = battleMapData(currentmap);
            interactmap = InteractMapData(currentmap);
            raphTrialState=currentmap===raphTrial.config.map ? await raphTrialRepository.ensure(userId,{...destination,currentmap}) : null;
            currentPnjs = getPnjsForMap(currentmap);

            const safeDestination = sanitizeSpawnPosition(
                destination?.x,
                destination?.y,
                collisionData2D,
                currentmap,
                {allowTransition:reason === 'map_transition',blocked:personalTileBlocked}
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
            socket.emit('worldDevicesState',devicesForMap(currentmap));
            socket.emit('pnjsList', { mapname: currentmap, pnjs: currentPnjs });
            if(storyExit)refreshReplaySessions(personalProgress);
            schedulePositionSave({ immediate: true });
            await recordFlightVisit();

            if (saveCheckpoint && currentmap === 'centre') {
                await savePokemonCenterCheckpoint();
            }

            await arenaCollapse?.enter();
            await showRoomEntry();

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

        if (!account.active()) return;
        arenaCollapse = require('../game/world/arenaCollapseController').createArenaCollapseController({
            getPlayer:()=>players[socket.id],
            loadStart:()=>require('../persistence/arenaCollapseRepository').ensure(userId),
            emit:state=>socket.emit('arenaCollapseState',state),
            collision:()=>collisionData2D,
            occupied:(x,y)=>isPnjBlockingTile(currentmap,x,y),
            rescue:(player,tile)=>{
                player.x=tile.x*TILE_SIZE+16;player.y=tile.y*TILE_SIZE+16;player.isMoving=false;
                for(const id in players)if(players[id].currentmap===currentmap)io.to(id).emit('playerMoved',{id:socket.id,player:toPublicPlayer(player)});
                socket.emit('progressionNotice',{message:'Le sol cède ! Tu te mets à l’abri sur une dalle solide.'});
                schedulePositionSave({immediate:true});
            }
        });
        socket.once('disconnect',()=>arenaCollapse.stop());
        await arenaCollapse.enter();
        if (!account.active()) return;
        const sameMapPlayers = getPlayersInMap(players, currentmap);
        socket.emit('playersList', sameMapPlayers);
        socket.emit('mapWeatherState', getMapWeather(currentmap));
        socket.emit('worldDevicesState',devicesForMap(currentmap));
        socket.emit('pnjsList', { mapname: currentmap, pnjs: currentPnjs });
        await recordFlightVisit();
        if (!account.active()) return;
        emitProgressionSnapshot().catch((error) => {
            console.error(`Erreur chargement progression user ${userId}:`, error.message);
        });

        for (const id in players) {
            if (players[id].currentmap === currentmap) {
                io.to(id).emit('newPlayer', { id: socket.id, player: toPublicPlayer(players[socket.id]) });
            }
        }

        registerPlayerProfileHandlers({ socket, io, players, userId });
        require('./handlers/trainerPaletteHandlers').registerTrainerPaletteHandlers({socket,userId,getPlayer:()=>players[socket.id],broadcast:(p,palette)=>{
            for(const peer of Object.values(players))if(peer.currentmap===p.currentmap)io.to(peer.id).emit('playerPaletteUpdated',{id:p.id,palette});
        }});
        replaySessions.set(socket.id, {userId,
            pnjsForMap:getPnjsForMap,
            syncRaphTrial,
            canReset:()=>!interactionBusy&&!transitionBusy&&!pendingDialogue&&!socketToChatSession.has(socket.id)
                && !players[socket.id]?.inbattle && !players[socket.id]?.inventoryBusy,
            refresh:(progress,reset)=>{if(reset){roomEntryShown=false;arenaCollapse?.enter().catch(e=>console.error('Réinitialisation du sol :',e.message));
                if(currentmap===raphTrial.config.map)raphTrialRepository.ensure(userId,players[socket.id]).then(state=>syncRaphTrial(state,null,true)).catch(e=>console.error('Réinitialisation de Raph :',e.message));
            }emitPlayerProgression(progress);}
        });
        const refreshReplaySessions = (progress, reset = false) => {
            for (const session of replaySessions.values()) if(session.userId===userId) session.refresh(progress,reset);
        };
        const mirrorHandlers=require('./handlers/mirrorRiftHandlers').createMirrorRiftHandlers({socket,io,userId,
            getPlayer:()=>players[socket.id],canUse:()=>!transitionBusy&&!pendingDialogue&&!socketToChatSession.has(socket.id),
            setBusy:value=>{transitionBusy=value;},emitProgression:emitPlayerProgression,blackout:handleBlackout,
            travel:async destination=>{await relocatePlayer(destination,{reason:'mirror_awakened'});await flushPositionSave();}
        });
        account.on('mirrorRiftWake',guardInteraction(async()=>{if(mirrorRift.state(personalProgress).stage==='won')await mirrorHandlers.awaken();}));
        registerTeamOrderHandlers({socket,userId,getPlayer:()=>players[socket.id],canUse:()=>!interactionBusy&&!transitionBusy});
        require('./handlers/arenaTestHandlers').registerArenaTestHandlers({socket,getPlayer:()=>players[socket.id],
            getPeers:()=>Object.values(players).filter(p=>p.userId===userId),
            canUse:()=>[...replaySessions.values()].filter(s=>s.userId===userId).every(s=>s.canReset()),
            emitProgression:emitPlayerProgression,onRearmed:progress=>refreshReplaySessions(progress,true)});
        registerMedicineHandlers({socket,userId,getPlayer:()=>players[socket.id],canUse:()=>!interactionBusy&&!transitionBusy});
        let lastVoidTravel=0;
        account.on('void:travel',async(_data,ack)=>{
            const reply=typeof ack==='function'?ack:()=>{},player=players[socket.id];
            if(!player||transitionBusy||interactionBusy||pendingDialogue||player.inbattle||player.inventoryBusy||socketToChatSession.has(socket.id)||Date.now()-lastVoidTravel<3000)return reply({success:false,message:'L’objet ne réagit pas pour le moment.'});
            transitionBusy=true;player.inventoryBusy=true;
            try{
                const r=await require('../persistence/voidEndingRepository').read(userId);
                if(!r.owned||!r.state.available||!r.state.found||r.state.charge!==5||currentmap===voidEnding.config.map)return reply({success:false,message:'L’objet ne réagit pas.'});
                if(!account.active()||players[socket.id]!==player||player.inbattle)return;
                pendingDialogue=null;fishing.cancel(player);cancelPendingRequestsForSocket(socket.id,'void_travel');
                player.direction='up';player.isMoving=false;player.animationFrame=0;
                personalProgress=await loadProgressState(userId);
                await relocatePlayer(voidEnding.config.arrival,{reason:'void_travel'});
                if(!await flushPositionSave())throw Error('Position non sauvegardée.');
                canMove=true;lastVoidTravel=Date.now();reply({success:true,map:voidEnding.config.map});
            }catch(error){console.error('Passage indisponible:',error.message);reply({success:false,message:'Le passage a été interrompu. Vérifie ta position après reconnexion.'});}
            finally{player.inventoryBusy=false;transitionBusy=false;}
        });
        const computerHandlers=registerPokemonComputerHandlers({socket,io,userId,getPlayer:()=>players[socket.id],getPeers:()=>Object.values(players).filter(p=>p.userId===userId),canUse:()=>!transitionBusy});
        registerRepelHandlers({socket,userId,getPlayer:()=>players[socket.id],canUse:()=>!interactionBusy&&!transitionBusy,flushPositionSave,schedulePositionSave});
        socket.emit('fieldEffectState',{repelSteps:remainingRepel(players[socket.id])});
        registerMoveLearningHandlers({socket,userId,getPlayer:()=>players[socket.id],canUse:()=>!interactionBusy&&!transitionBusy});
        registerEvolutionHandlers({socket,userId,getPlayer:()=>players[socket.id],canUse:()=>!interactionBusy&&!transitionBusy});
        const shopHandlers = registerShopHandlers({
            socket,
            userId,
            getPlayer: () => players[socket.id] || null
        });

        require('./handlers/flightHandlers').registerFlightHandlers({
            socket,userId,getPlayer:()=>players[socket.id],
            canUse:()=>!interactionBusy&&!transitionBusy&&!pendingDialogue&&!socketToChatSession.has(socket.id),
            setBusy:value=>{transitionBusy=value;},
            travel:async (destination,player)=>{
                pendingDialogue=null;fishing.cancel(player);
                cancelPendingRequestsForSocket(socket.id,'flight');
                player.direction='down';player.isMoving=false;player.animationFrame=0;
                await relocatePlayer(destination,{reason:'flight'});
                if(!await flushPositionSave())throw Error('Position non sauvegardée');
                canMove=true;
            }
        });

        require('./handlers/positionRecoveryHandlers').registerPositionRecoveryHandlers({
            socket, getPlayer:()=>players[socket.id],
            canUse:()=>!interactionBusy && !transitionBusy && !socketToChatSession.has(socket.id),
            recover:async player=>{
                transitionBusy=true;
                try {
                    const destination=sanitizeSpawnPosition(player.x,player.y,collisionData2D,currentmap,{manual:true,blocked:personalTileBlocked});
                    pendingDialogue=null;
                    cancelPendingRequestsForSocket(socket.id,'position_recovered');
                    player.isInteracting=false; player.interactionAsset=null; player.animationFrame=0;
                    await relocatePlayer({map:currentmap,...destination},{reason:'position_recovery'});
                    canMove=true;
                    if (!await flushPositionSave()) throw new Error('Position non sauvegardée');
                } finally { transitionBusy=false; }
            }
        });

        account.on('requestGameSave', async (acknowledge) => {
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

        account.on('playerInteractionChoice', (payload = {}) => {
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

        account.on('interactionRequestDecision', (payload = {}) => {
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

        // Reuse the same authoritative battle/reward path for normal dialogue
        // completion and Raph's server-authorized reveal on the dais.
        const finishDialogue = async (data) => {
            const player = players[socket.id];
            if (!player) return;
            if (player.inbattle || player.inventoryBusy) return;

            const dialogueName = typeof data === 'string' ? data : '';
            const playerTile = getPlayerTilePosition(player);
            // This entry speech is read-only: a long listening pause must not leave it locked by the reward-dialogue TTL.
            const readOnlyEntry = (pendingDialogue?.name === 'lucie_room_entry' || pendingDialogue?.arenaEntry || pendingDialogue?.lucieDeparture) && dialogueName === pendingDialogue.name && player.currentmap === pendingDialogue.map;
            const dialogueIsValid = readOnlyEntry || isDialogueCompletionAllowed(pendingDialogue, {
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

            if(authorization.voidJournal)return;
            if(authorization.voidPardon){
                await require('../persistence/voidEndingRepository').acknowledgePardon(userId);
                emitPlayerProgression(await loadProgressState(userId));return;
            }

            const departure=lucieScene.profiles.find(scene=>scene.dialogue===dialogueName);
            if(departure) {
                await require('./handlers/lucieDepartureHandlers').depart({socket,userId,player,getPlayer:()=>players[socket.id],setLeaving:value=>{lucieLeaving=value;},emitProgression:emitPlayerProgression,syncPeers:progress=>refreshReplaySessions(progress),profile:departure});
                return;
            }
            if (authorization.arenaEntry) {
                if(authorization.voidEntry){
                    await require('../persistence/voidEndingRepository').acknowledgeEntry(userId);
                    emitPlayerProgression(await loadProgressState(userId));
                }else await require('../persistence/arenaSceneRepository').acknowledge(userId, dialogueName);
                return;
            }
            if(authorization.voidFinale){
                const r=await require('../persistence/voidEndingRepository').read(userId);
                if(!r.owned||!r.state.available||!r.state.found||r.state.charge!==5||r.state.defeated||!voidEnding.adjacent(player,voidEnding.config.professor)||!hasConsciousPokemon(player.equipe))return;
                player.inbattle=true;
                socket.emit('battletrigger',{battleType:'trainer',musicKind:'void',environment:'void-arena',trainerKey:'professor_final'});
                let resolution=null;
                account.track(require('../game/battle/professorFinale').start(player,io,userId,{onResolve:async choice=>{
                    const result=await require('../persistence/voidEndingRepository').resolveOutcome(userId,choice);if(result)resolution=choice;return result;
                }})
                    .catch(error=>console.error('Confrontation interrompue:',error.message))
                    .finally(async()=>{if(players[socket.id]===player){
                        player.inbattle=false;emitPlayerProgression(await loadProgressState(userId));socket.emit('teamStateChanged',{reason:'finale',equipe:player.equipe});
                        if(resolution==='pardon'&&socket.connected&&player.currentmap===voidEnding.config.map){
                            const scene=voidEnding.dialogues.pardon;
                            pendingDialogue={...createDialogueAuthorization({name:scene.name,map:currentmap,x:voidEnding.config.professor.x,y:voidEnding.config.professor.y}),arenaEntry:true,voidPardon:true};
                            socket.emit('dialogue',[scene.sentences,scene.name,{afterBattle:true}]);
                        }
                    }}));
                return;
            }
            const dialogueAction = getEndSentenceInformation(dialogueName);
            if (dialogueAction === 'battle') {
                const battleDefinition = getNpcBattleDefinition(dialogueName);
                if(dialogueName===raphTrial.config.champion && !raphTrial.ready(raphTrialState)) {
                    socket.emit('interactionRejected',{reason:'arena_trial_incomplete'});return;
                }
                const progress = await loadProgressState(userId);
                if (!players[socket.id] || player.inbattle || player.inventoryBusy) return;
                const testRematch = arenaTests.canReplay(socket.data.user, dialogueName, progress);
                if (!meetsRequirements(battleDefinition, labStory.view(progress))) {
                    socket.emit('interactionRejected', { reason: 'story_requirements_not_met' });
                    return;
                }
                if (!testRematch && battleDefinition?.once && await isNpcBattleCompleted(userId, dialogueName)) {
                    socket.emit('progressionNotice', {
                        type: 'already_completed',
                        message: 'Ce dresseur a déjà été vaincu.'
                    });
                    emitPlayerProgression(await loadProgressState(userId));
                    return;
                }
                if ((testRematch || dialogueName===raphTrial.config.champion) && Object.values(players).some(p=>p.userId===userId&&p.inbattle)) {
                    socket.emit('interactionRejected',{reason:'battle_already_running'});return;
                }
                const getFightTeamName = getTeamInformation(dialogueName);
                const enemyteam = getPnjTeam(getFightTeamName);
                if (!enemyteam || !Array.isArray(enemyteam.pokemons) || enemyteam.pokemons.length === 0) {
                    socket.emit('interactionRejected', { reason: 'trainer_team_unavailable' });
                    return;
                }

                let victoryProgress = null;
                player.inbattle = true;
                socket.emit('battletrigger', { message: 'Le duel commence !', trainerKey: dialogueName, battleType: battleDefinition?.experienceKind || 'trainer', field: { weather: battleWeatherForMap(player.currentmap) } });
                account.track(startTeamBattle(player, enemyteam, io, userId, {
                    grantBaseMoney: !battleDefinition,
                    testRematch,
                    experienceKind: battleDefinition?.experienceKind || 'trainer',
                    arenaBattleKey: battleDefinition?.experienceKind === 'arena' || battleDefinition?.uniqueExperience ? battleDefinition.battleKey : null,
                    onVictory: battleDefinition
                        ? async () => {
                            if (testRematch) {
                                await require('../persistence/arenaTestRepository').complete(socket.data.user,dialogueName);
                                victoryProgress = await loadProgressState(userId);
                                refreshReplaySessions(victoryProgress);
                                socket.emit('progressionNotice',{message:'Test terminé. Tu peux réinitialiser cette rencontre dans les options.'});
                                return {granted:false,reason:'admin_test'};
                            }
                            const completion = await completeNpcBattle(userId, dialogueName);
                            if (completion.granted) victoryProgress = completion.progress;
                            emitPlayerProgression(completion.progress);
                            socket.emit('progressionNotice', {
                                type: completion.granted ? 'reward' : 'already_completed',
                                message: completion.granted
                                    ? (dialogueName === 'champion_hoze' ? 'Victoire enregistrée ! Multi Exp débloqué : fais-le tenir au premier Pokémon de ton équipe.' : 'Victoire enregistrée et récompense obtenue.')
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
                                    pendingDialogue = {...createDialogueAuthorization({ ...authorization, name: sentence[1] }),...(lucieScene.profiles.some(scene=>scene.actor===dialogueName)?{lucieDeparture:true}:{})};
                                    socket.emit('dialogue', [...sentence, {afterBattle:true}]);
                                }
                            }
                        }
                    }));
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
                const replay=await require('../persistence/labStoryRepository').completeReplay(userId,dialogueName);
                if(replay.handled){refreshReplaySessions(await loadProgressState(userId));return;}
                const completion = await completeStoryEvent(userId, dialogueName);
                refreshReplaySessions(completion.progress);
                if (completion.granted) socket.emit('progressionNotice', {
                    type: 'reward', message: completion.progress.objective?.text || 'Ton carnet de quêtes a été mis à jour.'
                });
            } else if (dialogueAction === 'shop') {
                await shopHandlers.openShop();
            }
        };
        account.on('onEndDialogue', guardInteraction(finishDialogue));

        account.on('Space', guardInteraction(async () => {
            if (pendingDialogue?.arenaEntry || pendingDialogue?.lucieDeparture) return;
            const player = players[socket.id];
            if (!player) return;
            if (player.inbattle || player.inventoryBusy) return;
            if (fishing.current(player)) { fishing.reel(player,fishing.current(player).id); return; }
            if(supportsMirrorRift&&!pendingDialogue&&currentmap===mirrorRift.config.map&&mirrorRift.interaction(player,personalProgress)&&await mirrorHandlers.interact())return;

            if(!transitionBusy&&!pendingDialogue&&currentmap===voidEnding.config.map){
                const book=voidEnding.journalAt(player);
                if(book){
                    const r=await require('../persistence/voidEndingRepository').read(userId);
                    if(r.owned&&r.state.available&&r.state.found&&r.state.charge===5){
                        const name='void_journal_'+book.id;
                        pendingDialogue={...createDialogueAuthorization({name,map:currentmap,x:book.x,y:book.y}),arenaEntry:true,voidJournal:true};
                        socket.emit('dialogue',[book.pages.map((text,index)=>({text:book.title+' · '+(index+1)+'/'+book.pages.length+'\n\n'+text,typewriterMs:0})),name]);
                    }
                    return;
                }
            }

            if(!transitionBusy&&!pendingDialogue&&(currentmap==='professor_lab'||currentmap===voidEnding.config.map)){
                const target=currentmap==='professor_lab'?voidEnding.config.pickup:voidEnding.config.professor;
                if(voidEnding.adjacent(player,target)){
                    const repository=require('../persistence/voidEndingRepository'),r=await repository.read(userId);
                    if(r.state.available){
                        if(currentmap==='professor_lab'){
                            if(await repository.pickup(userId)){emitPlayerProgression(await loadProgressState(userId));socket.emit('bagUpdated',{items:await require('../persistence/itemRepository').loadUserItems(userId)});socket.emit('progressionNotice',{message:'Tu récupères un téléporteur déchargé.'});}
                            return;
                        }
                        if(r.state.found&&r.owned&&r.state.charge===5){
                            if(r.state.defeated){
                                if(r.state.resolution==='pardon'){
                                    const scene=r.state.pardonSeen?voidEnding.dialogues.pardonedReturn:voidEnding.dialogues.pardon;
                                    pendingDialogue={...createDialogueAuthorization({name:scene.name,map:currentmap,x:target.x,y:target.y}),arenaEntry:true,voidPardon:true};
                                    socket.emit('dialogue',[scene.sentences,scene.name]);return;
                                }
                                const claimed=await repository.badge(userId);emitPlayerProgression(await loadProgressState(userId));
                                const name='professor_final_silence';pendingDialogue=createDialogueAuthorization({name,map:currentmap,x:target.x,y:target.y});
                                socket.emit('dialogue',[[{text:claimed?'Tu récupères le Badge Violence.\n\nLe silence retombe. Cette fois, c’est terminé.':'Le Professeur reste au sol. Plus rien ne bouge.',typewriterMs:45}],name]);return;
                            }
                            const {name,sentences}=voidEnding.dialogues.challenge;pendingDialogue={...createDialogueAuthorization({name,map:currentmap,x:target.x,y:target.y}),voidFinale:true};
                            socket.emit('dialogue',[sentences,name]);return;
                        }
                    }
                }
            }

            if (currentmap === 'start' && (labStory.adjacent(player,labStory.config.door)||labStory.adjacent(player,labStory.config.rock))) {
                if(transitionBusy||pendingDialogue)return;
                const progress=await loadProgressState(userId),action=labStory.interaction(player,progress);
                if(action?.enter){transitionBusy=true;try{await relocatePlayer(labStory.config.arrival,{reason:'story_entry'});}finally{transitionBusy=false;}return;}
                if(action?.dialogue){const sentence=getSentenceForName(action.dialogue,progress);pendingDialogue=createDialogueAuthorization({name:sentence[1],map:currentmap,x:action.target.x,y:action.target.y});socket.emit('dialogue',sentence);return;}
            }
            if (['route2_maison','professor_lab'].includes(currentmap)) {
                if (transitionBusy || pendingDialogue || socketToChatSession.has(socket.id)) return;
                if (await require('./handlers/roomObstacleHandlers').clearNearbyRoomObstacle({
                    socket, userId, player, getPlayer: () => players[socket.id], emitProgression: emitPlayerProgression
                })) return;
            }

            if (isNearComputer(player)) { await computerHandlers.open(); return; }
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
                const pnj = storyGates.actorAtTile(currentmap,pos.x,pos.y,progress) || getPnjAtTile(currentmap, pos.x, pos.y);
                if (pnj) {
                    interactionDetected = true;
                    const name = pnj.interactionName || pnj.name;
                    if(name===raphTrial.config.champion && raphTrialState
                        && (progress.flags?.raphael_defeated!=='true'||arenaTests.canReplay(socket.data.user,name,progress))) {
                        if(pendingDialogue || transitionBusy)return;
                        const result=await raphTrialRepository.advance(userId,player);
                        for(const session of replaySessions.values())if(session.userId===userId)session.syncRaphTrial?.(result.state,result.transition);
                        if(!result.state)return;
                        if(!result.state.revealed) {
                            if(result.changed){const i=(result.state.step+raphTrial.config.messages.length-1)%raphTrial.config.messages.length;
                                socket.emit('progressionNotice',{message:raphTrial.config.messages[i],messageEn:raphTrial.config.messagesEn[i]});}
                            return;
                        }
                        if(!raphTrial.atDais(player))return;
                        transitionBusy=true;
                        try {
                            const wait=Math.max(0,result.state.availableAt-Date.now());
                            if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
                            if(!socket.connected || players[socket.id]!==player || player.inbattle || player.inventoryBusy
                                || currentmap!==raphTrial.config.map || !raphTrial.atDais(player) || !raphTrial.ready(raphTrialState))return;
                            const tile=getPlayerTilePosition(player);
                            pendingDialogue=createDialogueAuthorization({name,map:currentmap,x:tile.x,y:tile.y});
                            await finishDialogue(name);
                        } finally { transitionBusy=false; }
                        return;
                    }
                    const sentence = getSentenceForName(name, progress, {replayArena:arenaTests.canReplay(socket.data.user,name,progress)});
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
                await fishing.offer(player);
            }
        }));

        account.on('playerAction', async (action) => {
            if (getDirectionFromAction(action) && players[socket.id]) fishing.cancel(players[socket.id]);
            if (!canMove || interactionBusy || transitionBusy || pendingDialogue?.arenaEntry || pendingDialogue?.lucieDeparture) return;
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

            const stair=stairways.departure(player,direction);
            if(stair){
                const fromMap=currentmap;
                canMove=false;transitionBusy=true;player.isMoving=false;
                try {
                    await relocatePlayer({map:stair.nextMap,x:stair.nextX,y:stair.nextY},{reason:'map_transition',saveCheckpoint:true});
                    stairways.arrived(player,fromMap);
                } finally {transitionBusy=false;setTimeout(()=>{canMove=true;},MOVE_DELAY);}
                return;
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

            const nextStepMap = changemap2D[matrixY]?.[matrixX] ? getNextMap(currentmap, matrixX, matrixY)?.nextMap : null;
            const gateCandidates = storyGates.candidatesForStep(currentmap, direction, matrixX, matrixY, nextStepMap);
            if (gateCandidates.length) {
                player.isMoving = false;
                if (Date.now() - lastGateAttempt < 350) return;
                lastGateAttempt = Date.now();
                const origin = { map: player.currentmap, x: player.x, y: player.y };
                transitionBusy = true;
                try {
                    const progress = await loadProgressState(userId);
                    if (players[socket.id] !== player || !socket.connected || player.inbattle || player.inventoryBusy || interactionBusy
                        || player.currentmap !== origin.map || player.x !== origin.x || player.y !== origin.y) return;
                    personalProgress = progress;
                    socket.emit('storyGatesState', { gates: storyGates.snapshot(progress) });
                    const gate = gateCandidates.find(g => storyGates.isLocked(g, progress));
                    if (gate) {
                        if (Date.now() - lastGateNotice >= 1200) {
                            lastGateNotice = Date.now();
                            socket.emit('storyGateBlocked', { id: gate.id, map: gate.map, message: gate.message, messageEn: gate.messageEn });
                        }
                        return;
                    }
                    lastGateAttempt = 0;
                    player.isMoving = true;
                } catch (error) {
                    console.error('Vérification passage narratif :', error.message);
                    socket.emit('progressionNotice', { message: 'Impossible de vérifier ce passage. Réessaie dans un instant.' });
                    return;
                } finally { transitionBusy = false; }
            }

            if (arenaCollapse?.blocked(matrixX,matrixY)) {
                player.isMoving=false;
                if(Date.now()-lastGateNotice>=1200){lastGateNotice=Date.now();socket.emit('progressionNotice',{message:'Le sol s’est effondré ici. Passe par le centre de la salle.'});}
                return;
            }

            let repelProtection = null;
            const previousPosition = { x: player.x, y: player.y };
            const blockedByPnj = personalTileBlocked(currentmap, matrixX, matrixY);
            if (collisionData2D[matrixY] && collisionData2D[matrixY][matrixX] === 0 && !blockedByPnj) {
                player.x = newPlayerX;
                player.y = newPlayerY;
                stairways.moved(player,previousPosition);
                repelProtection = stepRepel(player);
                if (repelProtection) {
                    socket.emit('fieldEffectState', {repelSteps:player.repelSteps});
                    if (repelProtection.expired) socket.emit('progressionNotice', {message:'L’effet du Repousse est terminé.'});
                }

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
                if (Math.random() < WILD_ENCOUNTER_CHANCE) {
                    player.inbattle = true;
                    const encounterMap = player.currentmap;
                    const encounterActive = () => account.active() && players[socket.id] === player && player.currentmap === encounterMap;

                    async function utiliserCreatePokemon() {
                        try {
                            const pokemonsauvage = await CreatePokemon(encounterMap);
                            if (!pokemonsauvage) {
                                return null;
                            }
                            return pokemonsauvage;
                        } catch (erreur) {
                            console.error(erreur);
                            return null;
                        }
                    }

                    account.track(utiliserCreatePokemon()
                        .then(async (pokemonsauvage) => {
                            if (!encounterActive() || !pokemonsauvage || repelsWild(repelProtection, pokemonsauvage)) {
                                if (players[socket.id]) {
                                    players[socket.id].inbattle = false;
                                }
                                return;
                            }
                            const wild = await applyEncounterGuarantee(userId, encounterMap, pokemonsauvage);
                            if (!encounterActive()) { player.inbattle = false; return; }
                            socket.emit('battletrigger', { message: 'Un Pokémon sauvage apparaît !', battleType: 'wild', field: { weather: battleWeatherForMap(player.currentmap) } });
                            return startBattle(player, wild, io, userId, equipe)
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
                        }));
                }
            }

            if (changemap2D[matrixY] && changemap2D[matrixY][matrixX] != 0) {
                const nextMapData = getNextMap(currentmap, matrixX, matrixY);
                if(nextMapData?.staircase && nextMapData.triggerOnExit)return;
                if (nextMapData?.requiresStoryFlag) {
                    transitionBusy = true;
                    try {
                        const state = await loadProgressState(userId);
                        if (!players[socket.id] || player.currentmap !== currentmap) return;
                        const message = require('../game/world/storyProgression').transitionBlock(nextMapData, state.flags);
                        if (message) { socket.emit('progressionNotice', { message }); return; }
                    } finally { transitionBusy = false; }
                }
                if (nextMapData?.blockedMessage) {
                    socket.emit('progressionNotice', { message: nextMapData.blockedMessage });
                    return;
                }
                if (nextMapData) {
                    let destination = { map: nextMapData.nextMap, x: nextMapData.nextX, y: nextMapData.nextY };
                    if (currentmap === 'centre') {
                        destination = getPokemonCenterExit(player.centerReturnPoint);
                    } else if (destination.map === 'centre') {
                        player.centerReturnPoint = getPokemonCenterEntryReturn(currentmap, matrixX, matrixY, previousPosition);
                    }
                    transitionBusy = true;
                    try {
                        const voidReturn = currentmap === voidEnding.config.map && destination.map === voidEnding.config.exit.map;
                        if (voidReturn) {
                            // Wait for the local departure cover, bounded for old or disconnected clients.
                            player.isMoving = false;
                            await new Promise(resolve => socket.timeout(1800).emit('voidExit', { map: voidEnding.config.exit.map }, () => resolve()));
                            if (!account.active() || players[socket.id] !== player) return;
                            destination = voidEnding.config.exit;
                        }
                        await relocatePlayer(destination, { reason: voidReturn ? 'void_return' : 'map_transition', saveCheckpoint: true });
                        if (voidReturn) await flushPositionSave();
                    } finally {
                        transitionBusy = false;
                    }
                }
            }
        });


    }));
};

module.exports = socketHandler;

