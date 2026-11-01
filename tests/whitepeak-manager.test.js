const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {createClub}=require('../server/realtime/whitepeakClub');
const rules=require('../server/game/whitepeak/rules');
async function fixture(){
 let clock=100000,inspections=0;
 const repo={recoverDuels:async()=>{},rouletteState:async()=>null,inspectDuel:async()=>{inspections++;return{digest:'test',selected:[null,null],inventories:[{},{}]};}};
 const club=createClub({to:()=>({emit(){}})},{repository:repo,now:()=>clock,tickMs:0});await club.ready;
 const clients=[1,2,3].map(id=>{
  const handlers=new Map(),socket=new EventEmitter(),notices=[];socket.connected=true;socket.id='waiting-'+id;socket.use=()=>{};
  socket.on('progressionNotice',n=>notices.push(n.message));
  const player={currentmap:rules.HALL,x:13*32+16,y:5*32+16};
  const c={id,username:'Trainer '+id,socket,account:{active:()=>true,on:(n,f)=>handlers.set(n,f)},getPlayer:()=>player,canUse:()=>true};
  const hooks=club.attach(c);
  return{id,player,socket,notices,hooks,command:(name,data={})=>new Promise(resolve=>handlers.get('whitepeak:'+name)(data,resolve))};
 });
 return{club,clients,advance:ms=>{clock+=ms;},inspections:()=>inspections};
}
test('one preparation only: concurrent organisers cannot overwrite rules or the owner',async()=>{
 const f=await fixture();try{
  const answers=await Promise.all(f.clients.slice(0,2).map(c=>c.command('create',{money:c.id*100})));
  assert.equal(answers.filter(r=>r.success).length,1);assert.equal(f.club.room.hostId,1);assert.equal(f.club.room.config.money,100);
  assert.match(answers.find(r=>!r.success).message,/déjà organisé/);
 }finally{f.club.close();}
});
test('a stationary opponent is captured at creation; an off-center host completes review automatically',async()=>{
 const f=await fixture();try{
  const[a,b]=f.clients;Object.assign(b.player,{x:560,y:240});await a.command('create',{pokemonStake:true});
  assert.deepEqual(f.club.room.ids,[null,2]);Object.assign(a.player,{x:240,y:224});await a.hooks.step();
  assert.equal(f.club.room.phase,'review');assert.deepEqual(f.club.room.ids,[1,2]);assert.equal(f.inspections(),1);
  assert.equal(f.club.view(1).you,0);assert.equal(f.club.view(2).you,1);await f.club.tick();assert.equal(f.inspections(),1);
 }finally{if(f.club.room)await f.clients[0].command('leave');f.club.close();}
});
test('a busy person already on a pad joins once available, without needing another movement',async()=>{
 const f=await fixture();try{
  const[a,b]=f.clients;Object.assign(b.player,{x:624,y:240,inventoryBusy:true});await a.command('create');Object.assign(a.player,{x:240,y:224});await a.hooks.step();
  assert.deepEqual(f.club.room.ids,[1,null]);b.player.inventoryBusy=false;await f.club.tick();assert.equal(f.club.room.phase,'review');assert.equal(f.inspections(),1);
 }finally{if(f.club.room)await f.clients[0].command('leave');f.club.close();}
});
test('host gets exactly fifty seconds to take a podium, without a debit, then the room is released',async()=>{
 const f=await fixture();try{
  assert((await f.clients[0].command('create')).success);assert.equal(f.club.view(1).placementDeadline,150000);
  f.advance(49999);await f.club.tick();assert(f.club.room);f.advance(1);await f.club.tick();assert.equal(f.club.room,null);
  assert(f.clients[0].notices.some(s=>s.includes('50 secondes')));assert.equal(f.inspections(),0);
  assert((await f.clients[1].command('create')).success);
 }finally{f.club.close();}
});
test('standing on a podium ends the placement countdown; leaving it starts a fresh bounded countdown',async()=>{
 const f=await fixture();try{
  const c=f.clients[0];await c.command('create');Object.assign(c.player,{x:8*32+16,y:8*32+16});await c.hooks.step();
  assert.equal(f.club.room.placementDeadline,null);f.advance(51000);await f.club.tick();assert(f.club.room);
  c.player.y+=32;await c.hooks.step();assert.equal(f.club.room.placementDeadline,201000);
  f.advance(50000);await f.club.tick();assert.equal(f.club.room,null);
 }finally{f.club.close();}
});
test('organiser leaving or disconnecting cancels preparation, including before joining a podium',async()=>{
 for(const mode of['leave','disconnect']){const f=await fixture();try{
  const c=f.clients[0];await c.command('create');if(mode==='leave'){c.player.currentmap='ville5';await c.hooks.enter();}
  else{c.socket.connected=false;c.socket.emit('disconnect');}
  assert.equal(f.club.room,null);assert.equal(f.inspections(),0);
 }finally{f.club.close();}}
});
test('one podium is reserved for the organiser and obsolete requests cannot bypass placement expiry',async()=>{
 const f=await fixture();try{
  await f.clients[0].command('create');
  Object.assign(f.clients[1].player,{x:8*32+16,y:8*32+16});await f.clients[1].hooks.step();
  Object.assign(f.clients[2].player,{x:19*32+16,y:8*32+16});await f.clients[2].hooks.step();
  assert.deepEqual(f.club.room.ids,[2,null]);assert.equal(f.club.room.phase,'waiting');
  f.advance(50000);const r=await f.clients[0].command('confirm',{id:f.club.room.id,revision:0});assert.equal(r.success,false);assert.equal(f.club.room,null);
 }finally{f.club.close();}
});
test('new organisation is blocked throughout review, startup, combat and settlement',async()=>{
 const f=await fixture();try{
  await f.clients[0].command('create');const id=f.club.room.id;
  for(const phase of['waiting','review','starting','battle','settling']){
   f.club.room.phase=phase;const r=await f.clients[1].command('create');assert.equal(r.success,false,phase);assert.equal(f.club.room.id,id);
  }
 }finally{f.club.close();}
});
test('late movement cannot bypass the fifty-second limit; leaving a review releases both inventory locks',async()=>{
 const f=await fixture();try{
  const[a,b]=f.clients;await a.command('create');f.advance(50000);Object.assign(a.player,{x:8*32+16,y:8*32+16});await a.hooks.step();assert.equal(f.club.room,null);
  Object.assign(a.player,{x:13*32+16,y:5*32+16});await a.command('create');Object.assign(a.player,{x:8*32+16,y:8*32+16});await a.hooks.step();
  Object.assign(b.player,{x:19*32+16,y:8*32+16});await b.hooks.step();assert.equal(f.club.room.phase,'review');assert(a.player.inventoryBusy&&b.player.inventoryBusy);
  a.player.currentmap='ville5';await a.hooks.enter();assert.equal(f.club.room,null);assert.equal(a.player.inventoryBusy,false);assert.equal(b.player.inventoryBusy,false);
 }finally{f.club.close();}
});
test('a burst is rejected before enqueueing behind a slow SQL operation',async()=>{
 let release,calls=0;const gate=new Promise(resolve=>{release=resolve;}),handlers=new Map(),answers=[];
 const repo={recoverDuels:async()=>{},rouletteState:async()=>null,leaderboard:async()=>{calls++;await gate;return[];}};
 const club=createClub({to:()=>({emit(){}})},{repository:repo,now:()=>100000,tickMs:0});await club.ready;
 const socket=new EventEmitter();socket.connected=true;socket.use=()=>{};socket.id='rate-test';
 club.attach({id:7,username:'Test',socket,account:{active:()=>true,on:(name,fn)=>handlers.set(name,fn)},getPlayer:()=>({currentmap:'ville5_maison1'}),canUse:()=>true});
 const work=[];for(let i=0;i<1000;i++){const result=handlers.get('whitepeak:board')({},r=>answers.push(r));if(result instanceof Promise)work.push(result);}
 assert.equal(work.length,35);assert.equal(answers.filter(r=>!r.success).length,965);release();await Promise.all(work);assert.equal(calls,35);assert.equal(answers.filter(r=>r.success).length,35);club.close();
});
