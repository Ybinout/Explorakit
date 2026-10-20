const test = require('node:test');
const assert = require('node:assert/strict');
const { maps } = require('../data/game/nextMap.json');
const { loadCollisionData, changeMapData, getNextMap } = require('../server/game/world/mapRepository');
const { createLobbyStore } = require('../server/game/drift/lobbyStore');
const { createRunManager } = require('../server/game/drift/runManager');

test('every configured doorway can be entered without crossing a collision', () => {
    for (const { mapName } of maps) {
        const collisions = loadCollisionData(mapName), changes = changeMapData(mapName);
        for (let y = 0; y < changes.length; y++) {
            for (let x = 0; x < changes[y].length; x++) {
                // The official Valpierre export intentionally keeps a cliff over
                // the last west marker; its three adjacent exits remain usable.
                if (mapName === 'ville_safe1' && x === 0 && y === 6) { assert.notEqual(collisions[y]?.[x], 0); continue; }
                if (changes[y][x] && getNextMap(mapName, x, y))
                    assert.equal(collisions[y]?.[x], 0, `${mapName}: doorway ${x},${y} is blocked`);
            }
        }
    }
});

for (const mode of ['rift', 'colosseum-30', 'colosseum-60']) {
    test(`${mode}: enter the second starting house, exit both sides of its door and re-enter`, async () => {
        let now = 1000;
        const store = createLobbyStore({ now: () => now });
        const runtime = createRunManager({ starterChoiceMs:0, store, namespace: { to: () => ({ emit() {} }) }, now: () => now, random: () => .5 });
        const host = { id: 1, username: 'Door tester' }, guest = { id: 2, username: 'Rival' };
        store.connect(host, 'host');
        if (mode === 'rift') {
            store.connect(guest, 'guest');
            const { code } = store.create(host, { capacity: 2, durationMinutes: 20 });
            store.join(guest, code);store.ready(host, true);store.ready(guest, true);
            await runtime.start(host);runtime.enter(guest, { id: 'guest' });
        } else await runtime.startColosseum(host, { durationMinutes: Number(mode.split('-')[1]) });
        runtime.enter(host, { id: 'host' });
        const player = runtime.playerFor(host);
        // Start just below the existing village entrance; all following changes use real movement.
        player.x = 240;player.y = 240;
        const move = action => { now += 160;runtime.move(player, action); };
        move('move_z');assert.equal(player.currentmap, 'maison2');
        // The wall beside the door stays solid.
        move('move_q');const before = player.y;move('move_s');assert.equal(player.y, before);
        move('move_d');move('move_s');assert.equal(player.currentmap, 'start');
        assert.equal(player.x, 240);assert.equal(player.y, 208);
        move('move_s');move('move_z');assert.equal(player.currentmap, 'maison2');
        move('move_d');move('move_s');assert.equal(player.currentmap, 'start');
        move('move_s');assert.equal(player.y, 240);
        assert.equal(player.alive, true);assert.equal(player.run.phase, 'exploration');
    });
}
