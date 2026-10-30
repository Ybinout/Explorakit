const test=require('node:test'),assert=require('node:assert/strict');
test('animated upload is cropped, reuses the same surface and replaces translucent native pixels before compositing',async()=>{
 const {PixelUploadPatch}=await import('../vue-explorakit/src/services/pixelUploadPatch.js');
 const uploads=[],canvas={width:0,height:0,getContext:()=>({putImageData:(...args)=>uploads.push(args)})};
 const patch=new PixelUploadPatch(()=>canvas,10,Uint32Array.of(22,24,43));
 assert.deepEqual([patch.left,patch.top,patch.width,patch.height],[2,2,3,3]);
 const frame={data:new Uint8ClampedArray(400)};patch.upload(frame);patch.upload(frame);
 assert.equal(uploads.length,2);assert.deepEqual(uploads[0],[frame,-2,-2,2,2,3,3]);assert.equal(patch.canvas,canvas);
 const draws=[];patch.draw({clearRect:(...args)=>draws.push(['clear',...args]),drawImage:(...args)=>draws.push(['draw',...args])});
 assert.deepEqual(draws,[['clear',2,2,3,3],['draw',canvas,2,2]]);
 patch.destroy();assert.equal(canvas.width,0);assert.equal(canvas.height,0);assert.equal(patch.context,null);
});
test('empty masks neither upload nor draw; a missing context releases its partial allocation',async()=>{
 const {PixelUploadPatch}=await import('../vue-explorakit/src/services/pixelUploadPatch.js');
 const canvas={width:0,height:0,getContext:()=>({putImageData:()=>assert.fail('Empty patch uploaded')})};
 const p=new PixelUploadPatch(()=>canvas,10,new Uint32Array());p.upload({});p.draw({drawImage:()=>assert.fail('Empty patch painted')});p.destroy();
 const broken={width:0,height:0,getContext:()=>null};assert.throws(()=>new PixelUploadPatch(()=>broken,10,Uint32Array.of(12)));assert.equal(broken.width,0);assert.equal(broken.height,0);
});
test('broad animated regions avoid an unnecessary intermediate canvas and GPU copy',async()=>{
 const {PixelUploadPatch}=await import('../vue-explorakit/src/services/pixelUploadPatch.js');
 const patch=new PixelUploadPatch(()=>assert.fail('Large patch allocated another surface'),10,Uint32Array.of(1,8,91,98),10);
 assert(patch.direct);const frame={data:new Uint8ClampedArray(400)},calls=[];
 patch.upload(frame,{putImageData:(...args)=>calls.push(args)});patch.draw({drawImage:()=>assert.fail('Large patch composited twice')});
 assert.deepEqual(calls,[[frame,0,0]]);patch.destroy();assert.equal(patch.context,null);
});
