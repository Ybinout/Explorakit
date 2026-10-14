const assert = require('node:assert/strict');
const path = require('node:path');

const viewports = [[1365, 900], [390, 844], [320, 568], [844, 390]];

async function validateJournalUi(page, output, fit) {
    // UI fixtures below are browser-only; the release runner owns the isolated test account.
    await page.evaluate(() => {
        let node = document.querySelector('.game-stage');
        while (node && !node.__vue__) node = node.parentElement;
        window.journalTestVm = node.__vue__;
    });
    const close = async () => {
        await page.evaluate(() => {
            const vm = window.journalTestVm;
            vm.closeLegacyPanels();
            vm.closeInfoPanel();
            vm.isMenuOpen = false;
            vm.selectedPokemonUuid = null;
            vm.shop.visible = false;
            vm.textImageSequence = [];
        });
    };
    const open = async (key) => {
        await close();
        await page.locator('.menu-toggle-btn').click();
        await page.locator(`[data-menu-action="${key}"]`).click();
    };
    const capture = async (name, width) => page.screenshot({ path: path.join(output, `journal-${name}-${width}.png`) });
    for (const [width, height] of viewports) {
        await close();
        await page.setViewportSize({ width, height });
        await fit(page, '.world-toolbar', width, height);
        await fit(page, '.location-banner', width, height);
        await page.locator('.menu-toggle-btn').click();
        await fit(page, '.menu-dropdown', width, height);
        assert.equal(await page.locator('.menu-toggle-btn').getAttribute('aria-expanded'), 'true');
        // The last item remains reachable even on a short landscape screen.
        await page.locator('[data-menu-action="options"]').scrollIntoViewIfNeeded();
        await page.locator('[data-menu-action="pokedex"]').scrollIntoViewIfNeeded();
        for (const button of await page.locator('.menu-dropdown-item').all()) {
            assert((await button.boundingBox()).height >= 44, 'Menu target is too small');
        }
        assert.equal(await page.locator('.mobile-controls-shell').count(), 0, 'Controls cover the menu');
        await capture('menu', width);
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('.menu-dropdown').count(), 0);

        await open('pokedex');
        await fit(page, '.dex', width, height);
        const reference = await page.locator('.dex').evaluate((el) => ({
            paper: getComputedStyle(el).backgroundColor,
            font: getComputedStyle(el).fontFamily,
        }));
        await page.locator('.dex-search input').fill('Carapuce');
        await page.waitForFunction(() => document.querySelectorAll('.dex-entry').length === 1);
        await capture('pokedex', width);
        await page.keyboard.press('Escape');

        for (const [key, selector, closeSelector] of [
            ['bag', '.bag-panel', '.panel-close'],
            ['appearance', '.appearance-panel', '.panel-close'],
            ['pokemon', '.team-panel', '.team-close'],
            ['progress', '.info-panel', '.close-button'],
            ['save', '.info-panel', '.close-button'],
            ['options', '.info-panel', '.close-button'],
        ]) {
            await open(key);
            await fit(page, selector, width, height);
            const panel = page.locator(selector);
            assert.deepEqual(await panel.evaluate((el) => ({
                paper: getComputedStyle(el).backgroundColor,
                font: getComputedStyle(el).fontFamily,
            })), reference, 'Panel must share the Pokédex surface and typography');
            assert.equal(await page.locator('.mobile-controls-shell').count(), 0);
            assert(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), `${key} overflows`);
            await capture(key, width);
            if (key === 'pokemon') {
                await page.locator('.team-row-visual').first().click();
                await fit(page, '.companion-sheet', width, height);
                await page.getByRole('tab', { name: 'Entraînement' }).click();
                await capture('companion', width);
                await page.locator('.companion-close').click();
            }
            if (key === 'options') {
                const language = page.locator('.option-row select').last();
                await language.selectOption('en');
                assert.match(await page.locator('.info-header h2').innerText(), /Options/);
                await language.selectOption('fr');
            }
            await panel.locator(closeSelector).click();
            assert.equal(await panel.count(), 0, `${key} did not close`);
        }
        // Exercise a long city/shop label and a populated shop without moving a real player.
        await page.evaluate(() => {
            const vm = window.journalTestVm;
            vm.journalOriginalMap = vm.map;
            vm.map = 'ville1_shop';
            vm.shop = {
                visible: true, money: 1200, loading: false, error: '',
                catalog: Array.from({ length: 8 }, (_, i) => ({
                    key: `visual-${i}`, name: i ? 'Super Potion' : 'Potion', price: 200,
                    description: 'Rend des points de vie à un Pokémon de ton équipe.'
                }))
            };
        });
        await fit(page, '.location-banner', width, height);
        await fit(page, '.shop-card', width, height);
        const lastItem = page.locator('.shop-item').last();
        await lastItem.scrollIntoViewIfNeeded();
        await lastItem.locator('select').selectOption('10');
        assert(await lastItem.locator('button').isDisabled(), 'Insufficient funds must remain visible');
        await page.locator('.shop-item').first().scrollIntoViewIfNeeded();
        await capture('shop', width);
        await page.locator('.shop-close').click();
        assert(await page.locator('.location-name').evaluate((el) => el.scrollWidth <= el.clientWidth + 1), 'Location name is truncated');
        assert.equal(await page.locator('.adventure-guide').count(), 0, 'Objective must stay inside the menu');
        await capture('location', width);
        await page.evaluate(() => {
            const vm = window.journalTestVm;
            vm.map = vm.journalOriginalMap;
            vm.preferences.textSpeed = 10000;
            vm.updateTextImageSequence([{
                text: 'Bienvenue ! Prends le temps d’explorer la ville et de parler à ses habitants. Ton prochain objectif t’attend dans le carnet d’aventure.',
                imageName: 'townspeople.png', portraitFrame: { columns: 8, rows: 4, index: 31 }
            }]);
        });
        await fit(page, '.text-with-image', width, height);
        await capture('dialogue', width);
    }
    await close();
    await page.evaluate(() => { delete window.journalTestVm; });
    return { panels: 7, viewports: viewports.length, shopAndDialogue: true, consistentTheme: true };
}

module.exports = { validateJournalUi, viewports };
