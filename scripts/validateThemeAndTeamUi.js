const assert = require('node:assert/strict'), path = require('node:path');
const sizes = [[393,852],[320,568],[844,390],[1365,900]];
async function validateThemeAndTeamUi({page,base,db,userId,output,fit}) {
    const open = async key => {
        await page.locator('.menu-toggle-btn').click();
        await page.locator(`[data-menu-action="${key}"]`).click();
    };
    const contrast = async () => page.evaluate(() => {
        const css=getComputedStyle(document.querySelector('#app'));
        const lum=key=>{
            let h=css.getPropertyValue('--journal-'+key).trim();
            if(h.length===4)h='#'+[...h.slice(1)].map(c=>c+c).join('');
            const a=[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
            return a[0]*.2126+a[1]*.7152+a[2]*.0722;
        };
        let min=100;
        for(const ink of ['ink','heading','muted','accent'])for(const paper of ['paper','card','soft','selected']){
            const a=lum(ink),b=lum(paper);min=Math.min(min,(Math.max(a,b)+.05)/(Math.min(a,b)+.05));
        }
        const a=lum('accent'),b=lum('on-accent');min=Math.min(min,(Math.max(a,b)+.05)/(Math.min(a,b)+.05));
        return min;
    });
    let minContrast=100;
    await page.locator('.bag-panel .panel-close').click();
    await open('options');
    for(const [width,height] of sizes){
        await page.setViewportSize({width,height});
        for(const color of ['blue','sage','lavender','sand'])for(const mode of ['light','dark']){
            await page.locator(`[data-theme-color="${color}"]`).check();
            await page.locator(`[data-theme-mode="${mode}"]`).check();
            assert.equal(await page.locator('html').getAttribute('data-game-theme-color'),color);
            assert.equal(await page.locator('html').getAttribute('data-game-theme-mode'),mode);
            minContrast=Math.min(minContrast,await contrast());assert(minContrast>=4.5,`${color}/${mode} text contrast ${minContrast}`);
            await fit(page,'.info-panel',width,height);
            await page.locator('.theme-options').first().scrollIntoViewIfNeeded();
            for(const button of await page.locator('.theme-choice').all())assert((await button.boundingBox()).height>=44);
            await page.screenshot({path:path.join(output,`theme-${color}-${mode}-${width}.png`)});
        }
    }
    await page.setViewportSize({width:393,height:852});
    await page.locator('[data-theme-color="lavender"]').check();
    await page.reload({waitUntil:'networkidle'});
    assert.equal(await page.locator('html').getAttribute('data-game-theme-color'),'lavender');
    assert.equal(await page.locator('html').getAttribute('data-game-theme-mode'),'dark');
    for(const [key,panel,close] of [['pokedex','.dex','.dex-close'],['badges','.badge-case','.badge-case-close'],['pokemon','.team-panel','.team-close'],['bag','.bag-panel','.panel-close']]){
        await open(key);await fit(page,panel,393,852);
        const surface=await page.locator(panel).evaluate(el=>({actual:getComputedStyle(el).backgroundColor,paper:getComputedStyle(el).getPropertyValue('--journal-paper').trim()}));
        assert.equal(surface.actual,'rgb(40, 34, 53)',key+' must use the night surface');
        await page.screenshot({path:path.join(output,`theme-night-${key}-393.png`)});
        if(key==='pokemon'){
            await page.locator('.team-row-visual').first().click();await fit(page,'.companion-sheet',393,852);
            assert.equal(await page.locator('.companion-level').evaluate(el=>getComputedStyle(el).color),'rgb(20, 35, 46)');
            await page.screenshot({path:path.join(output,'theme-night-companion-393.png')});await page.locator('.companion-close').click();
        }
        await page.locator(panel).locator(close).click();
    }
    await open('pokemon');
    await page.locator('[data-team-uuid]').nth(1).waitFor();
    const order=()=>page.locator('[data-team-uuid]').evaluateAll(rows=>rows.map(row=>row.dataset.teamUuid));
    const original=await order();assert.equal(original.length,2);assert.equal(await page.locator('.team-save-btn').count(),0);
    await page.locator('.team-row').nth(1).getByRole('button',{name:/Monter/}).click();
    await page.waitForFunction(uuid=>document.querySelector('[data-team-uuid]')?.dataset.teamUuid===uuid,original[1]);
    await page.waitForFunction(()=>!document.querySelector('.team-panel').__vue__?.teamSaving&&document.querySelector('.team-order-status')?.textContent.includes('Ordre enregistré'));
    const saved=async()=>{const [rows]=await db.execute('SELECT p.uuid FROM pokemons p JOIN teams t ON t.id=p.team_id WHERE t.user_id=? ORDER BY p.position',[userId]);return rows.map(row=>row.uuid);};
    assert.deepEqual(await saved(),[...original].reverse());
    // A following ordinary save must keep the live roster, not restore its former order.
    const ack=await page.evaluate(()=>new Promise(resolve=>document.querySelector('.game-root').__vue__.socket.emit('requestGameSave',resolve)));
    assert(ack.success);assert.deepEqual(await saved(),[...original].reverse());
    await page.reload({waitUntil:'networkidle'});await open('pokemon');await page.locator('[data-team-uuid]').nth(1).waitFor();assert.deepEqual(await order(),[...original].reverse());
    await page.evaluate(async()=>{
        const vm=document.querySelector('.game-root').__vue__,socket=vm.socket;
        socket.connected=false;try{await vm.moveTeamPokemon(0,'down');}finally{socket.connected=true;}
    });
    assert.deepEqual(await order(),[...original].reverse());assert(await page.locator('.team-error').isVisible());assert.equal(await page.locator('[data-team-uuid]').count(),2);
    await page.locator('.team-row').nth(1).getByRole('button',{name:/Monter/}).click();
    await page.waitForFunction(()=>document.querySelector('.team-order-status')?.textContent.includes('Ordre enregistré'));
    assert.deepEqual(await saved(),original);
    await page.screenshot({path:path.join(output,'team-auto-order-393.png')});await page.locator('.team-close').click();
    await open('options');await page.locator('[data-theme-color="blue"]').check();await page.locator('[data-theme-mode="light"]').check();await page.locator('.info-panel .close-button').click();
    return {palettes:4,modes:2,viewports:4,minContrast,remembered:true,nightMenus:true,automaticOrder:true,persistedAfterSaveAndReload:true,rollbackAndRetry:true};
}
module.exports={validateThemeAndTeamUi};
