const assert = require('node:assert/strict');
const path = require('node:path');

async function validateMobileGestures(page, context, output) {
    const client = await context.newCDPSession(page);
    let touching = false;
    const touch = async (type, point) => {
        await client.send('Input.dispatchTouchEvent', { type, touchPoints: point ? [point] : [] });
        touching = !['touchEnd', 'touchCancel'].includes(type);
    };
    await page.evaluate(() => {
        const vm = window.mobileTestVm;
        vm.gestureCommands = [];
        vm._gestureEmit = vm.socket.emit;
        vm.socket.emit = function (name, ...args) {
            if (name === 'playerAction') vm.gestureCommands.push(args[0]);
            return vm._gestureEmit.call(this, name, ...args);
        };
    });
    try {
        const pad = await page.locator('.mobile-dpad').boundingBox();
        const center = { x: pad.x + pad.width / 2, y: pad.y + pad.height / 2 };
        await touch('touchStart', center);
        assert.equal(await page.evaluate(() => window.mobileTestVm.gestureCommands.length), 0);
        for (const [dx, dy, key] of [[46, 0, 'd'], [0, 46, 's'], [-46, 0, 'q'], [0, -46, 'z']]) {
            await touch('touchMove', { x: center.x + dx, y: center.y + dy });
            await page.waitForFunction(key => window.mobileTestVm.keysPressed[key], key);
        }
        await touch('touchCancel');
        assert.deepEqual(await page.evaluate(() => window.mobileTestVm.gestureCommands
            .filter((command, index, commands) => command !== commands[index - 1])),
        ['move_d', 'move_s', 'move_q', 'move_z'], 'Direction changes stay ordered even when a held finger repeats steps');
        assert.equal(await page.evaluate(() => Object.values(window.mobileTestVm.keysPressed).some(Boolean)), false);
        const map = await page.locator('.world-viewport').boundingBox();
        const origin = { x: map.x + map.width / 2, y: map.y + map.height / 2 };
        await touch('touchStart', origin);
        await touch('touchMove', { x: origin.x, y: origin.y + 48 });
        await page.waitForFunction(() => window.mobileTestVm.keysPressed.s);
        await page.screenshot({ path: path.join(output, 'mobile-swipe-down.png') });
        // Opening a menu cancels a held finger; closing it must not resume walking.
        await page.evaluate(() => { window.mobileTestVm.isMenuOpen = true; });
        await page.waitForFunction(() => !Object.values(window.mobileTestVm.keysPressed).some(Boolean));
        await touch('touchMove', { x: origin.x + 48, y: origin.y });
        assert.equal(await page.evaluate(() => Object.values(window.mobileTestVm.keysPressed).some(Boolean)), false);
        await touch('touchEnd');
        await page.evaluate(() => { window.mobileTestVm.isMenuOpen = false; });
    } finally {
        if (touching) await touch('touchCancel');
        await page.evaluate(() => {
            const vm = window.mobileTestVm; vm.socket.emit = vm._gestureEmit; vm.releaseAllMovementKeys();
        });
        await client.detach();
    }
    return { padSliding: true, mapSwiping: true, cancelAndMenuStop: true };
}

async function validateMapLoading(page, output) {
    let release;
    const delayed = new Promise(resolve => { release = resolve; });
    let heldRequests = 0;
    const delayHouse = async route => { heldRequests++; await delayed; await route.continue(); };
    await page.route('**/img/maison2*.png', delayHouse);
    await page.evaluate(() => {
        const vm = window.mobileTestVm;
        vm.releaseAllMovementKeys();
        vm._travelFixture = { map: vm.map, players: JSON.parse(JSON.stringify(vm.players)), pnjs: vm.pnjs };
        vm._mapScenes.clear();
        vm._travelFrame = vm.$refs.monCanvas.toDataURL();
        const player = { ...vm.players[vm.socket.id], x: 144, y: 208, currentmap: 'maison2' };
        vm.socket.onevent({ data: ['newmap', { mapname: 'maison2', playersList: { [vm.socket.id]: player } }] });
        vm.drawPlayers();
    });
    try {
        await page.waitForFunction(() => window.mobileTestVm.mapLoading);
        assert.equal(await page.evaluate(() => {
            const vm = window.mobileTestVm;
            return vm.$refs.monCanvas.toDataURL() === vm._travelFrame;
        }), true, 'Keep exactly the previous frame while assets are missing');
        await page.screenshot({ path: path.join(output, 'mobile-map-loading.png') });
        assert(heldRequests > 0, 'The map request must really be delayed');
        // A newer server destination wins even when an older image finishes last.
        await page.evaluate(() => {
            const vm = window.mobileTestVm;
            const player = { ...vm.players[vm.socket.id], x: 592, y: 400, currentmap: 'route2' };
            vm.socket.onevent({ data: ['newmap', { mapname: 'route2', playersList: { [vm.socket.id]: player } }] });
        });
        await page.waitForFunction(() => window.mobileTestVm.renderedMap === 'route2' && !window.mobileTestVm.mapLoading);
        release();
        await page.evaluate(() => window.mobileTestVm._mapScenes.load('maison2'));
        assert.equal(await page.evaluate(() => window.mobileTestVm.renderedMap), 'route2');
        const alpha = await page.evaluate(() => {
            const canvas = window.mobileTestVm.$refs.monCanvas;
            return canvas.getContext('2d').getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data[3];
        });
        assert.equal(alpha, 255);
        await page.screenshot({ path: path.join(output, 'mobile-map-arrival.png') });
    } finally {
        release(); await page.unroute('**/img/maison2*.png', delayHouse);
        await page.evaluate(() => {
            const vm = window.mobileTestVm, original = vm._travelFixture;
            vm.socket.onevent({ data: ['newmap', { mapname: original.map, playersList: original.players }] });
            vm.pnjs = original.pnjs;
        });
        await page.waitForFunction(() => !window.mobileTestVm.mapLoading);
    }
    return { heldFrame: true, decodedLayers: true, latestDestinationWins: true };
}
module.exports = { validateMobileGestures, validateMapLoading };
