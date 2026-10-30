const test=require('node:test'),assert=require('node:assert/strict');
const {reorderMoves}=require('../server/game/models/moveOrder');
const {registerMoveOrderHandlers}=require('../server/realtime/handlers/moveOrderHandlers');
const {TournamentController}=require('../server/game/superTournament/controller');
const factory=require('../server/game/drift/pokemonFactory'),codec=require('../server/game/drift/checkpointCodec');
const mon=()=>Object.assign(factory.create(7,20,true),{abilities:['Tackle','Protect','Water Gun','Bite'],movePp:[0,3,7,11],heldItem:'choice_band',pendingMoves:[{id:'pending',move:'Surf'}]});
const request=p=>({pokemonUuid:p.uuid,expectedMoves:[...p.abilities],orderedIndexes:[3,0,2,1]});
test('moves carry their own PP, including exhausted moves, without changing any other owned data',()=>{
 const p=mon(),before=JSON.stringify(p),r=reorderMoves(p,request(p));
 assert.deepEqual(r,{abilities:['Bite','Tackle','Water Gun','Protect'],movePp:[11,0,7,3]});assert.equal(JSON.stringify(p),before);
 Object.assign(p,r);assert.equal(p.heldItem,'choice_band');assert.equal(p.pendingMoves[0].id,'pending');
 const again=reorderMoves(p,{expectedMoves:[...p.abilities],orderedIndexes:[1,3,2,0]});assert.deepEqual(again.movePp,[0,3,7,11]);
});
test('partial/duplicate/out-of-range/stale/forged orders and eggs cannot mutate anything',()=>{
 const p=mon(),before=JSON.stringify(p);
 for(const orderedIndexes of [null,[],[0,1],[0,1,1,3],[0,1,2,4],[0,1,2,-1],[0,1,2,'3'],[0,1,2,3,4]])assert.throws(()=>reorderMoves(p,{...request(p),orderedIndexes}));
 for(const expectedMoves of [null,[],['Surf',...p.abilities.slice(1)],p.abilities.slice().reverse()])assert.throws(()=>reorderMoves(p,{...request(p),expectedMoves}));
 assert.equal(JSON.stringify(p),before);assert.throws(()=>reorderMoves({...p,isEgg:true},request(p)));assert.throws(()=>reorderMoves(null));
});
function handler(persist,canUse=()=>true){const handlers={},events=[],p={equipe:{pokemons:[mon()]}};registerMoveOrderHandlers({socket:{on:(n,f)=>handlers[n]=f,emit:(n,d)=>events.push([n,d])},userId:12,getPlayer:()=>p,canUse,persist});return {p,events,send:async data=>{let result;await handlers.reorderMoves(data || request(p.equipe.pokemons[0]),r=>result=r);return result;}};}
test('save finishes before live publication, rejects concurrent mutations and never touches another Pokémon',async()=>{
 let finish;const h=handler(async(id,uuid,data)=>{assert.equal(id,12);assert.equal(uuid,h.p.equipe.pokemons[0].uuid);await new Promise(r=>finish=r);return reorderMoves(h.p.equipe.pokemons[0],data);});
 const before=JSON.stringify(h.p.equipe),pending=h.send();assert(h.p.inventoryBusy);assert.equal(JSON.stringify(h.p.equipe),before);assert.equal((await h.send()).success,false);finish();assert((await pending).success);assert.equal(h.events[0][0],'teamStateChanged');assert.deepEqual(h.p.equipe.pokemons[0].movePp,[11,0,7,3]);assert(!h.p.inventoryBusy);
 const forged=await h.send({...request(h.p.equipe.pokemons[0]),pokemonUuid:'other'});assert(!forged.success);
});
test('battle, unavailable inventory and failed save retain the old order',async()=>{
 let calls=0;const h=handler(async()=>{calls++;throw Error('disk');});const before=JSON.stringify(h.p.equipe);
 h.p.inbattle=true;assert(!(await h.send()).success);h.p.inbattle=false;h.p.inventoryBusy=true;assert(!(await h.send()).success);h.p.inventoryBusy=false;assert(!(await h.send()).success);assert.equal(calls,1);assert.equal(JSON.stringify(h.p.equipe),before);assert.equal(h.events.length,0);assert(!h.p.inventoryBusy);
 const blocked=handler(()=>assert.fail(),()=>false);assert(!(await blocked.send()).success);
});
for(const mode of ['rift','colosseum'])test(`${mode}: PC move order survives checkpoint without healing or modifying the team`,()=>{
 const a=mon(),b=mon(),p={userId:1,alive:true,run:{mode,phase:'exploration'},currentmap:'centre',x:560,y:304,equipe:{pokemons:[a]},storage:[{box:2,slot:3,pokemon:b}],items:{},drifts:[],equipped:[]};
 const teamBefore=JSON.stringify(a),bBefore={...b};
 const result=require('../server/game/drift/pokemonComputer').mutate(p,{action:'reorderMoves',...request(b)});
 assert.equal(JSON.stringify(a),teamBefore);assert.deepEqual(b.movePp,[11,0,7,3]);assert.equal(b.currentHp,bBefore.currentHp);assert.equal(b.heldItem,bBefore.heldItem);assert.equal(result.state.entries[0].box,2);assert.equal(result.state.entries[0].slot,3);
 const restored=codec.decode(codec.encode(p));assert.deepEqual(restored.storage[0].pokemon.abilities,b.abilities);assert.deepEqual(restored.storage[0].pokemon.movePp,b.movePp);
 p.inbattle=true;assert.throws(()=>require('../server/game/drift/pokemonComputer').mutate(p,{action:'reorderMoves',...request(b)}));
});
test('Super Tournament order is durable on the sealed team, rolls back errors, and is blocked in combat',async()=>{
 let snapshot,version=0,fail=false;const persist={async load(){return {version,run:snapshot?codec.decode(snapshot):null};},async save(id,run,v){assert.equal(v,version);if(fail)throw Error('disk');snapshot=codec.encode(run);return ++version;}};
 const create=()=>new TournamentController({userId:1,getPlayer:()=>({id:'socket',username:'player'}),persist,emit:()=>{},travel:async()=>{}}),c=create(),team={pokemons:[mon()]},before=JSON.stringify(team);
 await c.register(team);const p=c.run.player.equipe.pokemons[0];p.movePp=[0,3,7,11];await c.reorderMoves(request(p));assert.deepEqual(c.run.player.equipe.pokemons[0].movePp,[11,0,7,3]);assert.equal(JSON.stringify(team),before);
 const restored=create();await restored.load();assert.deepEqual(restored.run.player.equipe.pokemons[0].movePp,[11,0,7,3]);
 const saved=JSON.stringify(restored.run);fail=true;await assert.rejects(()=>restored.reorderMoves(request(restored.run.player.equipe.pokemons[0])),/disk/);assert.equal(JSON.stringify(restored.run),saved);fail=false;
 restored.run.phase='battle';await assert.rejects(()=>restored.reorderMoves(request(restored.run.player.equipe.pokemons[0])),/combat/);
});
