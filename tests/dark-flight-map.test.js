const test=require('node:test'),assert=require('node:assert/strict');
test('dark flight exposes only server-approved visited landing points and preserves native coordinates',async()=>{
 const {darkFlightNodes}=await import('../vue-explorakit/src/services/darkFlightMap.js');
 const atlas={nodes:[{id:'start',x:1,y:2,kind:'town'},{id:'jungle1',x:300,y:200,kind:'route'},{id:'jungle9',x:400,y:200,kind:'route'},{id:'DC2_44',x:900,y:500,kind:'route'}]},before=JSON.stringify(atlas);
 const flight={unlocked:true,owned:true,darkAerial:{active:true},darkDestinations:['jungle1','DC2_44','jungle9','start']};
 assert.deepEqual(darkFlightNodes(atlas,flight),[{...atlas.nodes[1],kind:'flight'},{...atlas.nodes[3],kind:'flight'}]);
 assert.equal(JSON.stringify(atlas),before);
 for(const state of[null,{...flight,unlocked:false},{...flight,owned:false},{...flight,darkAerial:{active:false}},{...flight,darkDestinations:[]}])assert.deepEqual(darkFlightNodes(atlas,state),[]);
 assert.deepEqual(darkFlightNodes(atlas,{...flight,darkDestinations:['jungle1']}),[{...atlas.nodes[1],kind:'flight'}]);
 assert.deepEqual(darkFlightNodes({nodes:atlas.nodes.slice(0,3)},flight),[{...atlas.nodes[1],kind:'flight'}],'continent remains hidden without its chart');
 assert.deepEqual(darkFlightNodes(null,flight),[]);
});
