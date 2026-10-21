const test=require('node:test'),assert=require('node:assert/strict');
const storage=require('../server/game/storage/pokemonStorage'),factory=require('../server/game/drift/pokemonFactory');
const mon=id=>factory.create(id,20,true);
const team=(index)=>({kind:'team',index}),box=(b,slot)=>({kind:'box',box:b,slot});
function move(p,from,to,target=null){return {action:'move',pokemonUuid:p.uuid,from,to:{...to,uuid:target?.uuid || null}};}
test('PC drag: exact empty slots, box/box swaps, inter-box transfers and party order preserve original objects and inputs',()=>{
 const a=mon(7),b=mon(4),c=mon(1),d=mon(25);let party=[a,b],entries=[{box:0,slot:3,pokemon:c},{box:2,slot:29,pokemon:d}];
 let result=storage.planAction(party,entries,move(c,box(0,3),box(7,19)));assert.equal(entries[0].box,0);assert.equal(result.entries[0].box,7);assert.equal(result.entries[0].slot,19);
 result=storage.planAction(result.team,result.entries,move(c,box(7,19),box(2,29),d));assert.equal(result.entries.find(e=>e.pokemon===d).box,7);assert.equal(result.entries.find(e=>e.pokemon===d).slot,19);assert.equal(result.entries.find(e=>e.pokemon===c).slot,29);
 result=storage.planAction(result.team,result.entries,move(a,team(0),team(1),b));assert.deepEqual(result.team,[b,a]);assert.deepEqual(party,[a,b]);
});
test('PC drag: deposit to a chosen slot, withdraw to the party, and exchange in either direction never heal or lose held equipment',()=>{
 const a=mon(7),b=mon(4),c=mon(1);b.currentHp=3;b.movePp[0]=0;b.heldItem='leftovers';let r=storage.planAction([a,b],[{box:3,slot:8,pokemon:c}],move(b,team(1),box(2,26)));
 assert.deepEqual(r.team,[a]);assert.equal(r.entries.find(e=>e.pokemon===b).slot,26);
 r=storage.planAction(r.team,r.entries,move(b,box(2,26),team(1)));assert.deepEqual(r.team,[a,b]);assert.equal(b.currentHp,3);assert.equal(b.movePp[0],0);assert.equal(b.heldItem,'leftovers');
 r=storage.planAction(r.team,r.entries,move(b,team(1),box(3,8),c));assert.deepEqual(r.team,[a,c]);assert.equal(r.entries[0].pokemon,b);
 r=storage.planAction(r.team,r.entries,move(b,box(3,8),team(0),a));assert.deepEqual(r.team,[b,c]);assert.equal(r.entries[0].pokemon,a);
});
test('PC drag: full boxes and full parties can exchange; the last able companion cannot be deposited or replaced by a KO',()=>{
 const a=mon(7),b=mon(4);b.currentHp=0;
 assert.throws(()=>storage.planAction([a],[{box:0,slot:0,pokemon:b}],move(a,team(0),box(0,1))),/apte/);
 assert.throws(()=>storage.planAction([a],[{box:0,slot:0,pokemon:b}],move(b,box(0,0),team(0),a)),/apte/);
 const full=[a,...Array.from({length:5},()=>mon(1))];assert.throws(()=>storage.planAction(full,[{box:0,slot:0,pokemon:b}],move(b,box(0,0),team(6))),/équipe/);
 const entries=Array.from({length:30},(_,slot)=>({box:0,slot,pokemon:mon(19)}));const target=entries[29].pokemon;
 assert.equal(storage.planAction(full,entries,move(a,team(0),box(0,29),target)).team[0],target);
 assert.equal(storage.planAction(full,entries,move(entries[0].pokemon,box(0,0),box(0,29),target)).entries.find(e=>e.slot===0).pokemon,target);
});
test('PC drag: stale source/destination, replay, foreign UUIDs and invalid coordinates are rejected without mutation',()=>{
 const a=mon(7),b=mon(4),c=mon(1),party=[a,b],entries=[{box:0,slot:0,pokemon:c}],before=JSON.stringify({party,entries});
 for(const payload of [move(b,team(0),box(0,5)),move(c,box(0,0),team(1)),move(mon(25),box(0,0),team(1),b),move(c,box(-1,0),team(1),b),move(c,box(0,0),box(0,30)),move(c,box(0,0),box(8,0)),move(c,box(0,0),{kind:'team',index:1.5})])assert.throws(()=>storage.planAction(party,entries,payload));
 assert.equal(JSON.stringify({party,entries}),before);
 const payload=move(c,box(0,0),box(1,29)),r=storage.planAction(party,entries,payload);assert.throws(()=>storage.planAction(r.team,r.entries,payload),/changé/);
});
test('private PCs share exact drop rules and retain positions in the expedition checkpoint',()=>{
 const {encode,decode}=require('../server/game/drift/checkpointCodec'),pc=require('../server/game/drift/pokemonComputer');
 for(const mode of ['rift','colosseum']){
  const a=mon(7),b=mon(4),p={run:{phase:'exploration',mode},currentmap:'centre',x:560,y:304,alive:true,equipe:{pokemons:[a,b]},storage:[],items:{},drifts:[],equipped:[]};
  pc.mutate(p,move(b,team(1),box(5,27)));const saved=decode(encode(p));assert.equal(saved.storage[0].box,5);assert.equal(saved.storage[0].slot,27);assert.equal(saved.storage[0].pokemon.uuid,b.uuid);assert.equal(saved.equipe.pokemons[0].uuid,a.uuid);
 }
});
