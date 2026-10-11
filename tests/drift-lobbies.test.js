const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { createLobbyStore, CAPACITIES, DURATIONS, RECONNECT_MS, IDLE_MS } = require('../server/game/drift/lobbyStore');
const catalogue = require('../data/game/drifts.json');

const user = id => ({ id, username: `Dresseur ${id}` });
const rules = { capacity: 4, durationMinutes: 30 };
function fixture() {
    let time = 1000, codes = 0;
    const store = createLobbyStore({ now: () => time, codeGenerator: () => (++codes).toString(16).padStart(8, '0').toUpperCase() });
    return { store, advance: duration => { time += duration; }, online: id => store.connect(user(id), `socket-${id}`) };
}

test('le catalogue reproduit 59 Drifts, 280 variantes et les poids du classeur fourni', () => {
    assert.equal(createHash('sha256').update(fs.readFileSync(catalogue.source.path)).digest('hex'), catalogue.source.sha256);
    assert.equal(catalogue.definitions.length, 59);
    assert.equal(new Set(catalogue.definitions.map(drift => drift.id)).size, 59);
    assert.deepEqual(catalogue.rarities.map(rarity => rarity.weight), [5500, 2700, 1200, 500, 100]);
    assert.equal(catalogue.definitions.flatMap(drift => Object.values(drift.values)).filter(value => value !== null).length, 280);
    for (const drift of catalogue.definitions) {
        assert.ok(drift.name && drift.description && drift.stat && drift.unit);
        const values = Object.values(drift.values).filter(value => value !== null);
        assert.ok(values.every((value, index) => Number.isFinite(value) && value > 0 && (index === 0 || value >= values[index - 1])));
        if (drift.category === 'Spécial') assert.deepEqual(Object.values(drift.values).slice(0, 3), [null, null, null]);
    }
    assert.equal(catalogue.definitions.find(drift => drift.id === 'DRF-016').values.common, 0.5);
});

test('105 combinaisons : 2 à 16 joueurs, de 20 minutes à 5 heures, aucune règle invalide', () => {
    assert.deepEqual(CAPACITIES, Array.from({ length: 15 }, (_, i) => i + 2));
    assert.deepEqual(DURATIONS, [20, 30, 40, 60, 90, 120, 300]);
    for (const capacity of CAPACITIES) for (const durationMinutes of DURATIONS) {
        const { store } = fixture();
        assert.equal(store.create(user(1), { capacity, durationMinutes }).capacity, capacity);
    }
    const { store } = fixture();
    for (const value of [null, {}, { capacity: '4', durationMinutes: 30 }, { capacity: 1, durationMinutes: 30 }, { capacity: 17, durationMinutes: 30 }, { capacity: 2.5, durationMinutes: 30 }, { capacity: 4, durationMinutes: 21 }, { capacity: 4, durationMinutes: 120, visibility: 'hidden' }]) {
        assert.throws(() => store.create(user(1), value), { code: 'invalid_rules' });
    }
    assert.throws(() => store.create(user(-1), rules), { code: 'invalid_user' });
    assert.equal(store.snapshot(user(1)), null);
});

test('recherche publique : exclut salons privés, complets, lancés et hôtes absents, sans révéler les membres', () => {
    const { store, online } = fixture();
    [1, 2, 3, 4, 5].forEach(online);
    store.create(user(1), rules);
    const open = store.create(user(2), { capacity: 3, durationMinutes: 120, visibility: 'public' });
    store.create(user(3), { ...rules, visibility: 'public' });
    store.disconnect(user(3), 'socket-3');
    assert.throws(() => store.listOpen(user(0)), { code: 'invalid_user' });
    assert.deepEqual(store.listOpen(user(5)), [{ code: open.code, hostName: 'Dresseur 2', capacity: 3, playerCount: 1, durationMinutes: 120, createdAt: open.createdAt }]);
    store.join(user(4), open.code);
    store.join(user(5), open.code);
    assert.deepEqual(store.listOpen(user(1)), []);
    store.configure(user(2), { capacity: 5, durationMinutes: 90 });
    assert.equal(store.listOpen(user(1))[0].playerCount, 3, 'les anciens clients conservent la visibilité en configurant');
    store.getLobby(user(2)).run = { phase: 'exploration' };
    assert.deepEqual(store.listOpen(user(1)), []);
});

