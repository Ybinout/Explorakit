const assert = require('node:assert/strict');
const path = require('node:path');

// Browser-only frames on the combat recipe's isolated account. No battle commands or rewards.
async function validateBattleEntranceUi(page, output) {
    const held = [];
    let hold = false;
    const pattern = '**/*entry-probe=*';
    const release = () => held.splice(0).forEach(resolve => resolve());
    await page.route(pattern, async route => {
        if (hold || route.request().url().includes('entry-probe=abort-old')) await new Promise(resolve => held.push(resolve));
        await route.continue().catch(() => {});
    });
    await page.evaluate(() => {
        const b = window.combatVm.$refs.battleOverlay;
        window.entrySpriteOriginal = b.getPokemonSprite;
        b.getPokemonSprite = function(pokemon, side) { return window.entrySpriteOriginal(pokemon, side) + '?entry-probe=' + window.entryProbe; };
        window.startEntryFixture = label => {
            window.entryProbe = label;
            const vm = window.combatVm, b = vm.$refs.battleOverlay;
            const pokemon = (uuid, id) => ({ uuid, name: uuid, data: { id }, level: 12, k: 2, currentHp: 40, maxHp: 40, experience: 1700, abilities: ['Tackle'], movePp: [35] });
            vm.socket.listeners('battletrigger').forEach(fn => fn({ musicKind: 'wild', field: { weather: null } }));
            vm.socket.listeners('introAnimation').forEach(fn => fn({ player: { equipe: { pokemons: [pokemon(label, 7)] } }, wildPokemon: pokemon('opponent', 19) }));
            vm.socket.listeners('requestAction').forEach(fn => fn({ message: 'Choisis ton action.' }));
            b.presentEvent('showMessage', label + '-after-entry');
        };
    });
    const start = label => page.evaluate(label => window.startEntryFixture(label), label);
    const ready = async () => {
        await page.locator('[data-battle-entrance]').waitFor({ state: 'hidden' });
        await page.locator('.action-attack:enabled').waitFor();
    };
    const assertImages = async () => assert(await page.locator('.battle-background, .battle-sprite, .battle-platform img').evaluateAll(images => images.length >= 3 && images.every(image => image.complete && image.naturalWidth > 0)), 'Scene was revealed before its images');
    try {
        for (const [width, height] of [[320,568],[393,852],[844,390],[1365,900]]) {
            await page.setViewportSize({ width, height });
            await page.evaluate(width => { window.combatVm.showMobileControls = width <= 920; }, width);
            hold = true;
            await start('slow-' + width);
            await page.locator('[data-battle-entrance][data-phase="holding"]').waitFor();
            await page.waitForTimeout(650);
            assert(held.length >= 2, 'Cold fighter images were not intercepted');
            assert.equal(await page.locator('.battle-scene').evaluate(el => getComputedStyle(el).visibility), 'hidden');
            assert(await page.locator('.action-attack').isDisabled());
            assert(await page.locator('.battle-action-shell').evaluate(el => el.inert));
            const cover = await page.locator('[data-battle-entrance]').boundingBox();
            assert(cover.x >= 0 && cover.y >= 0 && cover.x + cover.width <= width + 1 && cover.y + cover.height <= height + 1);
            await page.screenshot({ path: path.join(output, `battle-entrance-holding-${width}.png`) });
            hold = false; release();
            await page.locator('[data-battle-entrance][data-phase="revealing"]').waitFor();
            await assertImages();
            assert(await page.locator('.action-attack').isDisabled());
            await page.waitForTimeout(140);
            await page.screenshot({ path: path.join(output, `battle-entrance-revealing-${width}.png`) });
            await ready(); await assertImages();
            assert.match(await page.locator('.battle-text-box').first().innerText(), new RegExp('slow-' + width + '-after-entry'));
        }
        // Re-select the landscape picture while the fighter downloads are still pending.
        await page.setViewportSize({ width: 393, height: 852 });
        await page.evaluate(() => { window.combatVm.showMobileControls = true; });
        hold = true; await start('rotation');
        await page.locator('[data-battle-entrance]').waitFor();
        await page.setViewportSize({ width: 844, height: 390 });
        hold = false; release(); await ready(); await assertImages();
        // Keep a stalled request past the deadline; it must never freeze the battle indefinitely.
        hold = true;
        await start('timeout');
        await ready();
        assert(held.length >= 2);
        hold = false; release();
        await page.waitForFunction(() => [...document.querySelectorAll('.battle-sprite')].every(image => image.complete));
        assert.equal(await page.locator('[data-battle-entrance]').count(), 0);
        // Reset while assets are pending; late loads/queued messages cannot affect the new encounter.
        await start('abort-old');
        await page.waitForFunction(() => window.combatVm.$refs.battleOverlay.entrancePhase === 'holding');
        await page.waitForTimeout(100);
        await start('abort-new'); await ready(); release();
        assert.equal(await page.evaluate(() => window.combatVm.$refs.battleOverlay.currentPokemon.uuid), 'abort-new');
        assert(!/abort-old/.test(await page.locator('.battle-text-box').first().innerText()));
        // Both system and in-game reduced motion keep the loading guard, without moving shutters.
        for (const system of [true, false]) {
            await page.emulateMedia({ reducedMotion: system ? 'reduce' : 'no-preference' });
            await page.evaluate(system => { window.combatVm.preferences.animationsEnabled = system; }, system);
            hold = true; await start(system ? 'reduced-system' : 'reduced-game');
            await page.locator('[data-battle-entrance]').waitFor();
            assert.equal(await page.locator('.entrance-ball').evaluate(el => getComputedStyle(el).animationName), 'none');
            assert(await page.locator('.entrance-shutter-top').evaluate(el => parseFloat(getComputedStyle(el).transitionDuration) <= 0.001));
            hold = false; release(); await ready();
        }
        await page.evaluate(() => { window.combatVm.preferences.animationsEnabled = true; });
        // A hidden tab releases the wait and cannot replay the cover on return.
        hold = true; await start('hidden');
        await page.locator('[data-battle-entrance]').waitFor();
        await page.evaluate(() => {
            Object.defineProperty(document, 'hidden', { configurable: true, value: true });
            document.dispatchEvent(new Event('visibilitychange'));
        });
        await ready(); hold = false; release();
        await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
        assert.equal(await page.locator('[data-battle-entrance]').count(), 0);
        return { viewports: 4, coldImages: true, decodedBeforeReveal: true, commandsAfterEntry: true, rotation: true, boundedWait: true, reset: true, reducedMotion: true, hidden: true };
    } finally {
        hold = false; release();
        await page.unroute(pattern);
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.evaluate(() => {
            const vm = window.combatVm, b = vm.$refs.battleOverlay;
            b.getPokemonSprite = window.entrySpriteOriginal;
            b.resetBattleUi(); vm.battle = false; vm.lock = false; vm.preferences.animationsEnabled = true;
            delete document.hidden;
            delete window.startEntryFixture; delete window.entrySpriteOriginal; delete window.entryProbe;
        });
    }
}
module.exports = { validateBattleEntranceUi };
