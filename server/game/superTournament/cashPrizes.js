const ROOMS_PER_CYCLE=16;
const TIERS=[8000,16000,24000,32000];
const CYCLE_BONUS=80000;
const MAX_BALANCE=Number.MAX_SAFE_INTEGER;
function quote(room) {
 if(!Number.isSafeInteger(room)||room<1)throw Error('Salle inconnue.');
 const cycle=Math.floor((room-1)/ROOMS_PER_CYCLE)+1,cycleRoom=(room-1)%ROOMS_PER_CYCLE+1;
 const multiplier=cycle;
 const base=TIERS[Math.floor((cycleRoom-1)/4)]*multiplier;
 const bonus=cycleRoom===ROOMS_PER_CYCLE?CYCLE_BONUS*multiplier:0;
 return {room,cycle,cycleRoom,base,bonus,total:base+bonus,multiplier};
}
function ensure(run) {
 // Legacy attempts start at their saved progress: no retroactive windfall.
 // One watermark and one receipt keep endless snapshots constant in size.
 if(!run.cash)run.cash={version:1,paidThrough:Math.max(0,Number(run.cleared)||0),earned:0,last:null};
 return run.cash;
}
function recordWin(run) {
 const cash=ensure(run),prize=quote(run.cleared);
 if(cash.paidThrough>=prize.room)return false;
 cash.paidThrough=prize.room;cash.earned+=prize.total;
 cash.last={...prize,amount:prize.total,limited:false};return true;
}
function view(run){return {earned:Number(run.cash?.earned)||0,last:run.cash?.last||null};}
function schedule(){const firstCycleTotal=TIERS.reduce((sum,n)=>sum+n*4,0)+CYCLE_BONUS;return {tiers:TIERS.map((amount,i)=>({from:i*4+1,to:(i+1)*4,amount})),cycleBonus:CYCLE_BONUS,firstCycleTotal,cycleTotalIncrement:firstCycleTotal,cycleIncreasePercent:100,maxMultiplier:null};}
module.exports={quote,ensure,recordWin,view,schedule,MAX_BALANCE,ROOMS_PER_CYCLE};
