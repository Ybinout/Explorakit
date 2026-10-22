const assert = require('node:assert/strict');

async function validateBlanchecime(page, { walk, step, position, capture }) {
    assert.match(await page.locator('.location-name').innerText(), /Blanchecime/);
    assert.equal(await page.evaluate(() => window.cavesVm.worldWeatherActive), false);
    await capture('blanchecime');
    async function talk(name) {
        await page.evaluate(() => { const v = window.cavesVm; v.preferences.textSpeed = 10000; v.socket.emit('Space'); });
        await page.waitForFunction(n => window.cavesVm.endSentences === n && window.cavesVm.textImageSequence.length > 0, name);
        await page.evaluate(() => window.cavesVm.clearSequence());
    }
    for (const [x, y, map] of [[4, 6, 'centre'], [22, 6, 'ville5_shop'], [13, 7, 'ville5_arene'], [3, 16, 'ville5_maison1'], [23, 16, 'ville5_maison2']]) {
        await walk(x, y + 1);
        await step('move_z', { map, x: 13, y: map === 'centre' ? 14 : 16 });
        if (map === 'centre') {
            await walk(9, 10);
            await page.evaluate(() => { window.city5Heal = null; window.cavesVm.socket.once('teamStateChanged', s => window.city5Heal = s); });
            await talk('centre');
            await page.waitForFunction(() => window.city5Heal?.equipe?.pokemons?.every(p => p.currentHp === p.maxHp));
            await walk(17, 9); await page.setViewportSize({ width: 393, height: 852 });
            await page.evaluate(() => window.cavesVm.showMobileControls = true);
            await page.locator('.mobile-action-a').click(); await page.locator('.pc-terminal').waitFor();
            assert.equal(await page.locator('.pc-box-slot').count(), 30); await page.locator('.pc-close').click();
        } else if (map === 'ville5_shop') {
            await page.locator('.location-shop-btn').click(); await page.locator('.shop-item').first().waitFor();
            await page.waitForFunction(() => !window.cavesVm.shop.loading);
            const before = await page.evaluate(() => { const v = window.cavesVm; return { item: v.shop.catalog.find(i => i.key === 'pokeball'), money: v.shop.money, q: v.bagItems.find(i => i.key === 'pokeball')?.quantity || 0 }; });
            assert(before.money >= before.item.price);
            await page.locator('.shop-item').filter({ has: page.getByText(before.item.name, { exact: true }) }).locator('.shop-buy-controls button').click();
            await page.waitForFunction(q => !window.cavesVm.shop.loading && !window.cavesVm.shop.error && (window.cavesVm.bagItems.find(i => i.key === 'pokeball')?.quantity || 0) === q + 1, before.q);
            assert.equal(await page.evaluate(() => window.cavesVm.shop.money), before.money - before.item.price);
            await page.locator('.shop-close').click();
        } else {
            await walk(13, map === 'ville5_arene' ? 7 : 9);
            await talk(map === 'ville5_arene' ? 'blanchecime_arene' : map === 'ville5_maison1' ? 'blanchecime_habitant1' : 'blanchecime_habitant2');
            await capture(map);
        }
        await walk(13, map === 'centre' ? 14 : 16);
        await step('move_s', { map: 'ville5', x, y: y + 1 });
        assert.deepEqual(await position(), { map: 'ville5', x, y: y + 1 });
    }
}
module.exports = { validateBlanchecime };