test('salon privé : capacité, unicité du joueur, codes et mutations réservées au créateur', () => {
    const { store, online } = fixture();
    [1, 2, 3].forEach(online);
    const lobby = store.create(user(1), { ...rules, capacity: 2 });
    assert.throws(() => store.join(user(2), '../bad'), { code: 'invalid_code' });
    assert.throws(() => store.join(user(2), 'DEADBEEF'), { code: 'not_found' });
    store.join(user(2), lobby.code.toLowerCase());
    assert.equal(store.join(user(2), lobby.code).players.length, 2, 'rejoindre deux fois ne duplique pas le joueur');
    assert.throws(() => store.join(user(3), lobby.code), { code: 'lobby_full' });
    assert.throws(() => store.create(user(2), rules), { code: 'already_joined' });
    assert.throws(() => store.configure(user(2), rules), { code: 'host_only' });
    const other = store.create(user(3), rules);
    assert.throws(() => store.join(user(1), other.code), { code: 'already_joined' });
    assert.equal(store.snapshot(user(3)).players.length, 1, 'aucune fuite entre groupes');
    lobby.players[0].username = 'Mutation client';
    assert.equal(store.snapshot(user(1)).players[0].username, 'Dresseur 1');
});

test('les changements de règles et de participants annulent les prêts, sans exclure de joueur', () => {
    const { store, online } = fixture();
    [1, 2, 3].forEach(online);
    const lobby = store.create(user(1), rules);
    store.ready(user(1), true);
    store.join(user(2), lobby.code);
    assert.equal(store.snapshot(user(1)).players[0].ready, false);
    store.ready(user(1), true);
    store.ready(user(2), true);
    const changed = store.configure(user(1), { capacity: 8, durationMinutes: 60 });
    assert.ok(changed.players.every(player => !player.ready));
    store.join(user(3), lobby.code);
    assert.throws(() => store.configure(user(1), { capacity: 2, durationMinutes: 20 }), { code: 'capacity_too_small' });
    assert.throws(() => store.ready(user(1), 'true'), { code: 'invalid_ready' });
});

test('reconnexion et onglets partagent un seul siège, abandon transfère la création', () => {
    const { store, online, advance } = fixture();
    [1, 2].forEach(online);
    const lobby = store.create(user(1), rules);
    store.join(user(2), lobby.code);
    store.ready(user(1), true);
    store.connect(user(1), 'second-tab');
    store.disconnect(user(1), 'socket-1');
    assert.equal(store.snapshot(user(1)).players[0].ready, true);
    store.disconnect(user(1), 'second-tab');
    assert.equal(store.snapshot(user(1)).players[0].ready, false);
    assert.equal(store.snapshot(user(2)).players[0].connected, false);
    advance(RECONNECT_MS - 1);
    store.connect(user(1), 'reconnected');
    store.sweep();
    assert.equal(store.snapshot(user(1)).code, lobby.code);
    store.disconnect(user(1), 'reconnected');
    advance(RECONNECT_MS);
    store.sweep();
    assert.equal(store.snapshot(user(1)), null);
    assert.equal(store.snapshot(user(2)).hostId, 2);
    store.leave(user(2));
    assert.throws(() => store.join(user(1), lobby.code), { code: 'not_found' });
});

test('un salon inactif expire et le lancement exige le groupe complet prêt', () => {
    const { store, online, advance } = fixture();
    online(1);
    store.create(user(1), rules);
    store.ready(user(1), true);
    assert.throws(() => store.start(user(1)), { code: 'not_ready' });
    assert.equal(store.snapshot(user(1)).phase, 'lobby');
    assert.equal(store.snapshot(user(1)).launchAvailable, true);
    advance(IDLE_MS);
    store.sweep();
    assert.equal(store.snapshot(user(1)), null);
    assert.ok(store.create(user(1), rules));
});
