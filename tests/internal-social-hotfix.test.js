const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const factory=require('../server/game/drift/pokemonFactory'),engine=require('../server/game/battle/battleEngine'),held=require('../server/game/items/heldItems'),policy=require('../server/game/items/heldItemPolicy');
const corruption={version:1,revision:1,permanent:true,modules:{}};
function mon(id=143){const p=factory.create(id,50,true);p.passiveAbility=null;return p;}
function cast(p,q,name){p.abilities=[name];p.movePp=[20];const state=engine.createBattleState();return engine.useattack(name,p,q,{battleState:state,attackerSide:state.sides.player,defenderSide:state.sides.enemy});}
test('corrupted Pokémon reject ordinary held items, but the future authoritative corrupted-held flag works',()=>{
 const p=mon();p.corruption=corruption;p.heldItem='choice_scarf';assert(!held.enabled(p));assert.equal(held.statMultiplier(p,'speed'),1);assert(!policy.canHold(p,'leftovers'));assert(policy.canHold(p,null));assert.throws(()=>policy.assertCanHold(p,'leftovers'),/corrompu/);
 const definition=require('../server/game/battle/battleResources').getItemDefinition('choice_scarf');try{definition.corruptedHeldItem=true;assert(policy.canHold(p,'choice_scarf'));assert.equal(held.statMultiplier(p,'speed'),1.5);}finally{delete definition.corruptedHeldItem;}
});
test('ordinary held items cannot enter a corrupted Pokémon through Trick, Bestow, Thief or Recycle',()=>{
 for(const move of['Trick','Switcheroo','Bestow']){const p=mon(),q=mon();p.heldItem='leftovers';q.corruption=corruption;cast(p,q,move);assert.equal(p.heldItem,'leftovers',move);assert(!q.heldItem,move);}
 const p=mon(),q=mon();p.corruption=corruption;q.heldItem='leftovers';cast(p,q,'Thief');assert(!p.heldItem);assert.equal(q.heldItem,'leftovers');
 engine.ensureBattleData(p).consumedHeldItem='leftovers';cast(p,q,'Recycle');assert(!p.heldItem);
});
test('dragging or swapping items never circumvents corruption and leaves the original plan untouched',()=>{
 const plan=require('../server/game/items/heldItemTransfer').planHeldItemTransfer,t=[{uuid:'a',heldItem:'leftovers'},{uuid:'b',corruption,heldItem:null}],before=JSON.stringify(t);
 assert.throws(()=>plan(t,{sourceUuid:'a',targetUuid:'b',sourceItem:'leftovers',targetItem:null}),/corrompu/);assert.equal(JSON.stringify(t),before);
});
test('friend flight uses authoritative visited outdoor positions and refuses private rooms, Dark, locked gates and unvisited zones',()=>{
 const {destination}=require('../server/game/world/friendFlight');const s={unlocked:true,owned:true,visited:['ville1'],visitedRegions:['ville1']},p={map:'ville1',x:432,y:496,mode:'adventure'};
 const d=destination(p,s,{flags:{aspha_route2_defeated:'true'},badges:[]});assert.equal(d.map,'ville1');assert(Math.abs(d.x-p.x)+Math.abs(d.y-p.y)<=128);assert(d.x!==p.x||d.y!==p.y);
 for(const map of['centre','professor_lab','super_tournament_lobby','super_tournament_room','jungle1','route2','safari1'])assert.throws(()=>destination({...p,map},s,{}));
 assert.throws(()=>destination({...p,map:'route2'},{...s,visitedRegions:['route2']},{flags:{},badges:[]}),/défis/);
 assert.throws(()=>destination({...p,map:'safari1'},{...s,visitedRegions:['safari1']},{}),/Centre/);
 assert.throws(()=>destination({...p,mode:'rift'},s,{}));assert.throws(()=>destination({...p,x:Infinity},s,{}));
});
test('friend flight shares normal travel serialization, checks possession and never trusts client coordinates',async()=>{
 const socket=new EventEmitter();socket.connected=true;let clock=0,hold,release,state={unlocked:true,owned:false,visited:['ville1'],visitedRegions:['ville1']},calls=0;const p={currentmap:'start'};
 require('../server/realtime/handlers/flightHandlers').registerFlightHandlers({socket,userId:12,getPlayer:()=>p,canUse:()=>true,setBusy(){},loadState:async()=>state,loadProgress:async()=>({flags:{aspha_route2_defeated:'true'},badges:[]}),getFriendLocation:id=>{assert.equal(id,13);return{map:'ville1',x:432,y:496,mode:'adventure'};},now:()=>clock,travel:async dest=>{calls++;assert.equal(dest.map,'ville1');if(hold)await new Promise(r=>release=r);}});
 const send=(event,data)=>new Promise(resolve=>socket.emit(event,data,resolve));assert.equal((await send('flyToFriend',{targetId:13})).success,false);state.owned=true;hold=true;
 const task=send('flyToFriend',{targetId:13,map:'jungle9',x:9999});while(!release)await new Promise(r=>setImmediate(r));assert.equal((await send('flyToTown',{map:'ville1'})).success,false);release();assert((await task).success);assert.equal(calls,1);assert(!p.inventoryBusy);assert.equal((await send('flyToFriend',{targetId:13})).success,false);clock=4000;hold=false;assert((await send('flyToFriend',{targetId:13})).success);
});
test('Safari captain and return arrival are separate walkable tiles, slightly forward of the plants',()=>{
 const s=require('../server/game/world/safari'),terrain=require('../server/game/world/mapRepository'),a=s.actors('super_tournament_lobby')[0];assert.deepEqual([a.x,a.y],[24,15]);assert.equal(terrain.loadCollisionData(a.map)[a.y][a.x],0);assert(!s.scopedStore(require('../server/game/world/pnjStore')).isPnjBlockingTile(a.map,Math.floor(s.LOBBY.x/32),Math.floor(s.LOBBY.y/32)));
});
