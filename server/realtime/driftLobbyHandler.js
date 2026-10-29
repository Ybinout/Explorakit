const { exclusiveAccountConnection } = require('./accountConnection');
const { authenticateSocket } = require('../http/authMiddleware');
const { createLobbyStore, LobbyError, CAPACITIES, DURATIONS } = require('../game/drift/lobbyStore');
const { createRunManager } = require('../game/drift/runManager');
const { createSocketRateLimit } = require('./socketRateLimit');
const economy = require('../game/drift/economy');
const { isShopMap } = require('../game/world/shopCatalog');
const checkpointCodec = require('../game/drift/checkpointCodec');
const catalogue = require('../../data/game/drifts.json');
const { resolveMoveChoice } = require('../game/models/moveLearning');
const { loadUserSprite, saveUserSprite, sanitizeSpriteName, loadUserSpritePalette, saveUserSpritePalette } = require('../persistence/playerRepository');

// Separate namespace: never loads or writes Adventure teams, inventory or positions.
function registerDriftLobbies(io, { store = createLobbyStore(), sweepMs = 5000, runtimeOptions = {}, accountRepository = null, colosseumRepository = null, checkpointRepository = null, initialCheckpoint = null, appearanceRepository = { loadUserSprite, saveUserSprite, loadUserSpritePalette, saveUserSpritePalette } } = {}) {
    const namespace = io.of('/drift');
    namespace.use(authenticateSocket);
    const runtime = createRunManager({ ...runtimeOptions, store, namespace, accountRepository, colosseumRepository });
    if (initialCheckpoint) {
        const saved=checkpointCodec.decode(initialCheckpoint);
        store.restoreLobbies(saved.lobbies); runtime.restore(saved.runs,saved.savedAt);
    }
    const limitSocket = createSocketRateLimit();
    let writing=Promise.resolve(), checkpointError=null, stopped=false, lastCheckpointEmpty=false;
    const checkpoint = () => {
        if (!checkpointRepository) return Promise.resolve();
        const task=writing.catch(()=>{}).then(async()=>{
            const lobbies=store.exportLobbies(), empty=!lobbies.length && !runtime.runs.size;
            // Persist the empty state once (including removal of the last run).
            // Subsequent idle ticks must not rewrite the same SQL row each second.
            if(empty && lastCheckpointEmpty && !checkpointError)return;
            const payload=await checkpointCodec.encodeAsync({savedAt:Date.now(),lobbies,runs:runtime.runs});
            await checkpointRepository.save(payload);
            lastCheckpointEmpty=empty;
        });
        writing=task.then(()=>{
            checkpointError=null; runtime.setStorageAvailable(true);
        },error=>{
            checkpointError=error; runtime.setStorageAvailable(false);
            for (const run of runtime.runs.values()) runtime.publish(run);
            throw error;
        });
        return writing;
    };
    let checkpointBusy=false;
    const checkpointTimer=setInterval(()=>{
        if(checkpointBusy || !checkpointRepository)return;
        checkpointBusy=true; checkpoint().catch(e=>console.error('Sauvegarde RiftMon:',e.message)).finally(()=>{checkpointBusy=false;});
    },1000);
    checkpointTimer.unref();
    const publish = () => {
        for (const socket of namespace.sockets.values()) {
            socket.emit('drift:lobby', store.snapshot(socket.data.user));
            socket.emit('drift:lobbies', store.listOpen(socket.data.user));
        }
    };
    const timer = setInterval(() => { store.sweep(); publish(); }, sweepMs);
    const runtimeTimer = setInterval(() => runtime.tick(), 250);
    runtimeTimer.unref();
    timer.unref();
    namespace.on('connection', exclusiveAccountConnection(async (socket, account) => {
        limitSocket(socket);
        require('./worldClock').registerWorldClock(socket);
        const user = socket.data.user;
        store.connect(user, socket.id);
        await require('./handlers/socialHandlers').registerSocialHandlers({io,socket,getLocation:()=>{const p=runtime.playerFor(user);return p?{map:p.currentmap,centerReturnPoint:p.centerReturnPoint,mode:p.run.mode}:null;}});

        socket.emit('drift:bootstrap', { capacities: CAPACITIES, durations: DURATIONS, catalogue, launchAvailable: true });
        publish();
        let windowStart = Date.now(), requests = 0;
        for (const [event, operation] of Object.entries({
            'drift:list': () => store.listOpen(user),
            'drift:create': payload => store.create(user, payload),
            'drift:join': payload => store.join(user, payload?.code),
            'drift:configure': payload => store.configure(user, payload),
            'drift:ready': payload => store.ready(user, payload?.ready),
            'drift:leave': () => { runtime.abandon(runtime.playerFor(user)); return store.leave(user); },
            'drift:start': () => runtime.start(user),
            'colosseum:start': payload => runtime.startColosseum(user, payload)
        })) {
            account.on(event, async (payload, acknowledge) => {
                const reply = typeof acknowledge === 'function' ? acknowledge : () => {};
                if (Date.now() - windowStart >= 10000) { windowStart = Date.now(); requests = 0; }
                if (++requests > 30) { reply({ ok: false, code: 'rate_limit', message: 'Un instant entre chaque action, dresseur.' }); return; }
                try {
                    store.sweep();
                    if(stopped || checkpointError)throw new LobbyError('storage_unavailable','Sauvegarde temporairement indisponible. Réessaie dans un instant.');
                    const lobby = await operation(payload);
                    await checkpoint();
                    publish();
                    reply(event === 'drift:list' ? { ok: true, lobbies: lobby } : { ok: true, lobby });
                } catch (error) {
                    if (!(error instanceof LobbyError)) console.error('Erreur salon Drift:', error.message);
                    reply({ ok: false, code: error instanceof LobbyError ? error.code : 'internal_error',
                        message: error instanceof LobbyError ? error.message : 'Le salon est temporairement indisponible.' });
                }
            });
        }
        const gameCommand = (name, handler, mutable = true) => account.on(name, async (payload, acknowledge) => {
            if (typeof payload === 'function') { acknowledge = payload; payload = undefined; }
            const reply = typeof acknowledge === 'function' ? acknowledge : () => {};
            try {
                if(stopped || checkpointError)throw new LobbyError('storage_unavailable','Sauvegarde temporairement indisponible. Réessaie dans un instant.');
                const p = runtime.guard(user, socket, mutable);
                const before={map:p.currentmap,phase:p.run.phase,inbattle:p.inbattle,alive:p.alive};
                const result = await handler(p, payload);
                if(name!=='getPokemonEvolutions' && name!=='playerAction' && name!=='drift:refresh' && !name.includes('Spectat') && name!=='drift:spectate') await checkpoint();
                if(name==='playerAction' && socket.data.riftMovementPatches && before.map===p.currentmap
                    && before.phase===p.run.phase && before.inbattle===p.inbattle && before.alive===p.alive)
                    socket.emit('drift:movementState',runtime.movementState(p));
                else runtime.send(p);
                reply(result || { success: true });
            } catch (error) {
                const message = error instanceof LobbyError ? error.message : 'Action Drift indisponible.';
                if (!(error instanceof LobbyError)) console.error('Erreur Drift:', error);
                reply({ success: false, message, ...(error.ivConfirmationRequired?{ivConfirmationRequired:error.ivConfirmationRequired}:{}) });
                if(!error.ivConfirmationRequired)socket.emit('progressionNotice', { message });
            }
        });
        account.on('drift:enter', async (payload, acknowledge) => {
            try { if(stopped)throw new LobbyError('restarting','Le serveur redémarre.'); socket.data.riftMovementPatches=payload?.movementPatches===1; const [sprite,palette] = await Promise.all([appearanceRepository.loadUserSprite(user.id),appearanceRepository.loadUserSpritePalette?.(user.id)]); if(stopped || !socket.connected) return; const state = runtime.enter(user, socket, sprite, palette); if (typeof acknowledge === 'function') acknowledge({ success: true, state }); }
            catch (error) { if (typeof acknowledge === 'function') acknowledge({ success: false, message: error.message }); }
        });
        gameCommand('drift:refresh', () => ({ success: true }), false);
        gameCommand('recoverPosition', p=>runtime.recoverPosition(p));
        gameCommand('drift:save', () => ({ success: true }), false);

        require('./handlers/trainerPaletteHandlers').registerTrainerPaletteHandlers({socket,userId:user.id,save:appearanceRepository.saveUserSpritePalette,getPlayer:()=>{const p=runtime.playerFor(user);return p?.socketId===socket.id?p:null;},broadcast:(p,palette)=>{
            for(const member of p.run.players.values())if(member.socketId)namespace.to(member.socketId).emit('playerPaletteUpdated',{id:p.socketId,palette});
        }});
        let appearanceBusy = false;
        account.on('setSprite', async (data = {}, acknowledge = () => {}) => {
            const reply = typeof acknowledge === 'function' ? acknowledge : () => {};
            if (appearanceBusy) return reply({ success: false, message: 'Changement en cours.' });
            appearanceBusy = true;
            try {
                if (stopped || checkpointError) throw new Error('Sauvegarde temporairement indisponible.');
                const p = runtime.guard(user, socket, false);
                if (p.inbattle) throw new Error('Attends la fin du combat pour changer de tenue.');
                const sprite = sanitizeSpriteName(data.sprite);
                await appearanceRepository.saveUserSprite(user.id, sprite);
                runtime.guard(user, socket, false);
                p.sprite = sprite;
                await checkpoint();
                for (const member of p.run.players.values()) if (member.socketId) namespace.to(member.socketId).emit('playerAppearanceUpdated', { id: p.socketId, sprite });
                reply({ success: true, sprite });
            } catch (error) { reply({ success: false, message: error.message || 'Apparence indisponible.' }); }
            finally { appearanceBusy = false; }
        });
        gameCommand('drift:spectate', (p, data) => runtime.spectate(p, data?.matchId), false);
        gameCommand('drift:stopSpectating', p => runtime.stopSpectating(p), false);
        gameCommand('playerAction', (p, action) => runtime.move(p, action));
        gameCommand('Space', p => runtime.interact(p));
        gameCommand('fishing:start', (p,data) => ({success:runtime.fishing.start(p,data?.id)}));
        gameCommand('fishing:reel', (p,data) => ({success:runtime.fishing.reel(p,data?.id)}));
        gameCommand('fishing:cancel', p => ({success:runtime.fishing.cancel(p)}), false);
        gameCommand('onEndDialogue', (p, name) => runtime.endDialogue(p, name));
        gameCommand('actionResponse', (p, action) => {
            if (!p.battle?.action(p, action)) { p.battle?.resume(p); throw new LobbyError('invalid_action', 'Choisis une action disponible.'); }
        }, false);
        gameCommand('drift:equip', (p, data) => economy.equip(p, data?.uuid, data?.enabled));
        gameCommand('drift:replace', (p, data) => economy.replace(p, data?.uuid, data?.replaceUuid));
        gameCommand('drift:contractClaim', (p,data)=>require('../game/drift/contracts').claim(p,data));
        gameCommand('drift:discard', (p, data) => economy.remove(p, data?.uuid));
        gameCommand('drift:sell', (p, data) => economy.remove(p, data?.uuid, true));
        gameCommand('drift:merchantBuy', (p,data)=>require('../game/drift/merchant').buy(p,data?.offerId));
        gameCommand('drift:exchange', (p,data)=>require('../game/drift/merchant').exchange(p,data?.uuids));
        gameCommand('drift:evolve', (p,data)=>economy.evolve(p,data?.itemKey,data?.pokemonUuid));
        gameCommand('drift:chooseStarter', (p,data)=>runtime.chooseStarter(p,data?.pokemonUuid), false);
        gameCommand('getPokemonEvolutions', (p, data) => {
            const pokemon = p.equipe.pokemons.find(poke => poke.uuid === data?.pokemonUuid);
            if (!pokemon) economy.fail('Ce Pokémon ne t’appartient pas.');
            return { success: true, options: require('../game/models/evolution').options(pokemon) };
        }, false);
        gameCommand('evolvePokemon', (p, data) => {
            if (!['exploration','preparation','tournament','colosseum_ready'].includes(p.run.phase)) economy.fail('Évolution indisponible maintenant.');
            const pokemon = p.equipe.pokemons.find(poke => poke.uuid === data?.pokemonUuid);
            let result;
            try { result = (data?.promptId ? require('../game/models/evolution').resolvePending(pokemon, data) : require('../game/models/evolution').evolve(pokemon, data)); }
            catch (error) { economy.fail(error.message); }
            p.ready = false;
            require('../game/drift/runReport').syncTeam(p);
            return { success: true, equipe: p.equipe, evolution: result };
        });
        gameCommand('pc:open',p=>{const state=require('../game/drift/pokemonComputer').open(p);socket.emit('pcOpened',state);return {success:true,state};},false);
        gameCommand('pc:action',(p,data)=>require('../game/drift/pokemonComputer').mutate(p,data));
        gameCommand('drift:repel', (p, data) => economy.useRepel(p, data?.itemKey));
        gameCommand('drift:heal', (p, data) => economy.usePotion(p, data?.itemKey, data?.pokemonUuid,undefined,data?.quantity??1,data?.ivConfirmation));
        gameCommand('drift:useMachine', (p,data) => economy.useMachine(p,data));
        gameCommand('drift:learnMove', (p, data) => {
            const pokemon = p.equipe.pokemons.find(poke => poke.uuid === data?.pokemonUuid);
            try { Object.assign(pokemon, resolveMoveChoice(pokemon, data)); }
            catch (error) { economy.fail(error.message); }
            p.ready = false;
        });
        gameCommand('drift:roundReady', p => runtime.ready(p));
        gameCommand('colosseum:reward', (p, data) => require('../game/drift/colosseum').chooseReward(p, data));
        gameCommand('drift:exit', p => { runtime.abandon(p); store.leave(user); }, false);
        gameCommand('drift:abandon', p => runtime.abandon(p), false);
        gameCommand('drift:reorder', (p, data) => {
            economy.requireMutable(p);
            const ids = data?.orderedUuids;
            if (!Array.isArray(ids) || ids.length !== p.equipe.pokemons.length || new Set(ids).size !== ids.length || ids.some(id => !p.equipe.pokemons.some(poke => poke.uuid === id))) economy.fail('Ordre invalide.');
            p.equipe.pokemons = ids.map(id => p.equipe.pokemons.find(poke => poke.uuid === id)); p.ready = false;
            require('../game/drift/runReport').syncTeam(p);
        });
        gameCommand('requestShop', p => {
            if (!isShopMap(p.currentmap) || p.run.phase !== 'exploration') economy.fail('Rejoins une boutique.');
            const state = economy.shop(p); socket.emit('shopOpened', state); return state;
        });
        gameCommand('buyShopItem', (p, data) => economy.buy(p, data?.itemKey, data?.quantity));
        gameCommand('sellShopItem', (p, data) => economy.sell(p, data?.itemKey, data?.quantity));
        gameCommand('equipHeldItem', (p, data) => {
            economy.requireMutable(p);
            const poke = p.equipe.pokemons.find(poke => poke.uuid === data?.pokemonUuid);
            const key = data?.itemKey || null;
            if (!poke || (key && !economy.bag(p).some(item => item.key === key && item.category === 'held'))) economy.fail('Objet indisponible.');
            if (poke.heldItem) p.items[poke.heldItem] = (p.items[poke.heldItem] || 0) + 1;
            if (key) p.items[key]--;
            poke.heldItem = key; p.ready = false;
            return { success: true, heldItem: key, items: economy.bag(p) };
        });
        require('./handlers/tradeHandlers').registerTradeHandlers({io,socket,mode:'expedition',getPlayer:()=>runtime.playerFor(user),available:()=>false,apply:()=>{},reload:async()=>{},synchronize:async()=>{}});
        account.onClose(() => { runtime.disconnect(user, socket); store.disconnect(user, socket.id); publish(); });
    }));
    const cleanup = () => { runtime.fishing.stop(); stopped=true; clearInterval(timer); clearInterval(runtimeTimer); clearInterval(checkpointTimer); };
    cleanup.checkpoint=checkpoint;
    cleanup.runtime = runtime;
    return cleanup;
}

module.exports = { registerDriftLobbies };
