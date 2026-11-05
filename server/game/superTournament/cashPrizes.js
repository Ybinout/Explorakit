const ROOMS_PER_CYCLE=16;
const TIERS=[5086,10173,15259,20346];
const CYCLE_BONUS=50864;
const FIRST_CYCLE_MULTIPLIER=1.2;
const MAX_BALANCE=Number.MAX_SAFE_INTEGER;
function quote(room) {
 if(!Number.isSafeInteger(room)||room<1)throw Error('Salle inconnue.');
 const cycle=Math.floor((room-1)/ROOMS_PER_CYCLE)+1,cycleRoom=(room-1)%ROOMS_PER_CYCLE+1;
 const multiplier=cycle;
 // Boost only the initial 16 victories. Later cycles retain their own tariff.
 const firstCycleMultiplier=cycle===1?FIRST_CYCLE_MULTIPLIER:1;
 const base=Math.round(TIERS[Math.floor((cycleRoom-1)/4)]*multiplier*firstCycleMultiplier);
 const bonus=cycleRoom===ROOMS_PER_CYCLE?Math.round(CYCLE_BONUS*multiplier*firstCycleMultiplier):0;
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
function schedule(){
 const cycleTotalIncrement=TIERS.reduce((sum,n)=>sum+n*4,0)+CYCLE_BONUS;
 const tiers=TIERS.map((_amount,i)=>({from:i*4+1,to:(i+1)*4,amount:quote(i*4+1).base}));
 const cycleBonus=quote(ROOMS_PER_CYCLE).bonus,firstCycleTotal=tiers.reduce((sum,tier)=>sum+tier.amount*4,0)+cycleBonus;
 return {tiers,cycleBonus,firstCycleTotal,secondCycleTotal:cycleTotalIncrement*2,thirdCycleTotal:cycleTotalIncrement*3,cycleTotalIncrement,cycleIncreasePercent:100,maxMultiplier:null};
}
module.exports={quote,ensure,recordWin,view,schedule,MAX_BALANCE,ROOMS_PER_CYCLE};
