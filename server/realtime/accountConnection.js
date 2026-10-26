// One live game connection per account across every namespace of this server.
// Keep the retiring lease until its writes finish, even after a normal logout.
const servers = new WeakMap();
const connections = new WeakMap();
const REPLACED_MESSAGE = 'Ton compte vient de se connecter ailleurs. Cette session a été déconnectée.';

function trackAccountTask(socket, work) {
    const task = Promise.resolve(work), connection = connections.get(socket);
    if (connection) {
        connection.tasks.add(task);
        task.then(() => connection.tasks.delete(task), () => connection.tasks.delete(task));
    }
    return task;
}

function onAccountEvent(socket, event, handler) {
    const connection = connections.get(socket);
    if (!connection) return socket.on(event, handler);
    return socket.on(event, function (...args) {
        if (!connection.active()) return;
        return trackAccountTask(socket, handler.apply(this, args));
    });
}

function waitForAccountConnections(server) {
    return Promise.all([...(servers.get(server)?.values() || [])].map(connection => connection.closed));
}

function exclusiveAccountConnection(initialize) {
    return socket => {
        const id = socket.data.user?.id;
        if (!Number.isInteger(id) || id <= 0) return socket.disconnect();
        const server = socket.nsp.server;
        if (!servers.has(server)) servers.set(server, new Map());
        const accounts = servers.get(server), previous = accounts.get(id);
        let initialized, finished, draining = false, queued = 0;
        const ready = new Promise(resolve => { initialized = resolve; });
        const closed = new Promise(resolve => { finished = resolve; });
        const cleanups = [], connection = { socket, closed, tasks: new Set() };
        accounts.set(id, connection);
        connections.set(socket, connection);
        const active = () => socket.connected && accounts.get(id) === connection;
        connection.active = active;
        const log = error => console.error('Session de jeu :', error?.message || error);
        async function drain() {
            if (draining) return;
            draining = true;
            await ready;
            while (connection.tasks.size) await Promise.allSettled([...connection.tasks]);
            for (const cleanup of cleanups) {
                try { await cleanup(); } catch (error) { log(error); }
            }
            if (accounts.get(id) === connection) accounts.delete(id);
            connections.delete(socket);
            finished();
        }
        socket.once('disconnect', drain);
        // A replacement may wait for a save. Hold its early commands until the
        // world handlers exist, and discard commands queued by a retired socket.
        socket.use((packet, next) => {
            if (++queued > 64) { queued--; return socket.disconnect(); }
            ready.then(() => {
                queued--;
                if (active()) return next();
                const reply = packet.at(-1);
                if (typeof reply === 'function') reply({ success: false, ok: false, code: 'session_replaced', message: REPLACED_MESSAGE });
            });
        });
        if (previous?.socket.connected) {
            previous.socket.emit('session:replaced', { code: 'session_replaced', message: REPLACED_MESSAGE });
            // Disconnect the namespace, not another user's multiplexed transport.
            previous.socket.disconnect();
        }
        (async () => {
            try {
                if (previous) await previous.closed;
                if (!active()) return;
                await initialize(socket, {
                    active,
                    onClose: cleanup => cleanups.push(cleanup),
                    track: task => trackAccountTask(socket, task),
                    on(event, handler) {
                        onAccountEvent(socket, event, handler);
                    }
                });
            } catch (error) {
                log(error);
                socket.disconnect();
            } finally {
                initialized();
                if (!active()) drain();
            }
        })();
    };
}

module.exports = { exclusiveAccountConnection, trackAccountTask, onAccountEvent, waitForAccountConnections, REPLACED_MESSAGE };
