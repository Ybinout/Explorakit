const test=require('node:test'),assert=require('node:assert/strict');
const room=require('../server/game/world/roomObstacles'),gates=require('../server/game/world/storyGates');
const {loadCollisionData}=require('../server/game/world/mapRepository');
function reachable(flags){const c=loadCollisionData('route2_maison'),q=[[13,16]],seen=new Set();while(q.length){const[x,y]=q.shift(),key=x+':'+y;if(seen.has(key))continue;seen.add(key);for(const[dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,ny=y+dy;if(c[ny]?.[nx]!==0||gates.candidatesForStep('route2_maison','up',nx,ny).some(g=>gates.isLocked(g,{flags})))continue;q.push([nx,ny]);}}return seen;}
test('each barricade seals the full passage until individually cleared; return door stays reachable',()=>{
 const flags={};for(const o of room.obstacles){const seen=reachable(flags);assert(seen.has('13:16'));assert(seen.has('13:'+(o.y+1)));assert(!seen.has('13:'+o.y));assert(!seen.has('13:6'));assert(o.cells.every(c=>loadCollisionData(o.map)[c.y][c.x]===0));flags[o.requiredFlag]='true';}assert(reachable(flags).has('13:6'));
});
test('clearing remains personal, legacy victory opens the room and both sides can remove boards',()=>{
 for(const o of room.obstacles){assert(room.isLocked(o,{}));assert(!room.isLocked(o,{flags:{lucie_freed:'true'}}));assert(!room.isLocked(o,{completedNpcBattles:[{battleKey:require('../data/game/progression.json').npcBattles.lucie_route2.battleKey}]}));for(const y of [o.y-1,o.y,o.y+1])assert.equal(room.nearby({currentmap:o.map,x:432,y:y*32+16},{}).id,o.id);assert.equal(room.nearby({currentmap:'start',x:432,y:o.y*32+16},{}),undefined);}
 assert.equal(room.nearby({currentmap:'route2_maison',x:432,y:16*32+16},{flags:{}}).id,'lucie_barricade_1');
});
test('crystal renderer supports opening, duplicate snapshots and motion preference',async()=>{
 const {StoryGateRenderer}=await import('../vue-explorakit/src/services/storyGateRenderer.js');const r=new StoryGateRenderer();r.sync(room.snapshot({}));r.work({active:true,id:'lucie_barricade_1'});assert(r.gates.get('lucie_barricade_1').workingAt!==null);
 const open=room.snapshot({flags:{lucie_barricade_1_cleared:'true'}});r.sync(open);r.sync(open);const ctx=new Proxy({},{get:()=>()=>{},set:()=>true});r.draw(ctx,'route2_maison',1000);r.draw(ctx,'route2_maison',2200);assert(!r.gates.get('lucie_barricade_1').opening);r.sync(room.snapshot({}));r.sync(open);r.draw(ctx,'route2_maison',3000,false);assert(!r.gates.get('lucie_barricade_1').opening);r.work(null);assert([...r.gates.values()].every(g=>g.workingAt===null));
});
test('entry warning only appears at the entrance before the first barrier, never after a previous victory',()=>{
 const player={currentmap:'route2_maison',x:432,y:528};
 assert.equal(room.entryDialogue(player,{}),'lucie_room_entry');
 assert.equal(room.entryDialogue({...player,currentmap:'start'},{}),null);
 assert.equal(room.entryDialogue({...player,y:208},{}),null);
 for(const flags of [{lucie_freed:'true'},{lucie_barricade_1_cleared:'true'}])assert.equal(room.entryDialogue(player,{flags}),null);
 assert.equal(room.entryDialogue(player,{completedNpcBattles:[{battleKey:require('../data/game/progression.json').npcBattles.lucie_route2.battleKey}]}),null);
 const dialogue=require('../server/game/world/interactionRepository');
 assert.match(dialogue.getSentenceForName('lucie_room_entry')[0][0].text,/n’entre pas/);
 assert.equal(dialogue.getEndSentenceInformation('lucie_room_entry'),undefined,'read-only dialogue cannot award a reward or launch a battle');
});
test('strike anticipation, hit feedback and actor pose share the same five timestamps and honor reduced motion',async()=>{
 const {STRIKE_TIMES,strikeState,roomStrikePose}=await import('../vue-explorakit/src/services/roomObstacleRenderer.js');
 const action={active:true,startedAt:1000,origin:{x:432,y:528},target:{x:13,y:15}};
 assert.equal(STRIKE_TIMES.length,5);
 for(const o of room.obstacles){assert.deepEqual(o.strikeTimes,STRIKE_TIMES);assert(o.duration>STRIKE_TIMES.at(-1)+220);}
 assert.equal(strikeState(action,1000).hits,0);
 for(const [i,t]of STRIKE_TIMES.entries()){
  assert.equal(strikeState(action,1000+t-1).hits,i);
  assert.equal(strikeState(action,1000+t).hits,i+1);
  assert.equal(roomStrikePose(action,1000+t,true).y,-8);
  assert.equal(Math.abs(roomStrikePose(action,1000+t,false).y),0);
 }
 assert.equal(roomStrikePose({...action,origin:{x:432,y:464}},1550,true).y,8,'strikes also face barriers approached from above');
 assert.deepEqual(roomStrikePose(null,1550),{x:0,y:0});
 assert.equal(strikeState({...action,active:false},1550).impact,0);
 assert.equal(strikeState({...action,duration:2600},3599).hits,5,'old server duration still fits five visual impacts');
 assert.equal(strikeState({...action,strikeTimes:[100,200],duration:500},1250).hits,2,'explicit server timing is authoritative');
 assert.equal(strikeState({...action,strikeTimes:[300,100],duration:4140},1550).hits,1,'invalid timeline falls back safely');
});
