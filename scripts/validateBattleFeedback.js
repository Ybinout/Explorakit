const assert = require('node:assert/strict');
const path = require('node:path');

async function validateBattleLabels(page, width, height, output) {
    for (const actor of ['player', 'opponent']) {
        await page.evaluate(async actor => {
            const overlay = window.battleTestVm.$refs.battleOverlay;
            overlay.playMoveResult({ actor, critical: true, effectiveness: 2 });
            await overlay.$nextTick();
            for (const el of document.querySelectorAll('.battle-result-chip')) {
                for (const animation of el.getAnimations()) { animation.pause(); animation.currentTime = 300; }
            }
        }, actor);
        const box = await page.locator('.battle-result-fx').boundingBox();
        const scene = await page.locator('.battle-scene').boundingBox();
        assert(box.x >= scene.x && box.y >= scene.y && box.x + box.width <= scene.x + scene.width + 1
            && box.y + box.height <= scene.y + scene.height + 1, `${width}x${height}: result labels clipped`);
        const layers = await page.evaluate(() => ({
            result: Number(getComputedStyle(document.querySelector('.battle-result-fx')).zIndex),
            others: [...document.querySelectorAll('.battle-sprite-anchor, .battle-status, .battle-damage-text')].map(el => Number(getComputedStyle(el).zIndex)),
            visible: [...document.querySelectorAll('.battle-result-chip')].every(el => Number(getComputedStyle(el).opacity) === 1),
        }));
        assert(layers.visible && layers.others.every(z => z < layers.result), 'Critical/effectiveness must paint above sprites and cards');
        if (width === 393 || width === 320 || width === 1365) await page.screenshot({ path: path.join(output, `battle-labels-${width}x${height}-${actor}.png`) });
    }
    await page.evaluate(() => { window.battleTestVm.$refs.battleOverlay.resultFx.visible = false; });
}

async function validateBattleAudio(page) {
    // A trusted tap unlocks the actual browser AudioContext, not a mocked player.
    await page.locator('.action-attack').tap();
    await page.waitForFunction(() => window.battleTestVm.$refs.battleOverlay._battleAudio.context?.state === 'running');
    const samples = await page.evaluate(async () => {
        const overlay = window.battleTestVm.$refs.battleOverlay, audio = overlay._battleAudio;
        audio.stop();
        const analyser = audio.context.createAnalyser(); analyser.fftSize = 2048;
        audio.output.connect(analyser);
        const sample = async payload => {
            overlay.playMoveAnimation(payload);
            let peak = 0;
            const values = new Float32Array(analyser.fftSize);
            for (let i = 0; i < 10; i++) {
                await new Promise(resolve => setTimeout(resolve, 20));
                analyser.getFloatTimeDomainData(values);
                for (const value of values) peak = Math.max(peak, Math.abs(value));
            }
            audio.stop(); await new Promise(resolve => setTimeout(resolve, 100));
            return peak;
        };
        const attacks = [];
        for (const [moveType, damageClass] of [['Normal', 'physical'], ['Water', 'special'], ['Electric', 'special'], ['Fire', 'special'], ['Grass', 'status']]) {
            attacks.push(await sample({ actor: 'player', moveType, damageClass }));
        }
        overlay.soundEnabled = false; await overlay.$nextTick();
        const muted = await sample({ moveType: 'Water', damageClass: 'special' });
        overlay.soundEnabled = true;
        const volume = window.battleTestVm.preferences.masterVolume;
        window.battleTestVm.preferences.masterVolume = 0; await overlay.$nextTick();
        const zeroVolume = await sample({ damageClass: 'physical' });
        window.battleTestVm.preferences.masterVolume = volume; await overlay.$nextTick();
        audio.output.disconnect(analyser); analyser.disconnect();
        overlay.requestAction('Quelle est votre prochaine action ?');
        return { attacks, muted, zeroVolume };
    });
    assert(samples.attacks.every(peak => peak > .0001), 'Attack sound has no audio signal');
    assert.equal(samples.muted, 0); assert.equal(samples.zeroVolume, 0);
    return { actualAudioSignal: true, attackFamilies: samples.attacks.length, muteAndVolume: true };
}
module.exports = { validateBattleLabels, validateBattleAudio };
