const test=require('node:test'),assert=require('node:assert/strict');
test('battle presentation keeps attacks, results, HP and next action in order and apart',async()=>{
 const {createBattlePresentation}=await import('../vue-explorakit/src/services/battlePresentation.js');
 const events=[],states=[],q=createBattlePresentation({changed:busy=>states.push(busy)});let start;
 q.push(()=>{start=Date.now();events.push('ally');},30);q.push(()=>events.push('result'));q.push(()=>{events.push('enemy');assert(Date.now()-start>=25);},20);q.push(()=>events.push('hp'));q.push(()=>events.push('ready'));
 assert.equal(states[0],true);await q.drain();assert.deepEqual(events,['ally','result','enemy','hp','ready']);assert.equal(states.at(-1),false);
});
test('disconnect/reset cancels pending visuals and unblocks the end panel; hidden/reduced motion can flush',async()=>{
 const {createBattlePresentation}=await import('../vue-explorakit/src/services/battlePresentation.js');const events=[],q=createBattlePresentation();
 q.push(()=>events.push('first'),10000);q.push(()=>events.push('stale'));await Promise.resolve();q.cancel();q.push(()=>events.push('fresh'));await q.drain();assert.deepEqual(events,['first','fresh']);
 q.push(()=>events.push('hidden'),10000);await Promise.resolve();q.skipWait();await q.drain();assert.equal(events.at(-1),'hidden');
});
