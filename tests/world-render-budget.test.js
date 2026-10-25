const test=require('node:test'),assert=require('node:assert/strict');
const api=()=>import('../vue-explorakit/src/services/worldRenderBudget.js');
test('slow mobile walking reduces canvas density in bounded steps without changing desktop or fast devices',async()=>{
 const {WorldRenderBudget}=await api();
 for(const mobile of [false,true]){const budget=new WorldRenderBudget(2);for(let t=0;t<3000;t+=16)budget.observe(t,mobile?2:20,16,{mobile,walking:true});assert.equal(budget.ratio,2);}
 const budget=new WorldRenderBudget(2);for(let t=0;t<1250;t+=33)budget.observe(t,16,33,{mobile:true,walking:true});assert.equal(budget.ratio,1.5);for(let t=1250;t<3000;t+=33)budget.observe(t,16,33,{mobile:true,walking:true});assert.equal(budget.ratio,1);for(let t=3000;t<5000;t+=33)budget.observe(t,16,33,{mobile:true,walking:true});assert.equal(budget.ratio,1);
});
test('idle time, one stall, and map/visibility resets never trigger a false downgrade; steady headroom recovers detail',async()=>{
 const {WorldRenderBudget}=await api(),budget=new WorldRenderBudget(2);for(let t=0;t<3000;t+=16)budget.observe(t,t===160?200:2,t===160?200:16,{mobile:true,walking:true});assert.equal(budget.ratio,2);
 for(let t=3000;t<6000;t+=30)budget.observe(t,30,30,{mobile:true,walking:false});assert.equal(budget.ratio,2);
 for(let t=6000;t<7500;t+=33)budget.observe(t,20,33,{mobile:true,walking:true});assert.equal(budget.ratio,1.5);budget.reset(7500);
 for(let t=7500;t<20000;t+=16)budget.observe(t,1,16,{mobile:true,walking:true});assert.equal(budget.ratio,2);
});
test('brief finger releases or keyboard turns do not erase a sustained overload window',async()=>{
 const {WorldRenderBudget}=await api(),budget=new WorldRenderBudget(2);for(let t=0;t<1300;t+=33)budget.observe(t,20,33,{mobile:true,walking:t%470>25});assert.equal(budget.ratio,1.5);
});
