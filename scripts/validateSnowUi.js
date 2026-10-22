const assert = require('node:assert/strict');

async function validateSnowUi(page, { capture, label }) {
    await page.waitForFunction(() => window.snowVm?._worldWeather?.frames > 1);
    const map = await page.evaluate(() => window.snowVm.map);
    assert(['route13', 'route14'].includes(map));
    assert.deepEqual(await page.evaluate(() => window.snowVm.effectiveWorldWeather), { wind: 2, rain: 0, snow: 3 });
    assert.equal(await page.evaluate(() => window.snowVm.mapWeather.kind), 'snow');
    assert.deepEqual(await page.evaluate(() => window.snowVm._worldWeather.budget), { rain: 0, leaves: 0, gusts: 3, splashes: 0, snow: 480 });
    const pixels = await page.evaluate(map => {
        const r = new window.snowVm._worldWeather.constructor(), profile = { wind: 2, rain: 0, snow: 3 };
        r.prepare(300, profile, true, map); const a = r.context.getImageData(0, 0, 896, 640).data;
        r.prepare(1500, profile, true, map); const b = r.context.getImageData(0, 0, 896, 640).data;
        let moved = 0, maxAlpha = 0, sumAlpha = 0, flakes = 0;
        for (let i = 0; i < a.length; i += 4) {
            maxAlpha = Math.max(maxAlpha, a[i + 3]); sumAlpha += a[i + 3];
            if (a[i + 3] > 100) flakes++;
            if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) moved++;
        }
        r.destroy(); return { moved, maxAlpha, meanAlpha: sumAlpha / (896 * 640), flakes };
    }, map);
    assert(pixels.maxAlpha > 160 && pixels.meanAlpha < 22 && pixels.moved > 2500 && pixels.flakes > 1000, JSON.stringify(pixels));
    const before = await page.evaluate(() => window.snowVm._worldWeather.frames);
    await page.waitForTimeout(500);
    const frames = await page.evaluate(() => window.snowVm._worldWeather.frames);
    assert(frames > before && frames - before <= 20, 'cached animation is limited to 30 Hz');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => window.snowVm.worldWeatherReducedMotion); await page.waitForTimeout(100);
    const frozen = await page.evaluate(() => window.snowVm._worldWeather.frames);
    await page.waitForTimeout(200); assert.equal(await page.evaluate(() => window.snowVm._worldWeather.frames), frozen);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await capture(label);
    return pixels;
}
module.exports = { validateSnowUi };
