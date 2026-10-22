const assert = require('node:assert/strict');
const maps = require('../server/game/world/mapRepository');
const { getPnjsForMap } = require('../server/game/world/pnjStore');

async function validateNorthCaves(page, { capture }) {
    const position = () => page.evaluate(() => {
        const v = window.cavesVm, p = v.players[v.socket.id];
        return { map: v.map, x: Math.floor(p.x / 32), y: Math.floor(p.y / 32) };
    });
    async function ready() {
        await page.waitForFunction(() => {
            const v = document.querySelector('.game-root')?.__vue__;
            if (!v?.socket?.connected || !v.players[v.socket.id] || v.mapLoading || v.renderedMap !== v.map) return false;
            window.cavesVm = v;
            return v.mapImage.complete && v.foregroundImage.complete;
        });
    }
    async function step(action, expected) {
        await page.waitForTimeout(165);
        await page.evaluate(a => window.cavesVm.socket.emit('playerAction', a), action);
        await page.waitForFunction(p => {
            const v = window.cavesVm, a = v.players[v.socket.id];
            return v.map === p.map && v.renderedMap === p.map && !v.mapLoading && Math.floor(a.x / 32) === p.x && Math.floor(a.y / 32) === p.y;
        }, expected);
        assert.equal(await page.evaluate(() => window.cavesVm.battle), false);
    }
    async function walk(x, y) {
        const start = await position(), c = maps.loadCollisionData(start.map), t = maps.changeMapData(start.map);
        const residents = getPnjsForMap(start.map), key = (x, y) => `${x}:${y}`;
        const q = [[start.x, start.y]], parents = new Map([[key(start.x, start.y), null]]), goal = key(x, y);
        for (let i = 0; i < q.length && !parents.has(goal); i++) {
            const [cx, cy] = q[i];
            for (const [dx, dy, action] of [[1, 0, 'move_d'], [-1, 0, 'move_q'], [0, 1, 'move_s'], [0, -1, 'move_z']]) {
                const nx = cx + dx, ny = cy + dy, k = key(nx, ny);
                if (parents.has(k) || c[ny]?.[nx] !== 0 || t[ny][nx] || residents.some(p => p.block !== false && p.x === nx && (p.y === ny || p.y - 1 === ny))) continue;
                parents.set(k, { previous: key(cx, cy), x: nx, y: ny, action }); q.push([nx, ny]);
            }
        }
        assert(parents.has(goal), `${start.map}: no path to ${goal}`);
        const path = [];
        for (let k = goal; parents.get(k); k = parents.get(k).previous) path.unshift(parents.get(k));
        for (const p of path) {
            if ((start.map.startsWith('cave_') || ['route13', 'route14'].includes(start.map)) && !await page.evaluate(() => window.cavesVm.repelSteps > 0)) {
                const result = await page.evaluate(() => new Promise(resolve => {
                    const v = window.cavesVm;
                    v.socket.emit(v.isDrift ? 'drift:repel' : 'useRepel', { itemKey: 'max_repel' }, resolve);
                }));
                assert(result.success, result.message);
                await page.waitForFunction(() => window.cavesVm.repelSteps > 0);
            }
            await step(p.action, { map: start.map, x: p.x, y: p.y });
        }
    }
    await ready();
    assert.equal((await position()).map, 'ville4');
    await walk(13, 4);
    await step('move_z', { map: 'cave_rochebrume1', x: 13, y: 18 });
    for (let n = 1; n <= 3; n++) {
        await page.waitForTimeout(100);
        assert.equal(await page.evaluate(() => window.cavesVm.worldWeatherActive), false);
        assert.match(await page.locator('.location-name').innerText(), /Grottes de Rochebrume/);
        await capture(`cave${n}`);
        if (n < 3) {
            await walk(13, 1);
            await step('move_z', { map: `cave_rochebrume${n + 1}`, x: 13, y: 18 });
        }
    }
    if (await page.evaluate(() => !window.cavesVm.isDrift)) {
        const result = await page.evaluate(() => new Promise(resolve => window.cavesVm.socket.emit('requestGameSave', resolve)));
        assert(result.success);
    }
    const saved = await position();
    await page.reload({ waitUntil: 'networkidle' }); await ready(); assert.deepEqual(await position(), saved);
    await walk(13, 4);
    await step('move_z', { map: 'route13', x: 13, y: 18 });
    assert.match(await page.locator('.location-name').innerText(), /Route 13/);
    await capture('route13');
    await walk(13, 1);
    await step('move_z', { map: 'route14', x: 13, y: 18 });
    assert.match(await page.locator('.location-name').innerText(), /Route 14/);
    await capture('route14');
    if (await page.evaluate(() => !window.cavesVm.isDrift)) assert((await page.evaluate(() => new Promise(resolve => window.cavesVm.socket.emit('requestGameSave', resolve)))).success);
    const savedRoute = await position();
    await page.reload({ waitUntil: 'networkidle' }); await ready(); assert.deepEqual(await position(), savedRoute);
    await walk(13, 1);
    await step('move_z', { map: 'route14', x: 13, y: 0 });
    await page.waitForFunction(() => window.cavesVm.interactionNotice.includes('Route 14'));
    await walk(13, 18);
    await step('move_s', { map: 'route13', x: 13, y: 1 });
    await walk(13, 18);
    await step('move_s', { map: 'cave_rochebrume3', x: 13, y: 4 });
    await walk(13, 18);
    await step('move_s', { map: 'cave_rochebrume2', x: 13, y: 1 });
    await walk(13, 18);
    await step('move_s', { map: 'cave_rochebrume1', x: 13, y: 1 });
    await walk(13, 18);
    await step('move_s', { map: 'ville4', x: 13, y: 4 });
    assert.equal(await page.evaluate(() => window.cavesVm.mapWeather.kind), 'sandstorm');
    return { orderedThreeCaves: true, orderedRoutes13And14: true, roundTrip: true, dryInteriors: true, reconnect: true, finalExitClosed: true };
}
module.exports = { validateNorthCaves };
