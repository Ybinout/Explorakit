const assert = require('node:assert/strict');
const path = require('node:path');

// Real image requests are held; no application method or wait implementation is stubbed.
async function validateComputerOpeningUi(page, output, ready) {
    let held = true, intercepted = 0;
    const pending = [];
    const pattern = '**/img/pokemon/front/280.png';
    const handler = async route => {
        intercepted++;
        if (held) await new Promise(resolve => pending.push(resolve));
        await route.continue().catch(() => {});
    };
    const release = () => { held = false; pending.splice(0).forEach(resolve => resolve()); };
    const loader = page.locator('[data-pc-loading]');
    const start = async ({ reload = false } = {}) => {
        if (reload) {
            held = true; intercepted = 0;
            await page.reload({ waitUntil: 'networkidle' });
            await ready();
        }
        await page.evaluate(() => window.pcVm.espace());
        await loader.waitFor();
        await page.evaluate(() => { window.openingPc = document.querySelector('.pc-container').__vue__; });
    };
    const loaded = async () => {
        await loader.waitFor({ state: 'hidden' });
        assert.equal(await page.locator('.pc-body').getAttribute('inert'), null);
        assert.notEqual(await page.locator('.pc-terminal').getAttribute('aria-busy'), 'true');
        assert.equal(await page.locator('.pc-body').evaluate(el => getComputedStyle(el).visibility), 'visible');
    };
    await page.route(pattern, handler);
    try {
        await start();
        await page.waitForTimeout(200);
        assert(intercepted > 0, 'The cold box image must be requested');
        assert(await loader.isVisible());
        assert.equal(await page.locator('.pc-terminal').getAttribute('aria-busy'), 'true');
        assert.equal(await page.locator('.pc-body').evaluate(el => el.inert), true);
        assert.equal(await page.locator('.pc-body').evaluate(el => getComputedStyle(el).visibility), 'hidden');
        for (const key of ['Tab', 'Shift+Tab']) {
            await page.keyboard.press(key);
            assert(await page.locator('.pc-close').evaluate(el => el === document.activeElement));
        }
        await page.screenshot({ path: path.join(output, 'pc-opening-mobile.png') });
        await page.setViewportSize({ width: 1365, height: 900 });
        await page.waitForTimeout(100);
        await page.evaluate(() => { window.pcVm.showMobileControls = false; });
        await page.screenshot({ path: path.join(output, 'pc-opening-desktop.png') });
        release();
        await loaded();
        assert(await page.locator('.pc-body img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0)));
        await page.locator('.pc-close').click();
        // Cached reopening still has a short, bounded entrance.
        await start(); await loaded(); await page.locator('.pc-close').click();
        await page.setViewportSize({ width: 393, height: 852 });
        await page.waitForTimeout(100);
        // Escape while a new request is pending cancels every old continuation.
        await start({ reload: true });
        await page.evaluate(() => { window.cancelledPcOpening = window.openingPc._openingController; });
        await page.keyboard.press('Escape');
        await page.locator('.pc-terminal').waitFor({ state: 'hidden' });
        assert(await page.evaluate(() => window.cancelledPcOpening.signal.aborted));
        release(); await page.waitForTimeout(300);
        assert.equal(await page.locator('.pc-terminal').count(), 0);
        // An unavailable image cannot trap the player indefinitely.
        await start({ reload: true });
        await loaded();
        assert(pending.length > 0);
        await page.locator('.pc-close').click(); release();
        // Reduced motion still waits for images, without a decorative animation.
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await start({ reload: true });
        assert.equal(await page.locator('.pc-loading-track i').evaluate(el => getComputedStyle(el).animationName), 'none');
        await page.evaluate(() => {
            window.hiddenPcOpening = window.openingPc._openingController;
            Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
            document.dispatchEvent(new Event('visibilitychange'));
        });
        assert(await page.evaluate(() => window.hiddenPcOpening.signal.aborted));
        await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
        assert(await loader.isVisible());
        release(); await loaded(); await page.locator('.pc-close').click();
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        return { coldAssetsMasked: true, decodedBeforeReveal: true, closeAndFocus: true,
            cachedReopening: true, escapeCancels: true, boundedTimeout: true,
            reducedMotion: true, hiddenTabCancelsAndResumes: true, desktopAndMobile: true };
    } finally {
        release();
        await page.unroute(pattern, handler);
        await page.emulateMedia({ reducedMotion: 'no-preference' });
    }
}
module.exports = { validateComputerOpeningUi };
