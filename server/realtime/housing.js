const { randomUUID } = require('node:crypto'),
    rules = require('../game/housing/rules'),
    entryCatalog = require('../game/housing/entries'),
    repository = require('../persistence/housingRepository');
const managers = new WeakMap();
function createHousingManager({
    store = repository,
    now = Date.now,
    tickMs = 5000,
} = {}) {
    const contexts = new Map(),
        rooms = new Map(),
        members = new Map(),
        invitations = new Map();
    const fail = (m) => {
        throw Error(m);
    };
    const ctx = (id) => contexts.get(id);
    function assertAvailable(c) {
        const p = c?.getPlayer();
        if (
            !c?.supported ||
            !c.socket.connected ||
            !p ||
            p.inbattle ||
            (p.inventoryBusy && !c.inOperation) ||
            p.superTournamentActive ||
            !(c.interacting ? (c.canInteract || c.canUse)() : c.canUse())
        )
            fail('Termine ton action avant de t’occuper de la maison.');
        require('../game/social/tradeLocks').assertUnlocked(c.id);
        return p;
    }
    function current(c) {
        return c?.session ? rooms.get(c.session.visit.ownerId) : null;
    }
    function publish(c) {
        const h = current(c);
        if (!h) {
            c.socket.emit('housing:state', null);
            return;
        }
        c.socket.emit('housing:state', {
            ownerId: h.ownerId,
            ownerName: h.ownerName,
            entryKey: h.entryKey,
            entry: entryCatalog.get(h.entryKey),
            revision: h.revision,
            floors: h.floors,
            crops: h.crops || [],
            serverNow: now(),
            floor: c.session.visit.floor,
            isOwner: h.ownerId === c.id,
            ...(h.ownerId === c.id ? { inventory: h.inventory } : {}),
        });
    }
    function drop(c) {
        if (!c.session) return;
        const owner = c.session.visit.ownerId;
        members.get(owner)?.delete(c.id);
        if (!members.get(owner)?.size) {
            members.delete(owner);
            rooms.delete(owner);
        }
        c.session = null;
    }
    function put(home) {
        if (!members.get(home.ownerId)?.size) return;
        const before = rooms.get(home.ownerId);
        if (!before || before.revision <= home.revision)
            rooms.set(home.ownerId, home);
    }
    function install(c, session) {
        drop(c);
        c.session = { visit: session.visit };
        const owner = session.visit.ownerId;
        if (!members.has(owner)) members.set(owner, new Set());
        members.get(owner).add(c.id);
        put(session.home);
        const p = c.getPlayer();
        p.housingOwnerId = owner;
        p.housingFloor = session.visit.floor;
        p.housingEntryMap = entryCatalog.get(session.home.entryKey).map;
        publish(c);
    }
    async function refresh(home) {
        put(home);
        for (const id of members.get(home.ownerId) || []) {
            const c = ctx(id);
            if (c) publish(c);
        }
    }
    async function own(c) {
        return store.read(c.id);
    }
    async function enter(c, ownerId, returnPoint) {
        assertAvailable(c);
        const session = await store.enter(c.id, ownerId, 0, returnPoint);
        install(c, session);
        await c.travel(session.position);
        publish(c);
        return state(c.id);
    }
    async function owned(c) {
        if (
            !c.session ||
            c.session.visit.ownerId !== c.id ||
            !rules.isMap(c.getPlayer()?.currentmap)
        )
            fail('Seul le propriétaire peut modifier cette maison.');
        return current(c);
    }
    const state = (id) => {
        const c = ctx(id),
            h = current(c);
        return h
            ? {
                  ownerId: h.ownerId,
                  revision: h.revision,
                  floor: c.session.visit.floor,
              }
            : null;
    };
    const shopMap = (m) => /^tour_(?:rdc|etage[123])$/.test(m || '');
    async function commandCore(id, name, payload = {}) {
        const c = ctx(id),
            p = assertAvailable(c);
        if (['garden','plant','plantMany','plantFavorite','harvest','harvestAll','mutate','favorite'].includes(name)) {
            const h = await owned(c), floor = c.session.visit.floor;
            const target = rules.deviceAt(h,floor,p);
            const kind = rules.items.get(target?.key)?.device;
            if(!['berries','mutator'].includes(kind)||target.id!==payload.furnitureId||floor!==payload.floor)fail('Approche-toi de cet équipement pour l’utiliser.');
            const garden=require('../persistence/berryGardenRepository');
            let result;
            if(name!=='garden'){
                if(['mutate','favorite'].includes(name)?kind!=='mutator':kind!=='berries')fail('Équipement incompatible.');
                result=await garden[name](id,payload);
                await refresh(result.home);
            }
            const panel=await garden.panel(id,result?.home||await own(c),{...payload,kind:kind==='mutator'?'mutator':'garden'});
            c.socket.emit('bagUpdated',{items:panel.items});
            return {...result,...panel};
        }
        if (name === 'open') {
            const h = await owned(c);
            return {
                home: h,
                money: await store.wallet(id),
                kind: 'manage',
                floor: c.session.visit.floor,
            };
        }
        if (name === 'shop') {
            if (!shopMap(p.currentmap))
                fail('Les meubles sont vendus au Grand Comptoir.');
            return {
                home: await own(c),
                money: await store.wallet(id),
                kind: 'shop',
            };
        }
        if (name === 'invite') {
            const h = await owned(c),
                target = ctx(payload.userId);
            if (
                !target?.supported ||
                !target.socket.connected ||
                target.id === id
            )
                fail(
                    'Choisis un ami connecté avec la version actuelle du jeu.'
                );
            if (
                (await require('../persistence/trainerRepository').relationship(
                    id,
                    target.id
                )) !== 'friends'
            )
                fail('Ce dresseur ne fait pas partie de tes amis.');
            if (
                [...invitations.values()].filter(
                    (i) => i.ownerId === id && i.expiresAt > now()
                ).length >= 4
            )
                fail('Quatre invitations peuvent être en attente.');
            const invitation = {
                id: randomUUID(),
                ownerId: id,
                targetId: target.id,
                name: h.ownerName,
                entryName: entryCatalog.get(h.entryKey).name,
                expiresAt: now() + 60000,
            };
            invitations.set(invitation.id, invitation);
            target.socket.emit('housing:invitation', invitation);
            return { message: 'Invitation envoyée pour 60 secondes.' };
        }
        if (name === 'invitation') {
            const inv = invitations.get(payload.id);
            if (!inv || inv.targetId !== id || inv.expiresAt <= now())
                fail('Cette invitation a expiré.');
            if (payload.accept !== true) {
                invitations.delete(inv.id);
                c.socket.emit('housing:invitation', null);
                return {};
            }
            if (require('../game/world/darkContinent').isMap(p.currentmap))
                fail('Reviens d’abord auprès du guide du Dark Continent.');
            const origin = c.session?.visit.returnPoint || {
                map: p.currentmap,
                x: Math.round(p.x),
                y: Math.round(p.y),
            };
            await enter(c, inv.ownerId, origin);
            invitations.delete(inv.id);
            c.socket.emit('housing:invitation', null);
            return {};
        }
        if (name === 'exit') {
            if (!c.session) fail('Tu n’es plus dans une maison.');
            const d = await store.leave(id);
            drop(c);
            delete p.housingOwnerId;
            delete p.housingFloor;
            delete p.housingEntryMap;
            c.socket.emit('housing:state', null);
            await c.travel(d);
            return {};
        }
        if (name === 'purchase') {
            const entry = entryCatalog.near(p);
            if (
                (!entry || entry.key !== payload.entryKey) &&
                !(
                    c.session?.visit.ownerId === id &&
                    current(c)?.entryKey === payload.entryKey
                )
            )
                fail('Approche-toi de la porte de cette maison.');
            const result = await store.purchase(id, payload);
            if (result.home.entryKey !== payload.entryKey)
                fail('Cette confirmation concerne une ancienne adresse.');
            await enter(
                c,
                id,
                entryCatalog.outside(entryCatalog.get(result.home.entryKey))
            );
            await c.refreshFlight?.();
            return { ...result, kind: 'manage', floor: 0 };
        }
        if (name === 'furniture') {
            if (!shopMap(p.currentmap))
                fail('Les meubles sont vendus au Grand Comptoir.');
            const result = await store.furniture(id, payload);
            await refresh(result.home);
            return { ...result, kind: 'shop' };
        }
        if (name === 'sell') {
            const held = [];
            for (const peerId of members.get(id) || []) {
                const peer = ctx(peerId),
                    actor = peer?.getPlayer();
                if (peerId !== id && actor) {
                    if (
                        actor.inbattle ||
                        actor.inventoryBusy ||
                        peer.inOperation
                    )
                        fail(
                            'Attends que tes visiteurs aient terminé leur action.'
                        );
                    actor.inventoryBusy = true;
                    held.push(actor);
                }
            }
            try {
                const result = await store.sell(id, payload);
                if (!result.duplicate) {
                    for (const departure of result.receipt.departures) {
                        const peer = ctx(departure.userId);
                        if (
                            !peer?.socket.connected ||
                            peer.session?.visit.ownerId !== id
                        )
                            continue;
                        const actor = peer.getPlayer();
                        drop(peer);
                        delete actor.housingOwnerId;
                        delete actor.housingFloor;
                        delete actor.housingEntryMap;
                        peer.socket.emit('housing:state', null);
                        await peer.travel(departure.destination);
                    }
                    for (const [key, inv] of invitations)
                        if (inv.ownerId === id) invitations.delete(key);
                }
                await c.refreshFlight?.();
                return {
                    ...result,
                    kind: 'sold',
                    message:
                        'Maison revendue. Tous tes meubles sont conservés.',
                };
            } finally {
                for (const actor of held) actor.inventoryBusy = false;
            }
        }
        if (name === 'save' || name === 'floor') {
            await owned(c);
            if (name === 'save' && payload.floor !== c.session.visit.floor)
                fail('Ouvre l’étage que tu souhaites aménager.');
            const held = [];
            if (name === 'save' && payload.revision === current(c).revision) {
                const h = current(c),
                    layout = rules.validateFloor(
                        h,
                        payload.floor,
                        payload.layout
                    ),
                    candidate = {
                        ...h,
                        floors: h.floors.map((f, i) =>
                            i === payload.floor ? layout : f
                        ),
                    };
                for (const peerId of members.get(id) || []) {
                    const peer = ctx(peerId),
                        p = peer?.getPlayer();
                    if (!p || peer.session.visit.floor !== payload.floor)
                        continue;
                    if (peerId !== id && (p.inbattle || p.inventoryBusy))
                        fail(
                            'Attends que tes visiteurs aient terminé leur action.'
                        );
                    if (
                        rules.blocked(
                            candidate,
                            payload.floor,
                            Math.floor(p.x / 32),
                            Math.floor(p.y / 32)
                        )
                    )
                        fail(
                            'Un dresseur occupe cet emplacement. Laisse-lui une case libre.'
                        );
                    if (peerId !== id) held.push(p);
                }
            }
            for (const p of held) p.inventoryBusy = true;
            try {
                const result = await (name === 'save'
                    ? store.saveFloor(id, payload)
                    : store.addFloor(id, payload));
                await refresh(result.home);
                return {
                    ...result,
                    kind: 'manage',
                    floor: c.session.visit.floor,
                };
            } finally {
                for (const p of held) p.inventoryBusy = false;
            }
        }
        fail('Action de maison inconnue.');
    }
    async function attach(c, session) {
        contexts.set(c.id, c);
        if (session?.home && session.visit?.inside !== false)
            install(c, session);
        else c.socket.emit('housing:state', null);
    }
    async function interactCore(id) {
        const c = ctx(id);
        if (!c?.supported) return false;
        const e = entryCatalog.near(c.getPlayer());
        if (!e) return false;
        assertAvailable(c);
        const h = await own(c);
        if (h.entryKey === e.key) await enter(c, id, entryCatalog.outside(e));
        else
            c.socket.emit('housing:panel', {
                kind: 'purchase',
                entry: e,
                home: h,
                money: await store.wallet(id),
            });
        return true;
    }
    async function stepCore(id) {
        const c = ctx(id),
            p = c?.getPlayer(),
            h = current(c);
        if (!h || !rules.isMap(p?.currentmap)) return false;
        const index = c.session.visit.floor,
            f = h.floors[index],
            x = Math.floor(p.x / 32),
            y = Math.floor(p.y / 32),
            m = rules.model(f.model),
            d = rules.door(m);
        if (index === 0 && y === d.y && (x === d.x || x === d.x - 1)) {
            await commandCore(id, 'exit');
            return true;
        }
        for (const [k, delta] of [
            ['up', 1],
            ['down', -1],
        ]) {
            const stair = f.stairs[k];
            if (!stair || y !== stair.y || x < stair.x || x > stair.x + 1)
                continue;
            const next = h.floors[index + delta],
                landing = next.stairs[k === 'up' ? 'down' : 'up'];
            const position = {
                    x: landing.x * 32 + 16,
                    y: (landing.y + 2) * 32 + 16,
                },
                session = await store.floor(id, index + delta, position);
            install(c, session);
            await c.travel(session.position);
            publish(c);
            return true;
        }
        return false;
    }
    async function leaving(id, destination) {
        const c = ctx(id);
        if (!c?.session || rules.isMap(destination.map)) return;
        await store.leave(id, destination);
        drop(c);
        const p = c.getPlayer();
        if (p) {
            delete p.housingOwnerId;
            delete p.housingFloor;
            delete p.housingEntryMap;
        }
        c.socket.emit('housing:state', null);
    }
    async function operation(id, fn, interacting = false) {
        const c = ctx(id);
        if (c?.inOperation)
            fail('Patiente pendant la sauvegarde de la maison.');
        const p = assertAvailable({ ...c, interacting });
        c.inOperation = true;
        c.interacting = interacting;
        const previous = p.inventoryBusy;
        p.inventoryBusy = true;
        try {
            return await fn();
        } finally {
            p.inventoryBusy = previous;
            c.inOperation = false;
            c.interacting = false;
        }
    }
    const command = (id, name, payload) =>
        operation(id, () => commandCore(id, name, payload));
    const interact = async (id) => {
        const c = ctx(id);
        if (
            c?.supported &&
            rules.deviceAt(current(c), c.session?.visit.floor, c.getPlayer())
        ) {
            assertAvailable({ ...c, interacting: true });
            const device = rules.deviceAt(
                current(c),
                c.session.visit.floor,
                c.getPlayer()
            );
            const kind=rules.items.get(device.key).device;
            if(['berries','mutator'].includes(kind)){
                if(c.session.visit.ownerId!==id){c.socket.emit('progressionNotice',{message:'Seul le propriétaire s’occupe de ses cultures.'});return true;}
                const panel=await operation(id,()=>commandCore(id,'garden',{floor:c.session.visit.floor,furnitureId:device.id}),true);
                c.socket.emit('housing:panel',panel);
            }else await c.useDevice?.(kind);
            return true;
        }
        if (!c?.supported || !entryCatalog.near(c.getPlayer())) return false;
        return operation(id, () => interactCore(id), true);
    };
    const step = async (id) => {
        const c = ctx(id),
            p = c?.getPlayer(),
            h = current(c);
        if (!h || !rules.isMap(p?.currentmap)) return false;
        const index = c.session.visit.floor,
            f = h.floors[index],
            d = rules.door(rules.model(f.model)),
            x = Math.floor(p.x / 32),
            y = Math.floor(p.y / 32);
        const trigger =
            (index === 0 && y === d.y && (x === d.x || x === d.x - 1)) ||
            Object.values(f.stairs).some(
                (s) => s && y === s.y && x >= s.x && x <= s.x + 1
            );
        if (!trigger) return false;
        return operation(id, () => stepCore(id));
    };
    function detach(c) {
        if (ctx(c.id) !== c) return;
        drop(c);
        contexts.delete(c.id);
    }
    const timer = tickMs
        ? setInterval(() => {
              for (const [id, i] of invitations)
                  if (i.expiresAt <= now()) invitations.delete(id);
          }, tickMs)
        : null;
    timer?.unref();
    return {
        attach,
        detach,
        command,
        interact,
        step,
        leaving,
        state,
        blocked(id, map, x, y) {
            const c = ctx(id);
            return (
                rules.isMap(map) &&
                rules.blocked(current(c), c?.session?.visit.floor, x, y)
            );
        },
        room(id) {
            return current(ctx(id));
        },
        device(id, kind) {
            const c = ctx(id);
            return rules.deviceAt(
                current(c),
                c?.session?.visit.floor,
                c?.getPlayer(),
                kind
            );
        },
        contexts,
        cacheStats: () => ({
            occupiedHouses: rooms.size,
            visitors: [...members.values()].reduce((n, ids) => n + ids.size, 0),
            onlineContexts: contexts.size,
            invitations: invitations.size,
        }),
        stop() {
            if (timer) clearInterval(timer);
            rooms.clear();
            members.clear();
            contexts.clear();
            invitations.clear();
        },
    };
}
function getHousingManager(io) {
    const key = io.server || io;
    if (!managers.has(key)) {
        const m = createHousingManager();
        managers.set(key, m);
        key.httpServer?.once('close', () => m.stop());
    }
    return managers.get(key);
}
function registerHousingHandlers({
    manager,
    socket,
    account,
    userId,
    getPlayer,
    canUse,
    canInteract,
    travel,
    session,
    useDevice,
    refreshFlight,
}) {
    const c = {
        id: userId,
        socket,
        getPlayer,
        canUse,
        canInteract,
        travel,
        useDevice,
        refreshFlight,
        supported: socket.handshake?.auth?.housing === 1,
    };
    let windowAt = 0,
        count = 0;
    for (const name of [
        'open',
        'garden', 'plant', 'plantMany', 'plantFavorite', 'harvest', 'harvestAll', 'mutate', 'favorite',
        'purchase',
        'shop',
        'furniture',
        'save',
        'floor',
        'invite',
        'invitation',
        'exit',
        'sell',
    ])
        account.on('housing:' + name, async (payload, ack) => {
            const reply = typeof ack === 'function' ? ack : () => {};
            try {
                if (Date.now() - windowAt > 1000) {
                    windowAt = Date.now();
                    count = 0;
                }
                if (++count > 8) throw Error('Patiente un instant.');
                if (
                    !payload ||
                    typeof payload !== 'object' ||
                    Array.isArray(payload)
                )
                    throw Error('Confirmation invalide.');
                const result = await manager.command(userId, name, payload);
                reply({ success: true, ...result });
            } catch (error) {
                if (error.code) console.error('Housing:', error.code);
                reply({
                    success: false,
                    retryable: Boolean(error.code),
                    message: error.code
                        ? 'La sauvegarde est momentanément indisponible. Réessaie la même confirmation.'
                        : error.message,
                });
            }
        });
    account.onClose(() => manager.detach(c));
    return {
        initialize: () => manager.attach(c, session),
        interact: () => manager.interact(userId),
        step: () => manager.step(userId),
        leaving: (d) => manager.leaving(userId, d),
        blocked: (map, x, y) => manager.blocked(userId, map, x, y),
        device: (kind) => manager.device(userId, kind),
    };
}
module.exports = {
    createHousingManager,
    getHousingManager,
    registerHousingHandlers,
};
