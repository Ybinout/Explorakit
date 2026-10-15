const assert = require('node:assert/strict');
const path = require('node:path');

// Browser-only battle fixture: no combat command or reward is sent to the server.
async function validateMobileBattle(page, output, fit) {
    await page.evaluate(async () => {
        let node = document.querySelector('.game-stage');
        while (node && !node.__vue__) node = node.parentElement;
        const vm = node.__vue__;
        window.battleTestVm = vm;
        const pokemon = {
            uuid: 'mobile-battle-player', name: 'Bulbizarre', level: 6, k: 2,
            currentHp: 23, maxHp: 23, experience: 200, status: 'normal', passiveAbility: 'Overgrow',
            abilities: ['Tackle', 'Growl', 'Vine Whip', 'Growth'], movePp: [35, 40, 25, 20], data: { id: 1 },
        };
        vm.battle = true;
        await vm.$nextTick();
        const overlay = vm.$refs.battleOverlay;
        overlay.updateBattleState({
            player: { equipe: { pokemons: Array.from({ length: 6 }, (_, i) => ({ ...pokemon, uuid: 'fixture-' + i })) } },
            wildPokemon: { ...pokemon, uuid: 'mobile-battle-wild', name: 'Reptincel', truename: 'Reptincel', level: 12, currentHp: 36, maxHp: 36, data: { id: 5 } },
        });
        overlay.requestAction('Quelle est votre prochaine action ?');
    });
    await page.waitForFunction(() => {
        const images = [...document.querySelectorAll('.battle-sprite')];
        return images.length === 2 && images.every(img => img.complete && img.naturalWidth > 0
            && img.getAnimations().every(animation => animation.playState === 'finished'));
    });
    const measure = () => page.evaluate(() => {
        const rect = element => {
            const r = element.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
        };
        const sprites = ['player', 'wild'].map(side => {
            const img = document.querySelector('.battle-sprite-' + side + ' img');
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
            const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
            const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            let x0 = canvas.width, x1 = 0, y0 = canvas.height, y1 = 0;
            for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
                if (pixels[(y * canvas.width + x) * 4 + 3] > 8) {
                    x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1);
                    y0 = Math.min(y0, y); y1 = Math.max(y1, y + 1);
                }
            }
            const r = rect(img), scale = r.width / canvas.width;
            return { side, x: r.x + x0 * scale, y: r.y + y0 * scale,
                right: r.x + x1 * scale, bottom: r.y + y1 * scale };
        });
        return {
            scene: rect(document.querySelector('.battle-scene')), sprites,
            obstacles: [...document.querySelectorAll('.battle-status, .battle-action-shell')].map(rect),
            documentHeight: document.documentElement.scrollHeight,
        };
    });
    const formats = [[393, 852], [320, 568], [320, 480], [844, 390], [740, 320], [1024, 768], [393, 700]];
    for (const [width, height] of formats) {
        await page.setViewportSize({ width, height });
        await page.locator('.battle').evaluate(el => { el.style.padding = ''; });
        for (const selector of ['.battle', '.battle-scene', '.battle-action-shell', '.battle-status-wild', '.battle-status-player', '.battle-turn-indicator', '.battle-sound-toggle']) {
            await fit(page, selector, width, height);
        }
        const layout = await measure();
        assert(layout.documentHeight <= height + 1, 'Combat makes the page scroll');
        for (const sprite of layout.sprites) {
            assert(sprite.x >= layout.scene.x && sprite.y >= layout.scene.y
                && sprite.right <= layout.scene.right && sprite.bottom <= layout.scene.bottom - 8,
            `${width}x${height}: ${sprite.side} is clipped by the scene`);
            for (const obstacle of layout.obstacles) {
                const overlaps = sprite.x < obstacle.right && sprite.right > obstacle.x
                    && sprite.y < obstacle.bottom && sprite.bottom > obstacle.y;
                assert(!overlaps, `${width}x${height}: ${sprite.side} is covered by the interface`);
            }
        }
        for (const button of await page.locator('.battle-main-btn, .battle-sound-toggle').all()) {
            const r = await button.boundingBox();
            const layout = await button.evaluate(el => ({ width: el.offsetWidth, height: el.offsetHeight }));
            // A fractional hover translation can report 43.999984 px for a 44 px button.
            assert(layout.width >= 44 && layout.height >= 44 && r.width >= 43.99 && r.height >= 43.99,
                `${width}x${height}: combat target ${await button.getAttribute('class')} measures ${r.width}x${r.height}`);
        }
        await page.screenshot({ path: path.join(output, `battle-mobile-${width}x${height}.png`) });
        await page.locator('.action-attack').tap();
        assert.equal(await page.locator('.battle-grid-attacks .battle-choice-btn').count(), 4);
        await fit(page, '.battle-grid-attacks', width, height);
        await page.locator('.action-pokemon').tap();
        const last = page.locator('.battle-pokemon-choice').last();
        await last.scrollIntoViewIfNeeded();
        const bottom = await last.boundingBox(), display = await page.locator('.battle-action-display').boundingBox();
        assert(bottom.y + bottom.height <= display.y + display.height + 1, 'Sixth Pokémon is unreachable');
        await page.locator('.action-bag').tap();
        await page.locator('.battle-grid-bag').waitFor();
        await fit(page, '.battle-grid-bag', width, height);
        await page.evaluate(() => window.battleTestVm.$refs.battleOverlay.requestAction('Quelle est votre prochaine action ?'));
    }
    // Browser chrome changes the available height; safe-area padding must leave controls reachable.
    await page.setViewportSize({ width: 393, height: 700 });
    await page.locator('.battle').evaluate(el => { el.style.padding = '24px 0 34px'; });
    await fit(page, '.battle-action-shell', 393, 666);
    const geometry = await measure();
    const wild = geometry.sprites.find(sprite => sprite.side === 'wild');
    const target = { x: (wild.x + wild.right) / 2, y: (wild.y + wild.bottom) / 2 };
    const move = await page.evaluate(() => {
        const overlay = window.battleTestVm.$refs.battleOverlay;
        overlay.playMoveAnimation({ actor: 'player', moveName: 'Water Gun', moveType: 'Water', damageClass: 'special' });
        const scene = overlay.$refs.battleScene.getBoundingClientRect();
        return { x: scene.x + overlay.movePath.targetX, y: scene.y + overlay.movePath.targetY };
    });
    assert(Math.abs(move.x - target.x) < 2 && Math.abs(move.y - target.y) < 2, 'Attack misses the visible Pokémon');
    await page.evaluate(() => window.battleTestVm.$refs.battleOverlay.playCaptureAnimation({
        itemKey: 'superball', itemName: 'Super Ball', success: true, shakes: 3, wildPokemonName: 'Reptincel',
    }));
    await page.waitForFunction(() => window.battleTestVm.$refs.battleOverlay.captureFx.state === 'absorb');
    const ball = await page.locator('.capture-fx-ball').boundingBox();
    assert(Math.abs(ball.x + ball.width / 2 - target.x) < 3 && Math.abs(ball.y + ball.height / 2 - target.y) < 3,
        'Capture ball misses the visible Pokémon');
    await page.screenshot({ path: path.join(output, 'battle-mobile-capture.png') });
    const experience = await require('./validateExperienceUi').validateExperienceUi(page, output);
    await page.evaluate(() => {
        window.battleTestVm.battle = false;
        delete window.battleTestVm;
    });
    await page.locator('.mobile-dpad').waitFor();
    return { experience, formats: formats.length, spritesUnobstructed: true, menus: true, attackAndCaptureTargets: true };
}

module.exports = { validateMobileBattle };
