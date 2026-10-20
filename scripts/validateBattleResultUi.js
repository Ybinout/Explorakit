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
    assert.match(await page.locator('.result-kicker').textContent(), new RegExp(mode));
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
                assert((await panel.boundingBox()).height < 260, 'Empty summary stays compact');
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
    for (const color of ['blue', 'sage', 'lavender', 'sand']) for (const mode of ['light', 'dark']) {
        await page.setViewportSize({ width: 393, height: 852 });
        await page.evaluate(({color,mode})=>{const vm=document.querySelector('.game-root').__vue__;vm.updatePreferences({...vm.preferences,themeColor:color,themeMode:mode});},{color,mode});
        await showResult(page,{outcome:'fled',mode:'adventure'});
        await fit(page,'[data-battle-result]',393,852);
        const style=await page.locator('[data-battle-result]').evaluate(el=>{
            const header=el.querySelector('.result-heading'),button=el.querySelector('[data-battle-result-continue]');
            const contrast=(ink,paper)=>{
                const lum=rgb=>rgb.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
                const a=lum(ink),b=lum(paper);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
            };
            const h=getComputedStyle(header),b=getComputedStyle(button);
            return {titleFont:getComputedStyle(el.querySelector('h2')).fontFamily,frame:getComputedStyle(el).borderTopWidth,headerContrast:contrast(h.color,h.backgroundColor),buttonContrast:contrast(b.color,b.backgroundColor),headerBackground:h.backgroundColor};
        });
        assert.match(style.titleFont,/Georgia/);assert.equal(style.frame,'2px');
        assert(style.headerContrast>=4.5 && style.buttonContrast>=4.5,JSON.stringify(style));
        if(mode==='dark')assert.notEqual(style.headerBackground,'rgb(241, 247, 252)');
        await page.screenshot({path:path.join(output,`battle-result-character-${color}-${mode}-393.png`)});
        await page.locator('[data-battle-result-continue]').click();
        await page.locator('[data-battle-result]').waitFor({state:'hidden'});
    }
    await page.evaluate(()=>{const vm=document.querySelector('.game-root').__vue__;vm.updatePreferences({...vm.preferences,themeColor:'blue',themeMode:'light'});});
    return { themes:8, expressiveFrame:true, outcomes: scenarios.length, viewports: viewports.length, compactEmptySummary: true, rewards: true, focus: true, lateRecovery: true, sharedPalette: true };
}

module.exports = { validateBattleResultUi, assertResultMode };
