const { randomBytes } = require('node:crypto');

const CAPACITIES = Object.freeze(Array.from({ length: 15 }, (_, index) => index + 2));
const DURATIONS = Object.freeze([20, 30, 40, 60, 90, 120, 300]);
const RECONNECT_MS = 90000;
const IDLE_MS = 2 * 60 * 60 * 1000;

class LobbyError extends Error {
    constructor(code, message) { super(message); this.code = code; }
}
function fail(code, message) { throw new LobbyError(code, message); }

function createLobbyStore({ now = Date.now, codeGenerator = () => randomBytes(4).toString('hex').toUpperCase() } = {}) {
    const lobbies = new Map();
    const memberships = new Map();
    const connections = new Map();
    const identity = user => {
        if (!Number.isSafeInteger(user?.id) || user.id <= 0) fail('invalid_user', 'Dresseur invalide.');
        return user.id;
    };
    const lobbyFor = user => lobbies.get(memberships.get(identity(user)));
    function requireLobby(user) {
        const lobby = lobbyFor(user);
        if (!lobby) fail('no_lobby', 'Tu ne fais partie d’aucun salon.');
        return lobby;
    }
    function validateRules(rules) {
        if (!rules || !CAPACITIES.includes(rules.capacity) || !DURATIONS.includes(rules.durationMinutes)) {
            fail('invalid_rules', 'Choisis de 2 à 16 joueurs et une durée de 20, 30, 40 minutes, 1 h, 1 h 30, 2 h ou 5 h.');
        }
        const visibility = rules.visibility ?? 'private';
        if (!['public', 'private'].includes(visibility)) fail('invalid_rules', 'Choisis un salon public ou privé.');
        return { capacity: rules.capacity, durationMinutes: rules.durationMinutes, visibility };
    }
    function snapshot(user) {
        const lobby = lobbyFor(user);
        if (!lobby) return null;
        return {
            code: lobby.code, hostId: lobby.hostId, phase: lobby.run?.phase || 'lobby',
            ...lobby.rules, createdAt: lobby.createdAt, expiresAt: lobby.touchedAt + IDLE_MS,
            players: [...lobby.players.values()].map(player => ({
                id: player.id, username: player.username, ready: player.ready,
                connected: (connections.get(player.id)?.size || 0) > 0,
                reconnectUntil: player.disconnectedAt === null ? null : player.disconnectedAt + RECONNECT_MS
            })),
            launchAvailable: !lobby.starting,
            launchMessage: 'Le groupe complet doit être connecté et prêt.'
        };
    }
    function remove(userId) {
        const lobby = lobbies.get(memberships.get(userId));
        memberships.delete(userId);
        if (!lobby) return;
        lobby.players.delete(userId);
        if (!lobby.players.size) { lobbies.delete(lobby.code); return; }
        if (lobby.hostId === userId) lobby.hostId = [...lobby.players.keys()].find(id => connections.get(id)?.size) || lobby.players.keys().next().value;
        lobby.players.forEach(player => { player.ready = false; });
        lobby.touchedAt = now();
    }
    function sweep() {
        for (const lobby of lobbies.values()) {
            if (lobby.run || lobby.starting) continue;
            if (now() - lobby.touchedAt >= IDLE_MS) {
                for (const id of lobby.players.keys()) memberships.delete(id);
                lobbies.delete(lobby.code);
                continue;
            }
            for (const player of [...lobby.players.values()]) {
                if (player.disconnectedAt !== null && now() - player.disconnectedAt >= RECONNECT_MS) remove(player.id);
            }
        }
    }
    function add(lobby, user) {
        lobby.players.set(user.id, {
            id: user.id, username: String(user.username || 'Dresseur').slice(0, 40), ready: false,
            disconnectedAt: connections.get(user.id)?.size ? null : now()
        });
        memberships.set(user.id, lobby.code);
        lobby.touchedAt = now();
    }
    return {
        snapshot, sweep, getLobby: lobbyFor,
        exportLobbies: () => [...lobbies.values()],
        restoreLobbies(saved) {
            lobbies.clear(); memberships.clear(); connections.clear();
            for (const lobby of saved) {
                lobby.starting=false; lobby.touchedAt=now();
                for (const p of lobby.players.values()) { p.disconnectedAt=now()+210000; p.ready=false; memberships.set(p.id,lobby.code); }
                lobbies.set(lobby.code,lobby);
            }
        },
        listOpen(user) {
            identity(user);
            sweep();
            return [...lobbies.values()]
                .filter(lobby => lobby.rules.visibility === 'public' && !lobby.run && !lobby.starting &&
                    lobby.players.size < lobby.rules.capacity && connections.get(lobby.hostId)?.size)
                .sort((a, b) => b.createdAt - a.createdAt)
                .map(lobby => ({ code: lobby.code, hostName: lobby.players.get(lobby.hostId).username,
                    capacity: lobby.rules.capacity, playerCount: lobby.players.size,
                    durationMinutes: lobby.rules.durationMinutes, createdAt: lobby.createdAt }));
        },
        connect(user, socketId) {
            sweep();
            const id = identity(user);
            if (!connections.has(id)) connections.set(id, new Set());
            connections.get(id).add(socketId);
            const player = lobbyFor(user)?.players.get(id);
            if (player) player.disconnectedAt = null;
            return snapshot(user);
        },
        disconnect(user, socketId) {
            const id = identity(user);
            const sockets = connections.get(id);
            sockets?.delete(socketId);
            if (sockets?.size) return;
            connections.delete(id);
            const player = lobbyFor(user)?.players.get(id);
            if (player) { player.ready = false; player.disconnectedAt = now(); }
        },
        create(user, rules) {
            sweep();
            identity(user);
            if (lobbyFor(user)) fail('already_joined', 'Quitte ton salon avant d’en créer un autre.');
            const validated = validateRules(rules);
            if (lobbies.size >= 1000) fail('server_full', 'Tous les salons sont occupés. Réessaie plus tard.');
            let code;
            for (let attempts = 0; attempts < 10; attempts++) {
                code = codeGenerator();
                if (!lobbies.has(code)) break;
                code = null;
            }
            if (!code) fail('code_unavailable', 'Impossible de créer le salon. Réessaie.');
            const lobby = { code, hostId: user.id, rules: validated, players: new Map(), createdAt: now(), touchedAt: now() };
            lobbies.set(code, lobby);
            add(lobby, user);
            return snapshot(user);
        },
        join(user, code) {
            sweep();
            identity(user);
            if (typeof code !== 'string' || !/^[A-F0-9]{8}$/.test(code.trim().toUpperCase())) fail('invalid_code', 'Le code du salon contient 8 caractères.');
            code = code.trim().toUpperCase();
            const current = lobbyFor(user);
            if (current?.code === code) return snapshot(user);
            if (current) fail('already_joined', 'Quitte ton salon avant d’en rejoindre un autre.');
            const lobby = lobbies.get(code);
            if (lobby?.run) fail('already_started', 'Cette expédition a déjà commencé.');
            if (!lobby) fail('not_found', 'Ce salon est introuvable ou a expiré.');
            if (lobby.starting) fail('starting', 'La partie est en cours de lancement.');
            if (lobby.players.size >= lobby.rules.capacity) fail('lobby_full', 'Ce salon est complet.');
            add(lobby, user);
            lobby.players.forEach(player => { player.ready = false; });
            return snapshot(user);
        },
        configure(user, rules) {
            const lobby = requireLobby(user);
            if (lobby.hostId !== user.id) fail('host_only', 'Seul le créateur du salon peut modifier les règles.');
            if (lobby.run) fail('already_started', 'Les règles sont verrouillées.');
            if (lobby.starting) fail('starting', 'La partie est en cours de lancement.');
            const validated = validateRules({ ...rules, visibility: rules?.visibility ?? lobby.rules.visibility });
            if (validated.capacity < lobby.players.size) fail('capacity_too_small', 'Cette taille est inférieure au nombre de dresseurs présents.');
            lobby.rules = validated;
            lobby.players.forEach(player => { player.ready = false; });
            lobby.touchedAt = now();
            return snapshot(user);
        },
        ready(user, ready) {
            const lobby = requireLobby(user);
            if (lobby.run) fail('already_started', 'La préparation du salon est terminée.');
            if (lobby.starting) fail('starting', 'La partie est en cours de lancement.');
            if (typeof ready !== 'boolean') fail('invalid_ready', 'État de préparation invalide.');
            if (!connections.get(user.id)?.size) fail('offline', 'Reconnecte-toi au salon.');
            lobby.players.get(user.id).ready = ready;
            lobby.touchedAt = now();
            return snapshot(user);
        },
        leave(user) {
            identity(user);
            if (lobbyFor(user)?.starting) fail('starting', 'La partie est en cours de lancement.');
            remove(user.id); return null;
        },
        start(user) {
            const lobby = requireLobby(user);
            if (lobby.hostId !== user.id) fail('host_only', 'Seul le créateur peut lancer la partie.');
            if (lobby.run) fail('already_started', 'La partie a déjà commencé.');
            if (lobby.starting) fail('starting', 'La partie est en cours de lancement.');
            if (lobby.players.size !== lobby.rules.capacity || [...lobby.players.values()].some(p => !p.ready || !connections.get(p.id)?.size)) fail('not_ready', 'Le groupe doit être complet, connecté et prêt.');
            return lobby;
        }
    };
}

module.exports = { createLobbyStore, LobbyError, CAPACITIES, DURATIONS, RECONNECT_MS, IDLE_MS };
