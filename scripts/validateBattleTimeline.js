const assert = require('node:assert/strict');
const path = require('node:path');

// Deliberately burst queued server-shaped frames to reproduce a slow/mobile renderer.
// Runs only inside the isolated combat browser recipe, never on the public server.
async function validateBattleTimeline(page, output) {
    const results = [];
    for (const [width, height] of [[320,568], [844,390]]) {
        await page.setViewportSize({width,height});
        results.push(await page.evaluate(async () => {
            const vm = window.combatVm;
            vm.battle = true; await vm.$nextTick();
            const b = vm.$refs.battleOverlay;
            b.resetBattleUi();
            const make = (uuid,id) => ({uuid,name:uuid,truename:uuid,data:{id},level:20,k:2,experience:8000,currentHp:80,maxHp:80,abilities:['Tackle'],movePp:[35]});
            const a=make('lead',7), reserve=make('reserve',4), enemy=make('enemy',19), next=make('next-enemy',25);
            const state=(lead=a,opponent=enemy,transitions=[])=>({player:{equipe:{pokemons:[lead,reserve]}},wildPokemon:opponent,transitions});
            const play=(method,payload)=>b.presentEvent(method,payload);
            await play('updateBattleState',state());
            const trace=[];
            const original=b.playMoveAnimation;
            b.playMoveAnimation=function(payload){trace.push({name:payload.moveName,at:performance.now(),lead:this.currentPokemon?.uuid,opponent:this.opponent?.uuid,capture:this.captureFx.visible,xp:this.experienceBusy,transition:Object.values(this.transitionFx).some(Boolean),conditions:Object.values(this.conditionFx).some(e=>e.length)});return original.call(this,payload);};
            try {
                const started=performance.now();
                play('playCaptureAnimation',{success:false,shakes:1});
                play('playMoveAnimation',{actor:'opponent',damageClass:'physical',moveName:'after-capture'});
                await b._presentation.drain();
                const capture=trace.at(-1);
                if(capture.capture || capture.at-started<2000)throw Error('Attack overlapped failed capture');
                play('updateBattleState',state(reserve,enemy,[{side:'player',kind:'recall',name:'lead',uuid:a.uuid},{side:'player',kind:'enter',name:'reserve',uuid:reserve.uuid}]));
                play('playMoveAnimation',{actor:'opponent',damageClass:'physical',moveName:'after-switch'});
                await b._presentation.drain();
                const switched=trace.at(-1);
                if(switched.lead!==reserve.uuid||switched.transition)throw Error('Attack ran on the outgoing sprite');
                play('updateBattleState',state(reserve,{...enemy,currentHp:0},[{side:'opponent',kind:'faint',name:'enemy',uuid:enemy.uuid}]));
                play('updateExperience',{pokemon:{...reserve,level:21,experience:9300},previousLevel:20,previousExperience:8000,xpGained:1300});
                play('updateBattleState',state({...reserve,level:21,experience:9300},next,[{side:'opponent',kind:'enter',name:next.name,uuid:next.uuid}]));
                play('playMoveAnimation',{actor:'opponent',damageClass:'physical',moveName:'next-round'});
                await b._presentation.drain();
                const afterKO=trace.at(-1);
                if(afterKO.opponent!==next.uuid||afterKO.xp||afterKO.transition)throw Error('Replacement overlapped KO/XP');
                play('updateBattleState',state({...reserve,level:21,__battle:{statStages:{speed:2}}},next));
                play('playMoveAnimation',{actor:'opponent',damageClass:'physical',moveName:'after-boost'});
                await b._presentation.drain();
                if(trace.at(-1).conditions)throw Error('Next attack overlaps stat effects');
                // Cancel an in-flight capture, not just a queue that has not started yet.
                play('playCaptureAnimation',{success:true,shakes:3});
                play('playMoveAnimation',{actor:'player',damageClass:'physical',moveName:'stale'});
                await Promise.resolve();
                if(!b.captureFx.visible)throw Error('Capture cancellation fixture did not start');
                b.resetBattleUi();
                await play('updateBattleState',state());
                await b._presentation.drain();
                if(trace.some(e=>e.name==='stale')||b.captureFx.visible)throw Error('Cancelled animation leaked into next battle');
                return {width:innerWidth,capture:!capture.capture,switch:!switched.transition,koBeforeXpAndEntry:!afterKO.xp,cancellation:true,conditionOrder:true};
            } finally {b.playMoveAnimation=original;b.resetBattleUi();}
        }));
        await page.screenshot({path:path.join(output,`timeline-${width}.png`)});
    }
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.evaluate(async()=>{
        const b=window.combatVm.$refs.battleOverlay;
        b.presentEvent('playCaptureAnimation',{success:true,shakes:3});
        b.presentEvent('playMoveAnimation',{actor:'player',damageClass:'physical'});
        await b._presentation.drain();
        if(b.captureFx.visible||b.battleMoveFx.visible)throw Error('Reduced motion still plays capture or attack');
        b.resetBattleUi();window.combatVm.battle=false;
    });
    await page.emulateMedia({reducedMotion:'no-preference'});
    assert.equal(results.length,2);
    return {viewports:results,reducedMotion:true};
}
module.exports={validateBattleTimeline};
