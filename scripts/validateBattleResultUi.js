const assert = require('node:assert/strict');
const path = require('node:path');
const { viewports } = require('./validateJournalUi');

// Presentation fixtures run in the release runner's isolated account, without battle commands.
async function showResult(page, result) {
    await page.evaluate(result => {
        const vm = document.querySelector('.game-root').__vue__;
        vm.releaseAllMovementKeys();
        vm.lock = true;
        vm.battleResult = result;
    }, result);
    await page.locator('[data-battle-result]').waitFor();
}

async function assertResultMode(page, mode, explorationActive) {
    await showResult(page, { outcome: 'fled', mode: mode === 'Aventure' ? 'adventure' : 'drift' });
    assert.match(await page.locator('.result-kicker').innerText(), new RegExp(mode));
    assert.equal(await page.locator('.result-timer').count(), explorationActive ? 1 : 0);
    await page.locator('[data-battle-result-continue]').click();
    await page.locator('[data-battle-result]').waitFor({ state: 'hidden' });
}

async function validateBattleResultUi(page, output, fit) {
    const experience = [94, 3, 6, 9, 25, 149].map((pokemonId, index) => ({
        uuid: `result-${index}`, pokemonId,
        name: index ? 'Compagnon au nom très long' : 'Ectoplasma',
        previousLevel: 12, level: index ? 12 : 13, xpGained: index ? 240 : 600
    }));
    const scenarios = [
        { outcome: 'fled' },
        { outcome: 'victory', experience, money: 180, loot: ['Potion', 'Rift de vitesse'] },
        { outcome: 'captured', capturedPokemon: { pokemonId: 19, name: 'Rattata', level: 7 }, experience: [experience[0]], money: 30 },
        { outcome: 'defeat', lostPokemon: [{ uuid: 'lost', name: 'Salamèche', level: 14 }], recoveryMessage: 'Ton équipe a été soignée au Centre Pokémon.' },
        { outcome: 'draw' },
        { outcome: 'interrupted', reason: 'timer' }
    ];
    for (const [width, height] of viewports) {
        await page.setViewportSize({ width, height });
        for (const result of scenarios) {
            await showResult(page, { ...result, mode: 'adventure' });
            const panel = page.locator('[data-battle-result]');
            const next = page.locator('[data-battle-result-continue]');
            await fit(page, '[data-battle-result]', width, height);
            await fit(page, '[data-battle-result-continue]', width, height);
            assert.equal(await panel.getAttribute('data-outcome'), result.outcome);
            assert.deepEqual(await panel.evaluate(el => {
                const css = getComputedStyle(el);
                return { paper: css.backgroundColor, font: css.fontFamily, overflow: el.scrollWidth > el.clientWidth + 1 };
            }), { paper: 'rgb(237, 245, 252)', font: 'Arial, Helvetica, sans-serif', overflow: false });
            assert(await next.evaluate(el => el === document.activeElement), 'Continue receives focus');
            assert((await next.boundingBox()).height >= 44);
            assert(!/Prends un instant|Une rencontre de plus|Tu as quitté le combat/.test(await panel.innerText()));
            assert.equal(await panel.locator('.result-content').count(), ['victory', 'captured', 'defeat'].includes(result.outcome) ? 1 : 0);
            assert.equal(await panel.locator('.experience-value').count(), result.experience?.length || 0);
            assert.equal(await panel.locator('.result-money').count(), result.money ? 1 : 0);
            if (result.outcome === 'fled') {
                assert((await panel.boundingBox()).height < 200, 'Empty summary stays compact');
                // A late blackout message must still appear after the panel was mounted empty.
                await page.evaluate(() => {
                    const vm = document.querySelector('.game-root').__vue__;
                    vm.$set(vm.battleResult, 'recoveryMessage', 'Ton équipe a été soignée.');
                });
                await page.locator('.result-recovery').waitFor();
                await page.evaluate(() => { document.querySelector('.game-root').__vue__.$delete(document.querySelector('.game-root').__vue__.battleResult, 'recoveryMessage'); });
            }
            if (result.outcome === 'victory') {
                const content = panel.locator('.result-content');
                await page.keyboard.press('Tab');
                assert(await content.evaluate(el => el === document.activeElement));
                await page.keyboard.press('Shift+Tab');
                assert(await next.evaluate(el => el === document.activeElement));
                await content.evaluate(el => { el.scrollTop = el.scrollHeight; });
                await fit(page, '.result-money', width, height);
                await content.evaluate(el => { el.scrollTop = 0; });
            } else {
                await page.keyboard.press('Tab');
                assert(await panel.evaluate(el => el.contains(document.activeElement)), 'Focus remains in dialog');
                await next.focus();
            }
            await page.screenshot({ path: path.join(output, `battle-result-${result.outcome}-${width}.png`) });
            const describedBy = await panel.getAttribute('aria-describedby');
            assert.equal(describedBy, ['defeat', 'interrupted'].includes(result.outcome) ? 'battle-result-description' : null);
            if (result.outcome === 'fled') await page.keyboard.press('Escape');
            else await next.click();
            await panel.waitFor({ state: 'hidden' });
        }
    }
    return { outcomes: scenarios.length, viewports: viewports.length, compactEmptySummary: true, rewards: true, focus: true, lateRecovery: true, sharedPalette: true };
}

module.exports = { validateBattleResultUi, assertResultMode };
