const test=require('node:test'),assert=require('node:assert/strict');
const atlas={width:512,height:448};
test('regional map zoom fits the complete atlas, preserves its ratio and bounds zoom/scroll',async()=>{
 const {mapLayout,clampMapZoom,anchoredMapScroll}=await import('../vue-explorakit/src/services/regionMapViewport.js');
 for(const viewport of [{width:304,height:250},{width:540,height:200},{width:380,height:420}]){
  const fit=mapLayout(atlas,viewport,1);assert(fit.mapWidth<=viewport.width+.001);assert(fit.mapHeight<=viewport.height+.001);assert(Math.abs(fit.mapWidth/fit.mapHeight-512/448)<1e-12);
  for(const zoom of [1,1.25,2,4]){const layout=mapLayout(atlas,viewport,zoom);assert.equal(layout.mapWidth,fit.mapWidth*zoom);const position=anchoredMapScroll(fit,layout,{x:0,y:0},{x:viewport.width/2,y:viewport.height/2});assert(position.x>=0&&position.y>=0);assert(position.x<=Math.max(0,layout.mapWidth-viewport.width));assert(position.y<=Math.max(0,layout.mapHeight-viewport.height));}
 }
 assert.equal(clampMapZoom(.5),1);assert.equal(clampMapZoom(10),4);assert.equal(clampMapZoom(NaN),1);
});
test('zoom keeps the pointed location under the cursor/fingers and overview resets scroll',async()=>{
 const {mapLayout,anchoredMapScroll}=await import('../vue-explorakit/src/services/regionMapViewport.js');
 const viewport={width:400,height:350},before=mapLayout(atlas,viewport,2),after=mapLayout(atlas,viewport,3),scroll={x:160,y:90},anchor={x:190,y:140},next={x:210,y:155};
 const result=anchoredMapScroll(before,after,scroll,anchor,next);
 for(const axis of ['x','y']){const dim=axis==='x'?'mapWidth':'mapHeight',offset=axis==='x'?'offsetX':'offsetY';assert(Math.abs((scroll[axis]+anchor[axis]-before[offset])/before[dim]-(result[axis]+next[axis]-after[offset])/after[dim])<1e-10);}
 assert.deepEqual(anchoredMapScroll(after,mapLayout(atlas,viewport,1),result,next),{x:0,y:0});
});
