// Raid-only pressure. Time is measured in native turns, never wall-clock time:
// slow clients and presentation delays cannot cool down or amplify the boss.
const {config}=require('./cooperation');
function state(sim){return sim.raid.rage||=( {value:0,cycleDamage:0,cycle:sim.turn} );}
function view(sim){const r=state(sim),value=Math.max(0,Math.min(config.bossRage.maximum,r.value));return {value:Math.round(value*10)/10,bonusPercent:Math.round(value/config.bossRage.maximum*config.bossRage.maxDamageBonus*1000)/10,maximum:config.bossRage.maximum,highThreshold:config.bossRage.highThreshold};}
function publish(sim,event,reason){if(sim.raid.threatProjection)return;event(sim,'bossRage',sim.p2.active[0],{...view(sim),reason,at:sim.log.length+3});}
function received(sim,boss,actual,event){
 if(!sim.raid||sim.raid.threatProjection||actual<=0)return;
 const r=state(sim),c=config.bossRage,before=r.cycleDamage,after=Math.min(1,before+actual/Math.max(1,boss.maxhp));
 r.cycleDamage=after;
 r.value=Math.min(c.maximum,r.value+c.linearGain*(after-before)+c.burstGain*(after*after-before*before));
 publish(sim,event,'damage');
}
function endCycle(sim,event){
 if(!sim.raid||sim.raid.threatProjection)return;
 const r=state(sim);if(r.lastSettled===sim.turn)return;
 r.lastSettled=sim.turn;
 const before=r.value;if(r.cycleDamage<config.bossRage.quietCycleThreshold)r.value=Math.max(0,r.value-config.bossRage.quietCycleDecay);
 r.cycleDamage=0;r.cycle=sim.turn+1;
 if(r.value!==before)publish(sim,event,'quiet');
}
function multiplier(sim){return 1+Math.max(0,Math.min(config.bossRage.maximum,state(sim).value))/config.bossRage.maximum*config.bossRage.maxDamageBonus;}
function relief(sim,p,source,move,actual,event){
 if(!sim.raid||sim.raid.threatProjection||p.side.n!==0||source?.side.n!==1||move?.effectType!=='Move'||!['normal','any','randomNormal','adjacentFoe'].includes(move.target)||actual<=0)return;
 const before=p.m.aggro||0;p.m.aggro=Math.max(0,before-actual/Math.max(1,p.maxhp)*config.aggro.singleTargetReliefScale);
 if(p.m.aggro<before)event(sim,'aggro',p,{value:Math.round(p.m.aggro),gain:p.m.aggro-before,reason:'bossHit',at:sim.log.length+3});
}
module.exports={state,view,received,endCycle,multiplier,relief};
