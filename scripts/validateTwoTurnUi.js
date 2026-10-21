const assert=require('node:assert/strict'),path=require('node:path');
const factory=require('../server/game/drift/pokemonFactory');
async function validateTwoTurnUi(page,runtime,p,output){
    // The previous trainer fixture has finished its UI recipe; close it cleanly.
    p.battle?.finish(null,'fled');await page.locator('[data-battle-result-continue]').waitFor();await page.locator('[data-battle-result-continue]').click();await page.locator('.battle-scene').waitFor({state:'hidden'});
    const mon=id=>{const m=factory.create(id,25,true);m.passiveAbility=null;m.currentHp=m.maxHp=1000;m.abilities=['Tackle'];m.movePp=[35];return m;};
    const lead=mon(16),foe=mon(19);lead.abilities=['Fly','Tackle'];lead.movePp=[1,35];lead.currentSpeed=999;foe.currentAttack=1;p.equipe.pokemons=[lead];p.run.phase='exploration';p.run.endsAt=Date.now()+240000;
    await page.setViewportSize({width:393,height:852});await page.waitForTimeout(300);await page.evaluate(()=>{window.mounirVm.showMobileControls=true;});
    const battle=runtime.battle(p,{npc:true,equipe:{pokemons:[foe]},drifts:[],equipped:[],chain:0},'wild');battle.deadline=Date.now()+120000;
    const events=[],emit=battle.emit;battle.emit=(viewer,event,payload)=>{events.push({event,payload:JSON.parse(JSON.stringify(payload))});emit(viewer,event,payload);};
    await page.locator('.action-attack:enabled').click();await page.locator('.battle-grid-attacks button:enabled').first().click();
    await page.locator('[data-battle-phase="player"]').waitFor();assert.match(await page.locator('[data-battle-phase="player"]').innerText(),/En vol/);
    assert.equal(await page.locator('.battle-sprite-player img').evaluate(e=>getComputedStyle(e).visibility),'hidden');await page.screenshot({path:path.join(output,'fly-real-preparation.png')});
    await page.locator('.action-attack:enabled').waitFor();battle.deadline=Date.now()+120000;assert.equal(lead.movePp[0],0);assert.equal(lead.movePp[1],35);assert.equal(await page.locator('[data-battle-phase]').count(),0);
    const prepared=events.find(e=>e.event==='introAnimation'&&e.payload.player.equipe.pokemons[0].__battle?.semiInvulnerable==='airborne')?.payload;
    const returned=[...events].reverse().find(e=>e.event==='introAnimation'&&!e.payload.player.equipe.pokemons[0].__battle?.semiInvulnerable)?.payload;
    assert(prepared&&returned);prepared.transitions=[];returned.transitions=[];
    assert.deepEqual(events.filter(e=>e.event==='battleMoveResult'&&e.payload.actor==='player').map(e=>e.payload.phase),['prepare','strike']);
    for(const [width,height]of [[320,480],[393,852],[844,390],[1365,900]]){
        await page.setViewportSize({width,height});await page.waitForTimeout(300);await page.evaluate(async width=>{window.mounirVm.showMobileControls=width<=920;await window.mounirVm.$nextTick();},width);
        const before=await page.locator('.action-attack').boundingBox();
        await page.evaluate(async payload=>{const b=window.mounirVm.$refs.battleOverlay;await b.presentEvent('updateBattleState',payload);},prepared);
        const marker=await page.locator('[data-battle-phase="player"]').boundingBox();assert(marker&&marker.x>=0&&marker.y>=0&&marker.x+marker.width<=width+1&&marker.y+marker.height<=height,JSON.stringify({width,marker}));
        assert.equal(await page.locator('.battle-sprite-player img').evaluate(e=>getComputedStyle(e).visibility),'hidden');
        await page.screenshot({path:path.join(output,`fly-prepared-${width}.png`)});
        await page.evaluate(async payload=>{const b=window.mounirVm.$refs.battleOverlay;await b.presentEvent('playMoveAnimation',{actor:'player',moveName:'Fly',moveType:'Flying',damageClass:'physical',phase:'strike'});await b.presentEvent('updateBattleState',payload);},returned);
        assert.equal(await page.locator('[data-battle-phase]').count(),0);assert.equal(await page.locator('.battle-sprite-player img').evaluate(e=>getComputedStyle(e).visibility),'visible');
        const after=await page.locator('.action-attack').boundingBox();assert(Math.abs(before.y-after.y)<1);
        await page.evaluate(async()=>{const b=window.mounirVm.$refs.battleOverlay;await b.presentEvent('showMessage','Morphéo utilise Weather Ball !');});
        assert.match(await page.locator('.battle-text-box').innerText(),/Ball’Météo/);assert(!/Weather Ball/.test(await page.locator('.battle-text-box').innerText()));
    }
    await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(payload=>window.mounirVm.$refs.battleOverlay.presentEvent('updateBattleState',payload),prepared);assert.equal(await page.locator('[data-battle-phase]').count(),1);await page.evaluate(payload=>window.mounirVm.$refs.battleOverlay.presentEvent('updateBattleState',payload),returned);assert.equal(await page.locator('[data-battle-phase]').count(),0);
    battle.finish(null,'fled');return {realLastPpFly:true,automaticRelease:true,phaseMarkers:true,returnBeforeAttack:true,translatedNarration:true,fixedActions:true,reducedMotion:true,viewports:4};
}
module.exports={validateTwoTurnUi};
