const test = require('node:test'), assert = require('node:assert/strict');
const service = () => import('../vue-explorakit/src/services/villageWater.js');
function artwork() {
  const data = new Uint8ClampedArray(448 * 320 * 4), put = (x, y, color) => data.set(color, (y * 448 + x) * 4);
  for (let y = 250; y < 310; y++) for (let x = 60; x < 140; x++) put(x, y, x % 3 ? [81,145,177,255] : [56,109,139,255]);
  put(90, 270, [133,110,103,255]); put(70, 260, [81,145,177,100]); put(20, 20, [81,145,177,255]);
  return { data, put };
}
function surfaces(data = artwork().data) {
  const all = [];
  return { all, create() {
    const canvas = { width: 0, height: 0 };
    canvas.getContext = () => ({ drawImage() {}, getImageData: () => ({data: new Uint8ClampedArray(data)}), createImageData: () => ({data: new Uint8ClampedArray(data.length)}), putImageData() {} });
    all.push(canvas); return canvas;
  } };
}
test('lake current keeps rocks, transparent pixels, shore margin and all scenery outside the pond fixed', async () => {
  const { VillageWaterRenderer } = await service(), surfaces_ = surfaces(), renderer = new VillageWaterRenderer(() => surfaces_.create());
  renderer.draw({drawImage() {}}, {}, 200);
  const original = renderer.original.slice(), first = renderer.output.slice();
  renderer.draw({drawImage() {}}, renderer.source, 2300);
  let changed = 0;
  for (let i = 0; i < original.length; i++) {
    if (first[i] !== renderer.output[i]) changed++;
    if (!renderer.mask.interior[i]) assert.equal(renderer.output[i], original[i]);
    assert.equal(renderer.frame.data[i * 4 + 3], 255 & (original[i] >>> 24));
  }
  assert(changed > 100);
  for (const [x,y] of [[20,20],[60,280],[90,270],[89,270],[70,260],[70,259]]) assert.equal(renderer.mask.interior[y * 448 + x], 0);
});
test('lake uses a cached native-size surface at 15 Hz and releases it for reduced motion or destruction', async () => {
  const { VillageWaterRenderer } = await service(), s = surfaces(), r = new VillageWaterRenderer(() => s.create()), image = {}, calls = [], target = {drawImage: (...args) => calls.push(args)};
  r.draw(target, image, 0); for (const t of [1,16,33,66]) r.draw(target, image, t);
  assert.equal(r.frames, 1); r.draw(target, image, 67); assert.equal(r.frames, 2);
  assert.equal(s.all.length, 1); assert.equal(r.canvas.width, 448); assert.equal(r.canvas.height, 320);
  r.draw(target, image, 70, false); assert.equal(r.canvas, null); assert.equal(r.mask, null);
  assert.equal(s.all[0].width, 0); assert.deepEqual(calls.at(-1), [image,0,0,896,640]);
  r.draw(target, image, 100); assert.equal(s.all.length, 2); r.destroy(); r.draw(target, image, 200);
  assert.equal(s.all.length, 2); assert.equal(r.original, null); assert.equal(r.colors, null);
  assert(s.all.every(c => c.width === 0 && c.height === 0));
});
test('unreadable lake pixels fall back to the unchanged map', async () => {
  const { VillageWaterRenderer } = await service(), calls = [], image = {};
  for (const create of [() => ({getContext: () => null}), () => ({getContext: () => ({drawImage() {}, getImageData() { throw Error('unreadable'); }})})]) {
    const r = new VillageWaterRenderer(create); r.draw({drawImage: (...args) => calls.push(args)}, image, 0);
    assert.equal(r.canvas, null); assert.deepEqual(calls.at(-1), [image,0,0,896,640]);
  }
});
test('Ville du Lac animates only its own water colors and clears its profile on map changes', async () => {
  const { VillageWaterRenderer, villageWaterMask, hasVillageWater } = await service();
  const {data, put} = artwork();
  for (let y = 28; y < 140; y++) for (let x = 250; x < 408; x++) put(x, y, x % 3 ? [48,176,240,255] : [64,184,240,255]);
  put(280,40,[149,172,158,255]); // Rock and its fixed margin.
  put(390,120,[48,176,240,80]);
  const s = surfaces(data), r = new VillageWaterRenderer(() => s.create()), image = {}, target = {drawImage() {}};
  assert.equal(hasVillageWater('ville1'), true); assert.equal(hasVillageWater('route1'), false); assert.equal(hasVillageWater('toString'), false);
  r.draw(target,image,200,true,'ville1'); const first=r.output.slice();
  r.draw(target,image,2300,true,'ville1'); let changed=0;
  for(let i=0;i<first.length;i++) {
    if(first[i]!==r.output[i]) changed++;
    if(!r.mask.interior[i]) assert.equal(r.output[i],r.original[i]);
    assert.equal(r.frame.data[i*4+3],data[i*4+3]);
  }
  assert(changed>100);
  for(const [x,y] of [[280,40],[279,40],[390,120],[389,120],[250,70],[90,280]]) assert.equal(r.mask.interior[y*448+x],0);
  r.draw(target,image,2400,true,'start'); assert.equal(s.all[0].width,0); assert.equal(r.map,'start'); assert.equal(r.mask.interior[80*448+300],0);
  r.draw(target,image,2500,true,'route1'); assert.equal(r.canvas,null); assert.equal(villageWaterMask(data,'route1').pixels.length,0);
});
test('Valpierre and Ocreville lakes animate only their mapped water, including rock margins',async()=>{
 const {VillageWaterRenderer,hasVillageWater}=await service();
 for(const [map,bounds] of [['ville_safe1',[37,107,184,237]],['gen_ville5',[373,411,104,141]]]){
  const [left,right,top,bottom]=bounds,{data,put}=artwork();for(let y=top;y<bottom;y++)for(let x=left;x<right;x++)put(x,y,[48,176,240,255]);const rx=left+10,ry=top+10;put(rx,ry,[149,172,158,255]);
  const s=surfaces(data),r=new VillageWaterRenderer(()=>s.create()),target={drawImage(){}};assert(hasVillageWater(map));r.draw(target,{},200,true,map);const before=r.output.slice();r.draw(target,r.source,600,true,map);let changed=0;
  for(let i=0;i<before.length;i++){if(before[i]!==r.output[i])changed++;if(!r.mask.interior[i])assert.equal(r.output[i],r.original[i]);assert.equal(r.frame.data[i*4+3],data[i*4+3]);}
  assert(changed>r.mask.pixels.length*.4);assert(!r.mask.interior[ry*448+rx]);assert(!r.mask.interior[ry*448+rx-1]);r.destroy();
 }
});
test('every currently fishable lake has an animation profile',async()=>{
 const {hasVillageWater}=await service();for(const map of Object.keys(require('../data/game/fishing_waters.json').maps))assert(hasVillageWater(map),map);
});
