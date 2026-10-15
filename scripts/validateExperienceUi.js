const assert = require('node:assert/strict');
const path = require('node:path');

// Real Socket.IO listener sequence on the browser fixture, without issuing a combat command.
async function validateExperienceUi(page, output) {
    await page.evaluate(() => {
        const vm=window.battleTestVm, overlay=vm.$refs.battleOverlay;
        const pokemon={...overlay.currentPokemon,level:6,experience:200,experienceRate:1};
        overlay.resetBattleUi();vm.battle=true;
        overlay.updateBattleState({player:{equipe:{pokemons:[pokemon]}},wildPokemon:{...pokemon,uuid:'xp-opponent'}});
        overlay.requestAction('À toi de jouer');
        const gained={pokemon:{...pokemon,level:9,experience:600},previousLevel:6,previousExperience:200,xpGained:400};
        vm.socket.listeners('battleExperience').forEach(fn=>fn(gained));
        vm.socket.listeners('endbattle').forEach(fn=>fn({playerWon:true,summary:{outcome:'victory',experience:[]}}));
        window.xpSamples=[];
        window.xpSampler=setInterval(()=>{
            if(overlay.experienceVisual) window.xpSamples.push({...overlay.experienceVisual});
        },20);
    });
    await page.waitForFunction(()=>window.xpSamples.length>=8);
    assert.equal(await page.locator('.battle-summary-backdrop').count(),0);
    assert(await page.locator('.experience-notice').isVisible());
    assert(await page.locator('.action-attack').isDisabled());
    await page.screenshot({path:path.join(output,'experience-before-result.png')});
    await page.waitForFunction(()=>Boolean(window.battleTestVm.battleResult));
    const samples=await page.evaluate(()=>{clearInterval(window.xpSampler);return window.xpSamples;});
    assert(samples.some((s,i)=>i&&s.level===samples[i-1].level&&s.percent>samples[i-1].percent),'Blue bar never progressed');
    for(const level of [6,7,8]) assert(samples.some(s=>s.level===level&&s.percent===100),`Level ${level} was never filled`);
    assert(samples.some(s=>s.level===9),'Final level missing');
    assert.equal(await page.locator('.battle').count(),0);
    await page.evaluate(()=>window.battleTestVm.dismissBattleResult());
    // Reduced motion and a new battle/disconnect must never resurrect an obsolete result.
    await page.evaluate(async()=>{
        const vm=window.battleTestVm, overlay=vm.$refs.battleOverlay;
        const p={uuid:'cancel-xp',level:5,experience:64,experienceRate:1,abilities:['Tackle'],movePp:[35],currentHp:20,maxHp:20,data:{id:1},name:'Bulbizarre'};
        vm.battle=true;await vm.$nextTick();overlay.updateBattleState({player:{equipe:{pokemons:[p]}},wildPokemon:p});
        overlay.updateExperience({pokemon:{...p,level:6,experience:125},xpGained:61,previousLevel:5,previousExperience:64});
        const done=vm.presentBattleEnd({playerWon:true});
        vm.pendingBattleResult=null;overlay.resetBattleUi();vm.battle=false;await done;
        if(vm.battleResult) throw Error('Cancelled result returned');
        vm.battle=true;vm.preferences.animationsEnabled=false;await vm.$nextTick();
        overlay.updateBattleState({player:{equipe:{pokemons:[p]}},wildPokemon:p});
        overlay.updateExperience({pokemon:{...p,level:6,experience:125},xpGained:61,previousLevel:5,previousExperience:64});
        await vm.presentBattleEnd({playerWon:true});
        if(!vm.battleResult) throw Error('Reduced motion result missing');
        vm.dismissBattleResult();vm.preferences.animationsEnabled=true;
    });
    return {animatedBeforeResult:true,multipleLevels:true,cancelledAndReducedMotion:true};
}

async function validateLearningUi({page,base,output,fit,db,userId}) {
    await page.goto(base+'/game',{waitUntil:'networkidle'});
    await page.locator('.learning-sheet').waitFor();
    for(const [width,height] of [[320,480],[393,852],[844,390]]) {
        await page.setViewportSize({width,height});await fit(page,'.learning-sheet',width,height);
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        const decline=page.getByRole('button',{name:'Ne pas apprendre',exact:true});
        await decline.scrollIntoViewIfNeeded();await fit(page,'.learning-sheet footer',width,height);
        for(const button of await page.locator('.learning-sheet button').all()) assert((await button.boundingBox()).height>=44);
        await page.screenshot({path:path.join(output,`learning-${width}.png`)});
    }
    await page.getByRole('button',{name:'Plus tard',exact:true}).click();
    await page.locator('.menu-toggle-btn').click();
    await page.getByRole('button',{name:'Attaques à apprendre',exact:true}).click();
    await page.locator('.move-choices button').first().click();
    await page.waitForFunction(()=>document.querySelector('.new-move strong')?.textContent==='Poudre Toxik');
    const [[learned]]=await db.execute('SELECT p.* FROM pokemons p JOIN teams t ON t.id=p.team_id WHERE t.user_id=?',[userId]);
    assert.equal(learned.ability1,'Leech Seed');assert.equal(learned.move1_pp,10);
    await page.reload({waitUntil:'networkidle'});
    await page.locator('.learning-sheet').waitFor();assert.match(await page.locator('.new-move').innerText(),/Poudre Toxik/);
    await page.getByRole('button',{name:'Ne pas apprendre',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.new-move strong')?.textContent==='Poudre Dodo');
    await page.getByRole('button',{name:'Ne pas apprendre',exact:true}).click();
    await page.locator('.learning-sheet').waitFor({state:'hidden'});
    const [[saved]]=await db.execute('SELECT p.pending_moves FROM pokemons p JOIN teams t ON t.id=p.team_id WHERE t.user_id=?',[userId]);
    assert.deepEqual(typeof saved.pending_moves==='string'?JSON.parse(saved.pending_moves):saved.pending_moves,[]);
    return {replace:true,decline:true,later:true,reconnected:true,formats:3};
}
module.exports={validateExperienceUi,validateLearningUi};
