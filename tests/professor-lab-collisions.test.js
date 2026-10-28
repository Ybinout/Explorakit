const test = require('node:test');
const assert = require('node:assert/strict');
const maps = require('../server/game/world/mapRepository');
const room = require('../server/game/world/roomObstacles');
const lab = require('../server/game/world/labStory');
const ending = require('../server/game/world/voidEnding');
const { nearestSafePosition } = require('../server/game/world/safePosition');
const collision = maps.loadCollisionData('professor_lab');
const crystals = room.obstacles.find(o => o.id === 'lab_crystals');

function reachable(progress) {
    const seen = new Set(), queue = [[13, 16]];
    const actors = lab.scopedStore(require('../server/game/world/pnjStore'), () => progress);
    for (const [x, y] of queue) {
        const key = `${x},${y}`;
        if (seen.has(key) || collision[y]?.[x] !== 0
            || actors.isPnjBlockingTile('professor_lab', x, y)
            || room.isLocked(crystals, progress) && crystals.cells.some(p => p.x === x && p.y === y)) continue;
        seen.add(key);
        for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) queue.push([x + dx, y + dy]);
    }
    return seen;
}

test('Lab: clear floor beside and between the side furniture is accessible', () => {
    for (const [x, y] of [[4, 8], [6, 8], [23, 8], [6, 9], [8, 9], [19, 9], [21, 9], [8, 13], [19, 13]]) {
        assert.equal(collision[y][x], 0, `painted floor ${x},${y}`);
        assert(reachable({ flags: { professor_defeated: 'true', lab_crystals_cleared: 'true' } }).has(`${x},${y}`), `reachable floor ${x},${y}`);
    }
});

test('Lab: tanks, desks, stools, bottom storage and outside walls remain solid', () => {
    // The sprite's feet extend below its movement anchor: the console tops
    // must stop row 10 as well, even where that tile's center is bare floor.
    for (const [x, y] of [[4, 5], [8, 7], [19, 6], [23, 7], [7, 8], [4, 10], [6, 10], [21, 10], [23, 10], [6, 11], [20, 12], [7, 13], [20, 13], [4, 14], [8, 15], [19, 14], [23, 15]]) {
        assert.notEqual(collision[y][x], 0, `furniture ${x},${y}`);
    }
    for (let y = 0; y < collision.length; y++) for (let x = 0; x < collision[y].length; x++) {
        if (collision[y][x] === 0) assert(x >= 4 && x <= 23 && y >= 5 && y <= 17, `room boundary ${x},${y}`);
    }
    const seen = reachable({ flags: { lucie_rescued: 'true' } });
    for (let y = 0; y < collision.length; y++) for (let x = 0; x < collision[y].length; x++) {
        if (collision[y][x] === 0 && !['13,10', '13,11'].includes(`${x},${y}`)) {
            assert(seen.has(`${x},${y}`), `no isolated pocket ${x},${y}`);
        }
    }
});

test('Lab: opening the side aisles never bypasses the private crystal barrier, including admin replay', () => {
    for (const flags of [{}, { professor_defeated: 'true' }, {
        lucie_rescued: 'true', admin_finale_replay: 'full', admin_lab_rescued: 'false',
        admin_professor_departure: 'seen', 'admin_room_obstacle:lab_crystals': 'false'
    }]) {
        const seen = reachable({ flags });
        assert(seen.has('13,12')); assert(seen.has('13,17'));
        assert(!seen.has('13,6')); assert(!seen.has('9,7')); assert(!seen.has('18,7'));
    }
    for (const flags of [{ professor_defeated: 'true', lab_crystals_cleared: 'true' }, {
        lucie_rescued: 'true', admin_finale_replay: 'full', admin_lab_rescued: 'false', admin_professor_departure: 'seen',
        'admin_room_obstacle:lab_crystals': 'true'
    }]) assert(reachable({ flags }).has('13,6'), 'Lucie can be reached after clearing the crystals');
    assert.equal(crystals.requiresFlag, 'professor_defeated');
    assert.equal(crystals.strikeTimes.length, 10);
});

test('Lab: entrances, secret device and reconnect recovery remain on reachable floor', () => {
    const progress = { flags: { lucie_rescued: 'true', professor_departure: 'seen', professor_defeated: 'true' } };
    const seen = reachable(progress);
    const points = [lab.config.arrival, ending.config.exit, { x: ending.config.pickup.x * 32 + 16, y: ending.config.pickup.y * 32 + 16 }];
    for (const p of points) {
        assert(seen.has(`${Math.floor(p.x / 32)},${Math.floor(p.y / 32)}`));
        assert.deepEqual(nearestSafePosition(p.x, p.y, collision, 'professor_lab'), { x: p.x, y: p.y });
    }
    for (const [x, y] of [[7, 8], [7, 13], [20, 13], [0, 0], [27, 19]]) {
        const p = nearestSafePosition(x * 32 + 16, y * 32 + 16, collision, 'professor_lab');
        assert(seen.has(`${Math.floor(p.x / 32)},${Math.floor(p.y / 32)}`));
        assert(Math.hypot(p.x - (x * 32 + 16), p.y - (y * 32 + 16)) <= 450);
    }
    for (const x of [13, 14]) assert.equal(maps.getNextMap('professor_lab', x, 17).nextMap, 'start');
});
