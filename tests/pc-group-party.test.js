const test=require('node:test'),assert=require('node:assert/strict');
const storage=require('../server/game/storage/pokemonStorage'),factory=require('../server/game/drift/pokemonFactory');
const mon=()=>factory.create(7,25,true);
const request=(team,entries,index=0)=>({action:'swapParty',teamIndex:index,expectedTeam:team.map(p=>p.uuid),moves:entries.map(e=>({pokemonUuid:e.pokemon.uuid,from:{kind:'box',box:e.box,slot:e.slot}}))});
test('group replaces a chosen party range and returns each outgoing Pokémon to its incoming exact origin',()=>{
 const team=Array.from({length:6},mon),entries=[{box:3,slot:24,pokemon:mon()},{box:17,slot:8,pokemon:mon()}];
 entries[0].pokemon.currentHp=2;entries[0].pokemon.heldItem='leftovers';entries[0].pokemon.movePp[0]=0;
 const before=JSON.stringify({team,entries}),p=request(team,entries,2),r=storage.planAction(team,entries,p);
 assert.deepEqual(r.team,[...team.slice(0,2),...entries.map(e=>e.pokemon),...team.slice(4)]);
 assert.deepEqual(r.entries.map(e=>[e.box,e.slot,e.pokemon.uuid]),[[3,24,team[2].uuid],[17,8,team[3].uuid]]);
 assert.equal(r.team[2].currentHp,2);assert.equal(r.team[2].heldItem,'leftovers');assert.equal(r.team[2].movePp[0],0);
 assert.equal(JSON.stringify({team,entries}),before);assert.throws(()=>storage.planAction(r.team,r.entries,p),/changé/);
});
test('group can replace and fill a short party, without leaving phantom or duplicate PC entries',()=>{
 const team=[mon(),mon()],entries=Array.from({length:4},(_,i)=>({box:2,slot:i*3,pokemon:mon()}));
 const r=storage.planAction(team,entries,request(team,entries,1));
 assert.deepEqual(r.team,[team[0],...entries.map(e=>e.pokemon)]);
 assert.deepEqual(r.entries,[{box:2,slot:0,pokemon:team[1]}]);
 assert.equal(new Set([...r.team,...r.entries.map(e=>e.pokemon)].map(p=>p.uuid)).size,6);
});
test('invalid/stale/foreign group, overflow, KO party and multiple corruptions fail without changing the input',()=>{
 const team=Array.from({length:6},mon),entries=Array.from({length:2},(_,i)=>({box:0,slot:i,pokemon:mon()})),p=request(team,entries);
 const before=JSON.stringify({team,entries});
 for(const patch of[{teamIndex:5},{teamIndex:-1},{teamIndex:.5},{moves:[]},{moves:Array(7).fill(p.moves[0])},{moves:[p.moves[0],p.moves[0]]},{moves:[null]},{moves:[{...p.moves[0],pokemonUuid:'foreign'}]},{expectedTeam:[]},{moves:[{...p.moves[0],from:{kind:'box',box:39,slot:29}}]}])assert.throws(()=>storage.planAction(team,entries,{...p,...patch}));
 assert.equal(JSON.stringify({team,entries}),before);
 const full=Array.from({length:6},(_,i)=>({box:0,slot:i,pokemon:mon()}));for(const e of full)e.pokemon.currentHp=0;
 assert.throws(()=>storage.planAction(team,full,request(team,full)),/apte/);
 for(const e of entries)e.pokemon.corruption={version:1,permanent:true,modules:{}};
 assert.throws(()=>storage.planAction(team,entries,p),/corrompu/);
});
test('touch hold selects once and preserves the same finger for dragging; selected holds do not toggle the group',async t=>{
 const {createComputerDrag}=await import('../vue-explorakit/src/services/computerDrag.js');
 t.mock.timers.enable({apis:['setTimeout']});
 const original={document:global.document,requestAnimationFrame:global.requestAnimationFrame,cancelAnimationFrame:global.cancelAnimationFrame};
 const destination={dataset:{pcDrop:'team',pcIndex:'1',pcTargetUuid:'old'},closest(selector){return selector==='[data-pc-drop]'?this:null;}},root={isConnected:true,contains:()=>true,querySelector:()=>null,getBoundingClientRect:()=>({left:0,right:400,top:0,bottom:900}),setPointerCapture(){},releasePointerCapture(){}};
 global.document={elementFromPoint:()=>destination};global.requestAnimationFrame=()=>1;global.cancelAnimationFrame=()=>{};
 const held=[],dropped=[],states=[],ended=[];
 const drag=createComputerDrag({root,changed:g=>states.push(g),drop:g=>dropped.push(g),longPress:p=>held.push(p.uuid),ended:()=>ended.push(true)});
 const event=(x=100,y=400)=>({pointerId:1,pointerType:'touch',button:0,clientX:x,clientY:y,preventDefault(){}}),p={uuid:'one'},from={kind:'box',box:0,slot:4};
 try{
  drag.start(event(),p,from);t.mock.timers.tick(500);assert.deepEqual(held,['one']);
  drag.move(event(130,250));assert(states.at(-1)?.active);drag.finish(event(130,250));assert.equal(dropped.length,1);assert.equal(dropped[0].to.kind,'team');
  drag.start(event(),p,from,{selected:true});t.mock.timers.tick(700);assert.deepEqual(held,['one']);drag.move(event(130,250));drag.finish(event(130,250));assert.equal(dropped.length,2);
  drag.start(event(),p,from);t.mock.timers.tick(500);drag.finish(event());assert.equal(dropped.length,2,'a stationary hold only selects');
  drag.start(event(),p,from);drag.cancel();t.mock.timers.tick(700);assert.equal(held.length,2);assert.equal(ended.length,3);
 }finally{drag.cancel();Object.assign(global,original);}
});
