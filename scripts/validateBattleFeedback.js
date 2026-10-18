const assert = require('node:assert/strict');
const path = require('node:path');

async function validateBattleLabels(page, width, height, output) {
    for (const actor of ['player', 'opponent']) {
        await page.evaluate(async actor => {
            const overlay = window.battleTestVm.$refs.battleOverlay;
            overlay.playMoveResult({ actor, critical: true, effectiveness: 2 });
            clearTimeout(overlay.resultTimer);
            for(const side of ['wild','player'])overlay.attackFx[side].visible=false;
            Object.assign(overlay.attackFx[actor==='player'?'wild':'player'],{visible:true,amount:123,kind:'damage'});
            overlay.transitionLabel='Carapuce entre en combat.';
            overlay.driftNotices=[{side:'player',text:'Élan du voyageur : priorité · Force élémentaire : dégâts augmentés · Bouclier de survie : protection active'},{side:'opponent',text:'Régénération : soin de 12 PV'}];
            overlay.fieldState.weather='rain';overlay.fieldState.terrain='grassy_terrain';
            window.battleTestVm.interactionNotice='Cette action est indisponible pendant la résolution du tour.';
            await overlay.$nextTick();
            await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
            for (const el of document.querySelectorAll('.battle-result-chip, .battle-damage-text')) {
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
        const textLayout=await page.evaluate(()=>{
            const rect=el=>{const r=el.getBoundingClientRect();return {label:el.textContent.trim(),x:r.x,y:r.y,right:r.right,bottom:r.bottom};};
            return {feedback:[...document.querySelectorAll('.battle-result-chip,.battle-damage-text')].map(rect),cards:[...document.querySelectorAll('.battle-status')].map(rect),messages:[...document.querySelectorAll('.battle-announcements p,.battle-text-box')].map(rect)};
        });
        const overlaps=(a,b)=>a.x<b.right-.5&&a.right>b.x+.5&&a.y<b.bottom-.5&&a.bottom>b.y+.5;
        for(const [i,a]of textLayout.feedback.entries()){
            for(const b of [...textLayout.feedback.slice(i+1),...textLayout.cards])assert(!overlaps(a,b),`${width}x${height}: combat texts overlap ${JSON.stringify({a,b})}`);
        }
        for(const [i,a]of textLayout.messages.entries())for(const b of textLayout.messages.slice(i+1))assert(!overlaps(a,b),'Announcements overlap the battle message');
        if (width === 393 || width === 320 || width === 1365) await page.screenshot({ path: path.join(output, `battle-labels-${width}x${height}-${actor}.png`) });
    }
    await page.evaluate(() => { const o=window.battleTestVm.$refs.battleOverlay;o.resultFx.visible=false;o.attackFx.player.visible=false;o.attackFx.wild.visible=false;o.transitionLabel='';o.driftNotices=[];o.fieldState.weather=null;o.fieldState.terrain=null;window.battleTestVm.interactionNotice=''; });
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
