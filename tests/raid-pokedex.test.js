const test=require('node:test'),assert=require('node:assert/strict'),codec=require('../server/game/drift/checkpointCodec'),{encounters}=require('../scripts/backfillRaidPokedex');
test('raid history marks only actual participants, not training or reserved viewers, and merges shiny encounters',()=>{
 const run={phase:'won',rift:{},members:[{id:1},{id:2},{id:3,reserved:true},{id:4}],combat:{boss:{data:{id:149},shiny:false},models:[{ownerId:1},{ownerId:2},{ownerId:3}]}};
 const row=r=>({snapshot:codec.encode(r)});
 const result=encounters([row(run),row({...run,combat:{...run.combat,boss:{data:{id:149},shiny:true}}}),row({...run,rift:{training:true}}),row({...run,phase:'lobby'})]);
 assert.deepEqual(result,[{userId:1,pokemonId:149,shiny:true},{userId:2,pokemonId:149,shiny:true}]);
});
