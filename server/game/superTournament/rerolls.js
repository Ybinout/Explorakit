const {ROOMS_PER_CYCLE}=require('./cashPrizes');
function cycle(run){return Math.floor(Math.max(0,Number(run.room)||0)/ROOMS_PER_CYCLE)+1;}
function ensure(run){
 // Existing attempts receive one token for their current cycle, never a backlog.
 if(!run.rerolls)run.rerolls={remaining:1,grantedThroughCycle:cycle(run),spent:0};
 return run.rerolls;
}
function grantCycle(run){const r=ensure(run),current=cycle(run);if(current<=r.grantedThroughCycle)return false;r.remaining=Math.min(Number.MAX_SAFE_INTEGER,r.remaining+current-r.grantedThroughCycle);r.grantedThroughCycle=current;return true;}
function view(run){const r=run.rerolls;return {remaining:r?.remaining||0,spent:r?.spent||0,perCycle:1};}
module.exports={ensure,grantCycle,view};
