const { authenticateSocket } = require('../http/authMiddleware');
const { createLobbyStore, LobbyError, CAPACITIES, DURATIONS } = require('../game/drift/lobbyStore');
const { createRunManager } = require('../game/drift/runManager');
const { createSocketRateLimit } = require('./socketRateLimit');
const economy = require('../game/drift/economy');
const { isShopMap } = require('../game/world/shopCatalog');
const checkpointCodec = require('../game/drift/checkpointCodec');
const catalogue = require('../../data/game/drifts.json');

// Separate namespace: never loads or writes Adventure teams, inventory or positions.
function registerDriftLobbies(io, { store = createLobbyStore(), sweepMs = 5000, runtimeOptions = {}, accountRepository = null, colosseumRepository = null, checkpointRepository = null, initialCheckpoint = null } = {}) {
    const namespace = io.of('/drift');
    namespace.use(authenticateSocket);
    const runtime = createRunManager({ ...runtimeOptions, store, namespace, accountRepository, colosseumRepository });
    if (initialCheckpoint) {
        const saved=checkpointCodec.decode(initialCheckpoint);
        store.restoreLobbies(saved.lobbies); runtime.restore(saved.runs,saved.savedAt);
    }
    const limitSocket = createSocketRateLimit();
    let writing=Promise.resolve(), checkpointError=null, stopped=false;
    const checkpoint = () => {
        if (!checkpointRepository) return Promise.resolve();
        const payload=checkpointCodec.encode({savedAt:Date.now(),lobbies:store.exportLobbies(),runs:runtime.runs});
        const task=writing.catch(()=>{}).then(()=>checkpointRepository.save(payload));
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
    namespace.on('connection', socket => {
        limitSocket(socket);
        const user = socket.data.user;
        store.connect(user, socket.id);
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
            'colosseum:start': () => runtime.startColosseum(user)
        })) {
            socket.on(event, async (payload, acknowledge) => {
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
        const gameCommand = (name, handler, mutable = true) => socket.on(name, async (payload, acknowledge) => {
            if (typeof payload === 'function') { acknowledge = payload; payload = undefined; }
            const reply = typeof acknowledge === 'function' ? acknowledge : () => {};
            try {
                if(stopped || checkpointError)throw new LobbyError('storage_unavailable','Sauvegarde temporairement indisponible. Réessaie dans un instant.');
                const p = runtime.guard(user, socket, mutable);
                const result = handler(p, payload);
                if(name!=='playerAction' && name!=='drift:refresh' && !name.includes('Spectat') && name!=='drift:spectate') await checkpoint();
                runtime.send(p);
                reply(result || { success: true });
            } catch (error) {
                const message = error instanceof LobbyError ? error.message : 'Action Drift indisponible.';
                if (!(error instanceof LobbyError)) console.error('Erreur Drift:', error);
                reply({ success: false, message });
                socket.emit('progressionNotice', { message });
            }
        });
        socket.on('drift:enter', (payload, acknowledge) => {
            try { if(stopped)throw new LobbyError('restarting','Le serveur redémarre.'); const state = runtime.enter(user, socket); if (typeof acknowledge === 'function') acknowledge({ success: true, state }); }
            catch (error) { if (typeof acknowledge === 'function') acknowledge({ success: false, message: error.message }); }
        });
        gameCommand('drift:refresh', () => ({ success: true }), false);
        gameCommand('drift:spectate', (p, data) => runtime.spectate(p, data?.matchId), false);
        gameCommand('drift:stopSpectating', p => runtime.stopSpectating(p), false);
        gameCommand('playerAction', (p, action) => runtime.move(p, action));
        gameCommand('Space', p => runtime.interact(p));
        gameCommand('onEndDialogue', (p, name) => runtime.endDialogue(p, name));
        gameCommand('actionResponse', (p, action) => {
            if (!p.battle?.action(p, action)) { p.battle?.resume(p); throw new LobbyError('invalid_action', 'Choisis une action disponible.'); }
        }, false);
        gameCommand('drift:equip', (p, data) => economy.equip(p, data?.uuid, data?.enabled));
        gameCommand('drift:discard', (p, data) => economy.remove(p, data?.uuid));
        gameCommand('drift:sell', (p, data) => economy.remove(p, data?.uuid, true));
        gameCommand('drift:heal', (p, data) => economy.usePotion(p, data?.itemKey, data?.pokemonUuid));
        gameCommand('drift:roundReady', p => runtime.ready(p));
        gameCommand('drift:exit', p => { runtime.abandon(p); store.leave(user); }, false);
        gameCommand('drift:abandon', p => runtime.abandon(p), false);
        gameCommand('drift:reorder', (p, data) => {
            economy.requireMutable(p);
            const ids = data?.orderedUuids;
            if (!Array.isArray(ids) || ids.length !== p.equipe.pokemons.length || new Set(ids).size !== ids.length || ids.some(id => !p.equipe.pokemons.some(poke => poke.uuid === id))) economy.fail('Ordre invalide.');
            p.equipe.pokemons = ids.map(id => p.equipe.pokemons.find(poke => poke.uuid === id)); p.ready = false;
        });
        gameCommand('requestShop', p => {
            if (!isShopMap(p.currentmap) || p.run.phase !== 'exploration') economy.fail('Rejoins une boutique.');
            const state = economy.shop(p); socket.emit('shopOpened', state); return state;
        });
        gameCommand('buyShopItem', (p, data) => economy.buy(p, data?.itemKey, data?.quantity));
        gameCommand('equipHeldItem', (p, data) => {
            const poke = p.equipe.pokemons.find(poke => poke.uuid === data?.pokemonUuid);
            const key = data?.itemKey || null;
            if (!poke || (key && !economy.bag(p).some(item => item.key === key && item.category === 'held'))) economy.fail('Objet indisponible.');
            if (poke.heldItem) p.items[poke.heldItem] = (p.items[poke.heldItem] || 0) + 1;
            if (key) p.items[key]--;
            poke.heldItem = key; p.ready = false;
            return { success: true, heldItem: key, items: economy.bag(p) };
        });
        socket.on('disconnect', () => { runtime.disconnect(user, socket); store.disconnect(user, socket.id); publish(); });
    });
    const cleanup = () => { stopped=true; clearInterval(timer); clearInterval(runtimeTimer); clearInterval(checkpointTimer); };
    cleanup.checkpoint=checkpoint;
    cleanup.runtime = runtime;
    return cleanup;
}

module.exports = { registerDriftLobbies };
