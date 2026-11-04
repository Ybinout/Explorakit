const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const target=require('../server/game/world/interactionTarget'),dialogue=require('../server/game/world/interactionRepository');
const player=(map,x,y)=>({currentmap:map,x:x*32+16,y:y*32+16});
test('local interaction preview uses the same four-neighbour order and ignores empty interactive tiles',()=>{
 const p=player('start',4,4),matrix=[];matrix[3]=[];matrix[3][4]=1;
 const npc={name:'dia1'};assert.deepEqual(target.adjacentTarget(p,matrix,()=>npc).position,{x:4,y:3});
 assert.equal(target.available({player:p,matrix,actorAt:()=>null}),false);
 assert.equal(target.available({player:p,matrix:[],actorAt:()=>npc}),true);
});
test('preview never samples dialogue RNG, opens panels, picks objects, or writes state',()=>{
 const random=Math.random;let calls=0;Math.random=()=>{calls++;return 0;};
 try{for(let i=0;i<100;i++)assert(dialogue.hasDialogueForName('dia1'));assert.equal(calls,0);}finally{Math.random=random;}
});
test('centres, the lab, story objects and existing specialized handlers share their availability rules',()=>{
 assert(target.available({player:player('centre',17,9)}));assert(!target.available({player:player('centre',10,10)}));
 const voidEnding=require('../server/game/world/voidEnding'),p=player('professor_lab',16,10),progress={flags:{lucie_rescued:'true'}};
 assert(target.available({player:p,progress}));assert(!target.available({player:p,progress:{flags:{}}}));
 assert(!target.available({player:p,progress:{flags:{lucie_rescued:'true',[voidEnding.key(progress,'found')]:'true'}}}));
 for(const key of ['clubTarget','darkTarget','tournamentTarget','fishingTarget','nearbyPlayer'])assert(target.available({player:player('unknown',0,0),[key]:()=>true}));
});
test('a menu, battle, busy inventory, or fishing wait cannot advertise a usable interaction',()=>{
 for(const extra of [{blocked:true},{player:{...player('centre',17,9),inbattle:true}},{player:{...player('centre',17,9),inventoryBusy:true}},{fishingActive:true,fishingTarget:()=>false}])assert(!target.available({player:player('centre',17,9),...extra}));
});
test('hint transport is shared per server, emits changes only and stops on disconnect',()=>{
 const io={httpServer:new EventEmitter()},h=require('../server/realtime/interactionHints').getInteractionHints(io);assert.equal(h,require('../server/realtime/interactionHints').getInteractionHints(io));
 const socket=new EventEmitter();socket.connected=true;let packets=0,state={map:'centre',available:true};socket.on('interactionHint',()=>packets++);
 const binding=h.attach(socket,()=>state);binding.update();binding.update();assert.equal(packets,1);state={map:'centre',available:false};binding.update();assert.equal(packets,2);socket.connected=false;socket.emit('disconnect');io.httpServer.emit('close');
});
test('closed expedition modes reuse the indicator without enabling those modes',()=>{
 const runtime=require('../server/game/drift/runManager').createRunManager({store:{}}),p={...player('centre',17,9),alive:true,run:{phase:'exploration'},items:{}};
 assert(runtime.interactionAvailable(p));p.inbattle=true;assert(!runtime.interactionAvailable(p));assert.equal(require('../data/game/modeAvailability.json').expeditionsAvailable,false);
});
