const {ROOMS_PER_CYCLE}=require('./cashPrizes');
const PER_CYCLE=2,VERSION=2;
function cycle(run){return Math.floor(Math.max(0,Number(run.room)||0)/ROOMS_PER_CYCLE)+1;}
function needsUpgrade(run){return !run.rerolls||run.rerolls.version!==VERSION;}
function ensure(run){
 // Older attempts receive the extra current-cycle token once, never a backlog.
 if(!run.rerolls)run.rerolls={version:VERSION,remaining:PER_CYCLE,grantedThroughCycle:cycle(run),spent:0,skipped:0};
 else if(run.rerolls.version!==VERSION){run.rerolls={...run.rerolls,version:VERSION,remaining:Math.min(Number.MAX_SAFE_INTEGER,(run.rerolls.remaining||0)+1),skipped:0};}
 return run.rerolls;
}
function grantCycle(run){const r=ensure(run),current=cycle(run);if(current<=r.grantedThroughCycle)return false;r.remaining=Math.min(Number.MAX_SAFE_INTEGER,r.remaining+PER_CYCLE*(current-r.grantedThroughCycle));r.grantedThroughCycle=current;return true;}
function grantSkip(run){const r=ensure(run);r.remaining=Math.min(Number.MAX_SAFE_INTEGER,r.remaining+1);r.skipped=Math.min(Number.MAX_SAFE_INTEGER,r.skipped+1);}
function view(run){const r=run.rerolls;return {remaining:r?.remaining||0,spent:r?.spent||0,skipped:r?.skipped||0,perCycle:PER_CYCLE,perSkip:1};}
module.exports={ensure,needsUpgrade,grantCycle,grantSkip,view};
