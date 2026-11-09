const rules = require('../game/casino/slots'),
    repository = require('../persistence/casinoSlotsRepository'),
    { locked } = require('../game/social/tradeLocks');
const managers = new WeakMap();
function createSlotsManager({
    store = repository,
    now = Date.now,
    tickMs = 250,
    rng,
} = {}) {
    const contexts = new Map(),
        pending = new Map(),
        queues = new Map();
    let ticking = false,
        closed = false;
    const ready = store.pending().then((rows) => {
        if (closed) return;
        for (const r of rows) pending.set(r.userId, r.resultAt);
    });
    function execute(id, work) {
        const task = (queues.get(id) || Promise.resolve())
                .then(() => ready)
                .then(work),
            safe = task.catch(() => {});
        queues.set(id, safe);
        safe.finally(() => {
            if (queues.get(id) === safe) queues.delete(id);
        });
        return task;
    }
    function context(id) {
        const c = contexts.get(id);
        if (!c || !c.socket.connected) rules.fail('Connexion interrompue.');
        return c;
    }
    function available(c, interact = false) {
        const p = c.getPlayer();
        if (
            !c.supported ||
            !p ||
            p.inbattle ||
            p.inventoryBusy ||
            p.superTournamentActive ||
            locked(c.id) ||
            !(interact ? (c.canInteract || c.canUse)() : c.canUse())
        )
            rules.fail('Termine ton action avant de jouer.');
        return p;
    }
    function publish(id, state) {
        const c = contexts.get(id);
        if (!c?.socket.connected) return;
        c.socket.emit('slots:state', state);
        c.socket.emit('whitepeak:wallet', { balance: state.balance });
    }
    function remember(id, state) {
        if (state.spin?.phase === 'spinning')
            pending.set(id, state.spin.resultAt);
        else pending.delete(id);
    }
    async function attach(c) {
        contexts.set(c.id, c);
        await ready;
        if (c.supported && pending.has(c.id)) {
            const state = await execute(c.id, () => store.settle(c.id, now()));
            remember(c.id, state);
            publish(c.id, state);
            if (c.getPlayer()?.currentmap === rules.config.map)
                c.socket.emit('slots:open', {
                    machine: state.spin.machine,
                    state,
                });
        }
    }
    async function interact(id) {
        const c = contexts.get(id),
            m = rules.at(c?.getPlayer());
        if (!m || !c.supported) return false;
        available(c, true);
        return execute(id, async () => {
            const state = await store.open(id, now());
            remember(id, state);
            c.socket.emit('slots:open', { machine: m.id, state });
            return true;
        });
    }
    function command(id, name, data) {
        return execute(id, async () => {
            const c = context(id);
            if (name === 'refresh') {
                available(c);
                const state = await store.settle(id, now());
                remember(id, state);
                publish(id, state);
                return state;
            }
            if (name !== 'spin') rules.fail('Action inconnue.');
            const p = available(c);
            if (!rules.near(p, data.machine))
                rules.fail('Approche-toi de la machine à sous.');
            const before = p.inventoryBusy;
            p.inventoryBusy = true;
            try {
                const state = await store.start(id, data, now(), rng);
                remember(id, state);
                publish(id, state);
                return state;
            } finally {
                p.inventoryBusy = before;
            }
        });
    }
    async function tick() {
        if (ticking || closed) return;
        ticking = true;
        try {
            await ready;
            for (const [id, due] of [...pending]
                .filter(([, due]) => due <= now())
                .slice(0, 32)) {
                if (due > now()) continue;
                try {
                    const state = await execute(id, () =>
                        store.settle(id, now())
                    );
                    remember(id, state);
                    publish(id, state);
                } catch (e) {
                    console.error('Machines à sous :', e.code || e.message);
                    pending.set(id, now() + 1000);
                }
            }
        } finally {
            ticking = false;
        }
    }
    const timer = tickMs
        ? setInterval(
              () =>
                  void tick().catch((e) =>
                      console.error('Machines à sous :', e.code || e.message)
                  ),
              tickMs
          )
        : null;
    timer?.unref();
    return {
        ready,
        attach,
        interact,
        command,
        tick,
        contexts,
        pending,
        detach(c) {
            if (contexts.get(c.id) === c) contexts.delete(c.id);
        },
        async stop() {
            closed = true;
            clearInterval(timer);
            await Promise.all(queues.values());
            contexts.clear();
            pending.clear();
        },
        stats: () => ({
            contexts: contexts.size,
            pending: pending.size,
            queues: queues.size,
        }),
    };
}
function getSlotsManager(io) {
    const key = io.server || io;
    if (!managers.has(key)) {
        const m = createSlotsManager();
        managers.set(key, m);
        key.httpServer?.once('close', () => void m.stop());
    }
    return managers.get(key);
}
function registerSlotsHandlers({
    manager,
    socket,
    account,
    userId,
    getPlayer,
    canUse,
    canInteract,
}) {
    const c = {
        id: userId,
        socket,
        getPlayer,
        canUse,
        canInteract,
        supported: socket.handshake?.auth?.casinoSlots === 1,
    };
    let count = 0,
        until = 0;
    for (const name of ['spin', 'refresh'])
        account.on('slots:' + name, async (data = {}, ack) => {
            const reply = typeof ack === 'function' ? ack : () => {};
            if (c.requestBusy)
                return reply({
                    success: false,
                    message: 'Patiente pendant l’enregistrement du tirage.',
                });
            c.requestBusy = true;
            try {
                if (Date.now() > until) {
                    until = Date.now() + 10000;
                    count = 0;
                }
                if (++count > 20) rules.fail('Patiente un instant.');
                if (!data || typeof data !== 'object' || Array.isArray(data))
                    rules.fail('Confirmation invalide.');
                const state = await manager.command(userId, name, data);
                reply({ success: true, state });
            } catch (e) {
                if (!e.statusCode)
                    console.error('Machines à sous :', e.code || e.message);
                reply({
                    success: false,
                    message: e.statusCode
                        ? e.message
                        : 'La réponse tarde. Actualise la machine pour vérifier ton tirage.',
                });
            } finally {
                c.requestBusy = false;
            }
        });
    account.onClose(() => manager.detach(c));
    return {
        initialize: () => manager.attach(c),
        interact: () => manager.interact(userId),
    };
}
module.exports = { createSlotsManager, getSlotsManager, registerSlotsHandlers };
