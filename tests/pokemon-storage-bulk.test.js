const test=require('node:test'),assert=require('node:assert/strict');
const storage=require('../server/game/storage/pokemonStorage'),factory=require('../server/game/drift/pokemonFactory');
const mon=()=>factory.create(7,25,true),entry=(box,slot)=>({box,slot,pokemon:mon()});
const payload=(entries,selected,box,slot=null)=>({action:'moveMany',moves:selected.map(e=>({pokemonUuid:e.pokemon.uuid,from:{kind:'box',box:e.box,slot:e.slot}})),to:{box,slot,expected:Array.from({length:30},(_,i)=>entries.find(e=>e.box===box&&e.slot===i)?.pokemon.uuid||null)}});
test('group transfer fills only free slots, spans source boxes and preserves Pokémon and original inputs',()=>{
 const team=[mon()],entries=[entry(0,3),entry(1,29),entry(39,0),entry(39,2)];entries[0].pokemon.currentHp=2;entries[0].pokemon.movePp[0]=0;entries[0].pokemon.heldItem='leftovers';
 const before=JSON.stringify({team,entries}),r=storage.planAction(team,entries,payload(entries,entries.slice(0,2),39,1));
 assert.equal(JSON.stringify({team,entries}),before);assert.deepEqual(r.entries.map(e=>[e.box,e.slot]),[[39,1],[39,3],[39,0],[39,2]]);
 for(let i=0;i<entries.length;i++)assert.equal(r.entries[i].pokemon,entries[i].pokemon);
 assert.deepEqual(r.team,team);
});
test('full destination, foreign UUID, duplicate, stale coordinates/destination and malformed input fail without mutation',()=>{
 const team=[mon()],entries=[entry(0,0),entry(0,1),...Array.from({length:29},(_,slot)=>entry(1,slot))],p=payload(entries,entries.slice(0,2),1),before=JSON.stringify({team,entries});
 const invalid=[p,{...p,moves:[]},{...p,moves:Array(31).fill(p.moves[0])},{...p,moves:[p.moves[0],p.moves[0]]},{...p,moves:[{...p.moves[0],pokemonUuid:'foreign'}]},{...p,moves:[{...p.moves[0],from:{kind:'team',index:0}}]},{...p,to:{...p.to,expected:[]}},{...p,to:{...p.to,box:40}},{...p,to:{...p.to,slot:30}}];
 for(const v of invalid)assert.throws(()=>storage.planAction(team,entries,v));assert.equal(JSON.stringify({team,entries}),before);
 const single=payload(entries,[entries[0]],1),r=storage.planAction(team,entries,single);assert.throws(()=>storage.planAction(r.team,r.entries,single),/changé/);
});
test('moving selected slots within a full box rearranges only the selected entries',()=>{
 const team=[mon()],entries=Array.from({length:30},(_,slot)=>entry(0,slot));const r=storage.planAction(team,entries,payload(entries,[entries[1],entries[2]],0,2));
 assert.equal(r.entries[1].slot,2);assert.equal(r.entries[2].slot,1);assert.equal(r.entries[0].slot,0);assert.equal(new Set(r.entries.map(e=>e.slot)).size,30);
});
test('private expedition checkpoint preserves bulk moves and equipment too',()=>{
 const {encode,decode}=require('../server/game/drift/checkpointCodec'),pc=require('../server/game/drift/pokemonComputer');
 for(const mode of['rift','colosseum']){const entries=[entry(0,0),entry(1,0)],p={run:{phase:'exploration',mode},currentmap:'centre',x:560,y:304,alive:true,equipe:{pokemons:[mon()]},storage:entries,items:{},drifts:[],equipped:[]};pc.mutate(p,payload(entries,entries,3));assert.deepEqual(decode(encode(p)).storage.map(e=>[e.box,e.slot]),[[3,0],[3,1]]);}
});
