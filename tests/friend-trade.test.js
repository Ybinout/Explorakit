const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto'),factory=require('../server/game/drift/pokemonFactory');
const rules=require('../server/game/social/tradeRules');
const {createTradeManager}=require('../server/realtime/tradeManager');
const locks=require('../server/game/social/tradeLocks');
const mon=(id=7)=>factory.create(id,30,true);
const snapshot=(team=[mon()])=>({team,entries:[],items:{pokeball:10,leftovers:1}});
const offer=(p=null,items=[])=>rules.normalizeOffer({pokemonUuid:p?.uuid||null,items});
test('trade planner preserves permanent Pokémon, HP/PP, held item, party order and selected PC slots',()=>{
 const a=snapshot([mon(),mon(25),mon(133)]),b=snapshot([mon(1),mon(4)]),outgoing=a.team[1],incoming=mon(92);
 incoming.k=4;incoming.iv.attack=31;incoming.ev.speed=252;incoming.heldItem='leftovers';incoming.currentHp=3;incoming.movePp[0]=1;b.entries.push({box:2,slot:8,pokemon:incoming});
 const before=JSON.stringify([a,b]);const plans=rules.planTrade([a,b],[offer(outgoing,[{key:'pokeball',quantity:3}]),offer(incoming,[{key:'leftovers',quantity:1}])]);
 assert.equal(JSON.stringify([a,b]),before);assert.deepEqual(plans[0].team.map(p=>p.uuid),[a.team[0].uuid,incoming.uuid,a.team[2].uuid]);assert.equal(plans[0].team[1],incoming);assert.equal(incoming.currentHp,3);assert.equal(incoming.movePp[0],1);assert.equal(incoming.heldItem,'leftovers');assert.equal(plans[1].team.at(-1),outgoing);assert.equal(plans[1].entries.length,0);assert.equal(plans[0].items.pokeball,7);assert.equal(plans[1].items.pokeball,13);assert.equal(plans[0].items.leftovers,2);
});
test('gifts go into a free team slot or PC; outgoing storage frees capacity and last able companion stays protected',()=>{
 const a=snapshot([mon(),mon(25)]),b=snapshot(Array.from({length:6},()=>mon(1)));let p=rules.planTrade([a,b],[offer(a.team[1]),offer()]);assert.equal(p[1].entries[0].pokemon,a.team[1]);
 b.entries=Array.from({length:240},(_,i)=>({box:Math.floor(i/30),slot:i%30,pokemon:mon(19)}));assert.throws(()=>rules.planTrade([a,b],[offer(a.team[1]),offer()]),/plein/);
 p=rules.planTrade([a,b],[offer(a.team[1]),offer(b.entries[120].pokemon)]);assert.equal(p[1].entries.length,240);assert.equal(p[1].entries.find(e=>e.box===4&&e.slot===0).pokemon,a.team[1]);
 const solo=snapshot();assert.throws(()=>rules.planTrade([solo,b],[offer(solo.team[0]),offer()]),/apte/);
 assert.doesNotThrow(()=>rules.planTrade([solo,a],[offer(solo.team[0]),offer(a.team[1])]));
});
test('offers enforce real ownership/quantities and keep story items and held Multi Exp personal',()=>{
 const a=snapshot();for(const key of ['fly_module','exp_share','fishing_rod','void_teleporter','__proto__'])assert.throws(()=>offer(null,[{key,quantity:1}]));
 for(const q of [0,-1,1.5,100,'1'])assert.throws(()=>offer(null,[{key:'pokeball',quantity:q}]));
 assert.throws(()=>offer(null,[{key:'pokeball',quantity:1},{key:'pokeball',quantity:1}]));assert.throws(()=>rules.checkOffer(a,offer(mon(25))),/plus/);assert.throws(()=>rules.checkOffer(a,offer(null,[{key:'pokeball',quantity:11}])),/assez/);
 a.team[0].heldItem='exp_share';assert.throws(()=>rules.checkOffer(a,offer(a.team[0])),/personnel/);assert(rules.inventory(a).team[0].unavailableReason);
 const first=rules.review([snapshot(),snapshot()],[offer(),offer()],[1,2]);assert(first.error);
});
test('review digest includes the exact Pokémon, held item, IVs, source and offered stock',()=>{
 const a=snapshot([mon(),mon(25)]),b=snapshot(),offers=[offer(a.team[1]),offer(null,[{key:'pokeball',quantity:1}])],digest=()=>rules.review([a,b],offers,[1,2]).digest;
 const d=digest();assert.equal(digest(),d);a.team[1].iv.speed++;assert.notEqual(digest(),d);a.team[1].iv.speed--;assert.equal(digest(),d);b.items.pokeball--;assert.notEqual(digest(),d);
});
function fixture({failCommit=false,uncertain=false}={}){
 let clock=1000,commits=0,dbDown=false;const snapshots=[snapshot([mon(),mon(25)]),snapshot([mon(),mon(133)])],contexts=[],receipts=new Map();
 const store={async inspect(ids,offers){return{review:rules.review(snapshots,offers,ids),inventories:snapshots.map(rules.inventory)};},async commit(data){commits++;if(failCommit)throw Object.assign(Error('stock changed'),{statusCode:409});const plans=rules.planTrade(snapshots,data.offers),receipt={id:data.id,participants:data.ids,offers:rules.review(snapshots,data.offers,data.ids).summaries};receipts.set(data.id,receipt);if(uncertain){dbDown=true;throw Error('Connection lost after COMMIT');}return{receipt,plans};},async loadReceipt(_id,key){if(dbDown)throw Error('offline');return receipts.get(key)||null;}};
 const manager=createTradeManager({store,now:()=>clock,tickMs:0,relationship:async()=> 'friends'});
 for(let i=0;i<2;i++){
  const listeners={},events=[],p={inventoryBusy:false,equipe:{pokemons:[...snapshots[i].team]}};
  const socket={connected:true,once:(event,fn)=>{listeners[event]=fn;},emit:(event,value)=>events.push({event,value}),disconnect(){this.connected=false;listeners.disconnect?.();}};
  const c={id:i+1,username:'Ami '+i,socket,events,mode:'adventure',getPlayer:()=>p,available:token=>socket.connected&&(!p.inventoryBusy||token&&p.__tradeId===token),apply:plan=>{p.equipe.pokemons=plan.team;},reload:async()=>{},synchronize:async()=>{}};contexts.push(c);manager.attach(c);
 }
 async function open(){await manager.request(1,2);let state=manager.view(2);await manager.answer(2,{id:state.id,accept:true});return manager.view(1);}
 const version=id=>{const s=manager.view(id);return{id:s.id,revision:s.revision,digest:s.digest};};
 async function fill(){await open();await manager.offer(1,{...version(1),offer:offer(snapshots[0].team[1])});await manager.offer(2,{...version(2),offer:offer(snapshots[1].team[1])});}
 async function ready(){await fill();await manager.ready(1,version(1));await manager.ready(2,version(2));}
 return{manager,contexts,snapshots,open,fill,ready,version,commits:()=>commits,up(){dbDown=false;},advance(ms){clock+=ms;manager.tick();}};
}
test('invitation is consensual, freezes only its sender, and disconnect/cancel releases inventory locks without a transfer',async()=>{
 const f=fixture();try{await f.manager.request(1,2);assert(locks.locked(1));assert(!locks.locked(2));await assert.rejects(f.manager.answer(1,{id:f.manager.view(1).id,accept:true}),/Invitation/);await f.manager.answer(2,{id:f.manager.view(2).id,accept:false});assert(!locks.locked(1));assert.equal(f.commits(),0);
 await f.open();assert(locks.locked(1)&&locks.locked(2));f.contexts[1].socket.disconnect();assert.equal(f.manager.view(1).phase,'cancelled');assert(!locks.locked(1)&&!locks.locked(2));assert.equal(f.commits(),0);
 }finally{f.manager.stop();}
});
test('any edit resets both validations; stale revisions and final confirmation are rejected',async()=>{
 const f=fixture();try{await f.fill();const old=f.version(1);await f.manager.ready(1,old);await f.manager.offer(2,{...f.version(2),offer:offer(null,[{key:'pokeball',quantity:1}])});assert.deepEqual(f.manager.view(1).ready,[false,false]);await assert.rejects(f.manager.ready(1,old),/changé/);await f.manager.ready(1,f.version(1));await f.manager.ready(2,f.version(2));assert.equal(f.manager.view(1).phase,'review');await f.manager.confirm(1,f.version(1));assert.equal(f.commits(),0);f.manager.edit(2,f.version(2));assert.equal(f.manager.view(1).phase,'open');assert.deepEqual(f.manager.view(1).confirmed,[false,false]);await assert.rejects(f.manager.confirm(1,old),/Vérifiez/);
 }finally{f.manager.stop();}
});
test('two final confirmations commit exactly once and update both live teams before releasing either lock',async()=>{
 const f=fixture();try{await f.ready();await f.manager.confirm(1,f.version(1));assert.equal(f.commits(),0);await f.manager.confirm(2,f.version(2));assert.equal(f.commits(),1);assert.equal(f.manager.view(1).phase,'completed');assert.equal(f.contexts[0].getPlayer().equipe.pokemons[1].uuid,f.snapshots[1].team[1].uuid);assert(!locks.locked(1)&&!locks.locked(2));await f.manager.confirm(2,f.version(2));assert.equal(f.commits(),1);
 }finally{f.manager.stop();}
});
test('rollback and indeterminate COMMIT are distinguished; verification holds locks until the durable receipt is readable',async()=>{
 const failed=fixture({failCommit:true});try{await failed.ready();await failed.manager.confirm(1,failed.version(1));await failed.manager.confirm(2,failed.version(2));assert.equal(failed.manager.view(1).phase,'cancelled');assert(!locks.locked(1));}finally{failed.manager.stop();}
 const f=fixture({uncertain:true});try{await f.ready();await f.manager.confirm(1,f.version(1));await f.manager.confirm(2,f.version(2));assert.equal(f.manager.view(1).phase,'recovering');assert(locks.locked(1)&&locks.locked(2));assert.throws(()=>f.manager.cancel(1,{id:f.manager.view(1).id}),/vérification/);f.up();await f.manager.refresh(1,{id:f.manager.view(1).id});assert.equal(f.manager.view(1).phase,'completed');assert(!locks.locked(1)&&!locks.locked(2));assert.equal(f.commits(),1);
 }finally{f.manager.stop();}
});
test('busy players, expedition modes, overlapping invitations, expiry and friendship removal never transfer assets',async()=>{
 const f=fixture();try{
  f.contexts[1].getPlayer().inventoryBusy=true;await assert.rejects(f.manager.request(1,2),/libres/);assert(!locks.locked(1));f.contexts[1].getPlayer().inventoryBusy=false;
  f.contexts[1].mode='expedition';await assert.rejects(f.manager.request(1,2),/Aventure/);f.contexts[1].mode='adventure';
  await f.manager.request(1,2);await assert.rejects(f.manager.request(2,1));f.advance(90001);assert.equal(f.manager.view(1).phase,'cancelled');assert(!locks.locked(1));
  await f.open();f.manager.friendshipChanged(1,2);assert.equal(f.manager.view(1).phase,'cancelled');assert(!locks.locked(1)&&!locks.locked(2));assert.equal(f.commits(),0);
 }finally{f.manager.stop();}
});
test('disconnecting either participant during COMMIT delays their replacement until both live parties and final saves are current', {timeout:15000},async()=>{
 const http=require('node:http'),{once}=require('node:events'),{Server}=require('socket.io'),{io:client}=require('../vue-explorakit/node_modules/socket.io-client');
 const {exclusiveAccountConnection,waitForAccountConnections}=require('../server/realtime/accountConnection');
 const server=http.createServer(),io=new Server(server),sockets=[],saved=[snapshot([mon(),mon(25)]),snapshot([mon(),mon(133)])];
 const outgoing=saved[0].team[1],incoming=saved[1].team[1];let finish,started,completed=0,reloaded=false;
 const gate=new Promise(r=>{finish=r;}),entered=new Promise(r=>{started=r;});
 const store={inspect:async(ids,offers)=>({review:rules.review(saved,offers,ids),inventories:saved.map(rules.inventory)}),async commit(data){started();await gate;const plans=rules.planTrade(saved,data.offers);completed++;return{plans,receipt:{id:data.id,participants:data.ids,offers:rules.review(saved,data.offers,data.ids).summaries}};}};
 const manager=createTradeManager({store,tickMs:0,relationship:async()=> 'friends'});
 io.on('connection',socket=>{socket.data.user={id:Number(socket.handshake.auth.id)};exclusiveAccountConnection((s,lease)=>{
  const id=s.data.user.id,index=id-101,p={equipe:{pokemons:[...saved[index].team]},inventoryBusy:false};
  manager.attach({id,username:'Lease '+id,socket:s,mode:'adventure',getPlayer:()=>p,available:token=>!p.inventoryBusy||p.__tradeId===token,apply:plan=>{p.equipe.pokemons=plan.team;},reload:async()=>{},synchronize:async()=>{}});
  lease.onClose(()=>{saved[index].team=[...p.equipe.pokemons];});s.emit('ready',p.equipe.pokemons.map(p=>p.uuid));
 })(socket);});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const make=id=>{const s=client('http://127.0.0.1:'+server.address().port,{auth:{id},transports:['websocket'],autoConnect:false,forceNew:true,reconnection:false});sockets.push(s);return s;};
 const connect=async s=>{const ready=once(s,'ready');s.connect();return(await ready)[0];};
 const version=id=>{const s=manager.view(id);return{id:s.id,revision:s.revision,digest:s.digest};};
 try{
  const a=make(101),b=make(102);await connect(a);await connect(b);await manager.request(101,102);await manager.answer(102,{id:manager.view(102).id,accept:true});
  await manager.offer(101,{...version(101),offer:offer(outgoing)});await manager.offer(102,{...version(102),offer:offer(incoming)});await manager.ready(101,version(101));await manager.ready(102,version(102));await manager.confirm(101,version(101));
  const committing=manager.confirm(102,version(102));await entered;
  // The first participant did not submit the committing RPC, but must still
  // retain its account lease until that shared transaction is synchronized.
  a.disconnect();const replacement=make(101),ready=connect(replacement).then(team=>{reloaded=true;return team;});await once(replacement,'connect');
  assert(!reloaded);assert(locks.locked(101)&&locks.locked(102));finish();await committing;const loaded=await ready;
  assert.equal(loaded[1],incoming.uuid);assert.equal(saved[0].team[1].uuid,incoming.uuid);assert.equal(completed,1);assert(!locks.locked(101)&&!locks.locked(102));
 }finally{finish();sockets.forEach(s=>s.disconnect());await waitForAccountConnections(io);await new Promise(r=>io.close(r));manager.stop();}
});
