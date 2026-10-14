const test = require('node:test');
const assert = require('node:assert/strict');

test('camera: desktop retains the full map', async () => {
    const { getWorldCamera } = await import('../vue-explorakit/src/services/worldCamera.js');
    assert.deepEqual(getWorldCamera(896, 640, { x: 100, y: 100 }), {
        scale: 1, x: 0, y: 0, visibleWidth: 896, visibleHeight: 640,
    });
    const small = getWorldCamera(448, 320, { x: 800, y: 600 });
    assert.equal(small.scale, 0.5);
    assert.equal(small.x, 0);
    assert.equal(small.visibleWidth, 896);
});

test('camera: mobile keeps sprites readable and follows the player', async () => {
    const { getWorldCamera } = await import('../vue-explorakit/src/services/worldCamera.js');
    const first = getWorldCamera(390, 628, { x: 448, y: 320 }, true);
    const next = getWorldCamera(390, 628, { x: 480, y: 320 }, true);
    assert.equal(first.scale, 1);
    assert.equal(first.x, 253);
    assert.equal(next.x - first.x, 32);
    assert.equal((480 - next.x) * next.scale, 195);
});

test('camera: portrait, landscape and tall tablets never expose space outside the map', async () => {
    const { getWorldCamera, WORLD_WIDTH, WORLD_HEIGHT } = await import('../vue-explorakit/src/services/worldCamera.js');
    for (const [width, height] of [[320, 352], [393, 636], [676, 334], [1024, 1100]]) {
        for (const player of [{ x: 16, y: 16 }, { x: 880, y: 624 }, { x: 448, y: 320 }]) {
            const camera = getWorldCamera(width, height, player, true);
            assert(camera.scale >= 1);
            assert(camera.x >= 0 && camera.y >= 0);
            assert(camera.x + camera.visibleWidth <= WORLD_WIDTH + 0.01);
            assert(camera.y + camera.visibleHeight <= WORLD_HEIGHT + 0.01);
            const screenX = (player.x - camera.x) * camera.scale;
            const screenY = (player.y - camera.y) * camera.scale;
            assert(screenX >= 0 && screenX <= width);
            assert(screenY >= 0 && screenY <= height);
        }
    }
});
