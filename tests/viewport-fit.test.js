const test=require('node:test'),assert=require('node:assert/strict');
test('windowed game fits width and remaining height, preserves 7:5 world and never enlarges beyond native width',async()=>{
 const {fittedGameWidth:fit}=await import('../vue-explorakit/src/services/gameFullscreen.js');
 for(const[width,height]of [[2560,1440],[1920,880],[1707,900],[1536,680],[1440,720],[1366,660],[1280,660],[1024,600]])for(const toolbar of [64,86,110]){
  const availableWidth=width-32,availableHeight=height-24,result=fit(availableWidth,availableHeight,toolbar);
  assert(result<=896&&result<=availableWidth);assert(result*5/7+toolbar<=availableHeight+1e-8);
  assert(result+1>Math.min(896,availableWidth,(availableHeight-toolbar)*7/5));
 }
 assert.equal(fit(1504,656,64),828);assert.equal(fit(1888,1056,64),896);
});
test('fullscreen may enlarge while retaining exact proportions; taller toolbars reduce the world instead of clipping it',async()=>{
 const {fittedGameWidth:fit}=await import('../vue-explorakit/src/services/gameFullscreen.js');
 const ordinary=fit(1920,1080,64),full=fit(1920,1080,64,true),tall=fit(1920,1080,120,true);
 assert.equal(ordinary,896);assert(full>ordinary);assert(tall<full);assert(full*5/7+64<=1080);assert(tall*5/7+120<=1080);
 assert.equal(fit(1,1,64),1);
});
