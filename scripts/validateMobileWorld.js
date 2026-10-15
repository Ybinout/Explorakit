const assert = require('node:assert/strict');
const path = require('node:path');
const { validateMobileBattle } = require('./validateMobileBattle');
const { validateMobileGestures, validateMapLoading } = require('./validateMobileGestures');

async function validateMobileWorld({ loginContext, fixture, base, output, fit }) {
    const { context, page } = await loginContext(fixture, { width: 393, height: 852 }, {
        isMobile: true, hasTouch: true, deviceScaleFactor: 3,
    });
    // Do not close on failure: the caller captures failed pages before its cleanup.
    await page.goto(base + '/game', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => {
        let node = document.querySelector('.game-stage');
        while (node && !node.__vue__) node = node.parentElement;
        const vm = node?.__vue__;
        if (!vm?.players[vm.socket.id] || !vm.mapImage?.complete) return false;
        window.mobileTestVm = vm;
        return true;
    });
    const formats = [[393, 852], [360, 740], [320, 568], [844, 390], [740, 320], [393, 700], [1024, 768]];
    for (const [width, height] of formats) {
        await page.setViewportSize({ width, height });
        await page.waitForFunction(() => {
            const vm = window.mobileTestVm;
            return vm.worldFrame.width === vm.$refs.worldViewport.clientWidth
                && vm.worldFrame.height === vm.$refs.worldViewport.clientHeight;
        });
        for (const selector of ['.world-toolbar', '.world-viewport', '.mobile-dpad', '.mobile-action-a']) {
            await fit(page, selector, width, height);
        }
        const viewport = await page.locator('.world-viewport').boundingBox();
        const toolbar = await page.locator('.world-toolbar').boundingBox();
        const dock = await page.locator('.mobile-control-dock').boundingBox();
        assert(Math.abs(viewport.y - toolbar.y - toolbar.height) <= 1, 'Gap above map');
        if (width < height) {
            assert(viewport.height >= height - 230, 'Map is too small in portrait');
            assert(Math.abs(dock.y - viewport.y - viewport.height) <= 1, 'Gap below map');
            assert(dock.height <= 164, 'Controls take too much vertical space');
        } else {
            assert(viewport.width >= width - 170, 'Map is too narrow in landscape');
            assert(Math.abs(dock.x - viewport.x - viewport.width) <= 1, 'Gap beside map');
        }
        assert.equal(await page.locator('.adventure-guide').count(), 0);
        const state = await page.evaluate(() => {
            const vm = window.mobileTestVm, canvas = vm.$refs.monCanvas, ctx = canvas.getContext('2d');
            const original = ctx.setTransform;
            let matrix;
            ctx.setTransform = function (...args) { matrix = args; return original.apply(this, args); };
            try { vm.drawPlayers(); } finally { ctx.setTransform = original; }
            const player = vm.players[vm.socket.id];
            return {
                scroll: document.documentElement.scrollHeight, height: innerHeight,
                ratio: vm.worldFrame.pixelRatio, buffer: [canvas.width, canvas.height],
                viewport: [vm.worldFrame.width, vm.worldFrame.height],
                player: [player.x, player.y], matrix,
                pixel: [...ctx.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data],
            };
        });
        assert(state.scroll <= state.height + 1, 'Game scrolls vertically');
        assert.equal(state.matrix[0], state.matrix[3], 'Map must not be stretched');
        assert(state.matrix[0] >= state.ratio, 'Mobile sprites are shrunk');
        for (const axis of [0, 1]) {
            assert.equal(state.buffer[axis], state.viewport[axis] * state.ratio);
            const position = state.player[axis] * state.matrix[0] + state.matrix[axis + 4];
            assert(position >= 0 && position <= state.buffer[axis], 'Camera lost the player');
        }
        assert.equal(state.pixel[3], 255, 'Map was not drawn');
        for (const button of await page.locator('.mobile-dpad-btn, .mobile-action-a').all()) {
            const bounds = await button.boundingBox();
            assert(bounds.width >= 44 && bounds.height >= 44, 'Touch target too small');
        }
        await page.screenshot({ path: path.join(output, `mobile-world-${width}x${height}.png`) });
        await page.locator('.menu-toggle-btn').tap();
        assert.equal(await page.locator('.adventure-guide').count(), 0);
        await page.locator('[data-menu-action="progress"]').tap();
        await page.locator('.adventure-guide').waitFor();
        await page.locator('.help summary').tap();
        assert(await page.locator('.help').evaluate(el => el.open));
        await fit(page, '.info-panel', width, height);
        await page.locator('.info-panel .close-button').tap();
        assert.equal(await page.locator('.adventure-guide').count(), 0);
    }
    await page.setViewportSize({ width: 393, height: 852 });
    const client = await context.newCDPSession(page);
    const before = await page.evaluate(() => {
        const vm = window.mobileTestVm, player = vm.players[vm.socket.id];
        vm.mobileMoveReceived = 0;
        vm.socket.on('playerMoved', ({ id }) => { if (id === vm.socket.id) vm.mobileMoveReceived++; });
        return { x: player.x, y: player.y };
    });
    const down = await page.locator('.mobile-dpad-down').boundingBox();
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: down.x + 22, y: down.y + 22 }] });
    await page.waitForFunction(() => window.mobileTestVm.mobileMoveReceived > 0);
    await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    const after = await page.evaluate(() => {
        const vm = window.mobileTestVm, player = vm.players[vm.socket.id];
        return { x: player.x, y: player.y, moving: Object.values(vm.keysPressed).some(Boolean) };
    });
    assert(!after.moving, 'Touch cancellation leaves movement pressed');
    assert(before.x !== after.x || before.y !== after.y, 'Touch did not move the player');
    const gestures = await validateMobileGestures(page, context, output);
    const travel = await validateMapLoading(page, output);
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('.mobile-dpad').waitFor();
    assert.equal(await page.locator('.adventure-guide').count(), 0, 'Reload reopens objective');
    const battle = await validateMobileBattle(page, output, fit);
    await context.close();
    return { touchEmulation: true, formats: formats.length, serverMovement: true, objectiveOnlyInMenu: true, gestures, travel, battle };
}

module.exports = { validateMobileWorld };
