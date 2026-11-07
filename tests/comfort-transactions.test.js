const test=require('node:test'),assert=require('node:assert/strict');
const rules=require('../server/game/social/tradeRules'),factory=require('../server/game/drift/pokemonFactory');
const snap=money=>({money,team:[factory.create(7,10,true)],entries:[],items:{pokeball:10}});
const offer=money=>rules.normalizeOffer({money});
test('money gifts and mixed trades preserve total balances and validate safe exact integers',()=>{
 for(const v of [-1,1.5,'100',Infinity,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>offer(v),/invalide/);
 const s=[snap(5000),snap(17)],before=JSON.stringify(s),o=[offer(5000),offer(0)];
 const reviewed=rules.review(s,o,[1,2]);assert.equal(reviewed.error,'');assert.equal(reviewed.summaries[0].money,5000);
 const p=rules.planTrade(s,o);assert.deepEqual(p.map(p=>p.money),[0,5017]);assert.equal(JSON.stringify(s),before);
 assert.throws(()=>rules.planTrade(s,[offer(5001),offer(0)]),/assez/);
 assert.throws(()=>rules.planTrade([snap(1),snap(Number.MAX_SAFE_INTEGER)],[offer(1),offer(0)]),/porte-monnaie/);
 const digest=reviewed.digest;s[1].money++;assert.notEqual(rules.review(s,o,[1,2]).digest,digest);
});
test('inaccessible friend destinations expose one clear error and never resolve a target',()=>{
 const f=require('../server/game/world/friendFlight'),state={visited:[],visitedRegions:[]};
 for(const location of [{mode:'adventure',map:'jungle1'},{mode:'adventure',map:'ville1'},{mode:'adventure',map:'centre'},null])assert.throws(()=>f.destination(location,state),e=>e.message==='Zone inaccessible : vous ne pouvez pas rejoindre cet ami.'&&e.code==='zone_inaccessible');
});
test('flight RPC refuses inaccessible destinations without calling travel and releases locks',async()=>{
 const handlers={};let called=0,busy=false;const p={currentmap:'start'};
 require('../server/realtime/handlers/flightHandlers').registerFlightHandlers({socket:{connected:true,on:(e,fn)=>handlers[e]=fn},userId:123,getPlayer:()=>p,canUse:()=>true,setBusy:v=>busy=v,travel:async()=>called++,loadState:async()=>({unlocked:true,owned:true,visited:[],visitedRegions:[]}),loadProgress:async()=>({flags:{}}),verifyFriend:async()=>true,getFriendLocation:()=>({mode:'adventure',map:'ville1',x:100,y:100})});
 let r;await handlers.flyToFriend({targetId:2},v=>r=v);assert.equal(called,0);assert.equal(r.code,'zone_inaccessible');assert.equal(r.message,'Zone inaccessible : vous ne pouvez pas rejoindre cet ami.');assert(!busy&&!p.inventoryBusy);assert.equal(p.currentmap,'start');
});
test('post-capture tutorial has two persistent navbar steps without retriggering a wild lesson',()=>{
 const t=require('../server/game/tutorial/earlyGame');assert.equal(t.NEXT.care,'menu');assert.equal(t.NEXT.menu,'team');assert.equal(t.NEXT.team,'complete');
 for(const phase of ['care','menu','team','complete']){const s={...t.initial(),phase};assert.equal(t.parse(JSON.stringify(s)).phase,phase);assert(!t.active(s));}
});
test('large roulette payouts stay safe and ordinary wager validators retain their ceiling',()=>{
 const r=require('../server/game/whitepeak/rules');assert.equal(r.payout({amount:2000001,choice:{kind:'number',number:7}},7),72000036);assert.equal(r.payout({amount:Number.MAX_SAFE_INTEGER,choice:{kind:'red'}},7),Number.MAX_SAFE_INTEGER);assert.equal(r.payout({amount:Number.MAX_SAFE_INTEGER,choice:{kind:'red'}},0),0);assert.throws(()=>r.amount(1000001));
});
test('monetary offers require the updated summary on both clients, and changing cash clears both approvals',async()=>{
 const {createTradeManager}=require('../server/realtime/tradeManager'),states=[snap(5000),snap(9000)],contexts=[];
 const manager=createTradeManager({tickMs:0,relationship:async()=> 'friends',store:{inspect:async(ids,offers)=>({review:rules.review(states,offers,ids),inventories:states.map(rules.inventory)})}});
 for(const id of [1,2]){const p={inventoryBusy:false},c={id,mode:'adventure',username:'Ami '+id,supportsMoney:id===1,socket:{connected:true,emit(){},once(){}},getPlayer:()=>p,available:()=>true};contexts.push(c);manager.attach(c);}
 const version=()=>{const t=manager.view(1);return{id:t.id,revision:t.revision,digest:t.digest};};
 try{await manager.request(1,2);await manager.answer(2,{id:version().id,accept:true});await assert.rejects(manager.offer(1,{...version(),offer:offer(100)}),/actualiser/);contexts[1].supportsMoney=true;await manager.offer(1,{...version(),offer:offer(100)});await manager.ready(1,version());assert(manager.view(1).ready[0]);await manager.offer(2,{...version(),offer:offer(50)});assert(manager.view(1).ready.every(v=>!v));assert.equal(manager.view(2).offers[0].money,100);}finally{manager.stop();}
});
