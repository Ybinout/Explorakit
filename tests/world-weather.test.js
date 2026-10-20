const test=require('node:test'),assert=require('node:assert/strict');
const weather=()=>import('../vue-explorakit/src/services/worldWeather.js');
function surface(){const calls=[],ctx={};for(const name of ['clearRect','fillRect','beginPath','moveTo','lineTo','stroke','ellipse','save','translate','rotate','fill','restore','bezierCurveTo'])ctx[name]=(...args)=>{assert(args.every(n=>typeof n!=='number'||Number.isFinite(n)),name+' non-finite geometry');calls.push([name,...args]);};const canvas={width:0,height:0,getContext:()=>ctx};return {canvas,ctx,calls};}
test('weather preferences are bounded, durable and tolerate corrupt or unavailable storage',async()=>{
 const w=await weather(),memory=new Map(),storage={getItem:key=>memory.get(key),setItem:(key,value)=>memory.set(key,value)};
 memory.set('riftmon.worldWeatherPreview',JSON.stringify({wind:1,rain:1}));
 assert.deepEqual(w.loadWorldWeather(storage),{wind:3,rain:3});
 assert.deepEqual(w.saveWorldWeather({wind:99,rain:'2',extra:true},storage),{wind:3,rain:2});assert.deepEqual(w.loadWorldWeather(storage),{wind:3,rain:2});
 memory.set(w.WORLD_WEATHER_KEY,'broken');assert.deepEqual(w.loadWorldWeather(storage),w.DEFAULT_WORLD_WEATHER);
 const denied={getItem(){throw Error('denied');},setItem(){throw Error('denied');}};assert.deepEqual(w.loadWorldWeather(denied),w.DEFAULT_WORLD_WEATHER);assert.deepEqual(w.saveWorldWeather({wind:2,rain:0},denied),{wind:2,rain:0});
 assert.deepEqual(w.normalizeWorldWeather({wind:Infinity,rain:-2}),{wind:0,rain:0});assert.deepEqual(w.normalizeWorldWeather(null),{wind:0,rain:0});
});
test('weather covers the village and the two rainy routes, never interiors, battles, loading or hidden tabs',async()=>{
 const {worldWeatherEnabled:enabled}=await weather();for(const map of ['start','route1','route2'])assert(enabled(map));
 for(const map of ['maison','ville1','route3','cave1','ville_safe1',null])assert(!enabled(map));for(const reason of ['hidden','battle','loading'])assert(!enabled('start',{[reason]:true}));
});
test('four intensity levels have separate, monotone and bounded particle budgets',async()=>{
 const {worldWeatherBudget:budget}=await weather();let previous={rain:-1,leaves:-1};for(let i=0;i<4;i++){const b=budget({wind:i,rain:i});assert(b.rain>previous.rain&&b.leaves>previous.leaves);assert(Object.values(b).reduce((a,b)=>a+b,0)<=210);previous=b;}
 assert.deepEqual(budget({wind:0,rain:0}),{rain:0,leaves:0,gusts:0,splashes:0});assert.equal(budget({wind:3,rain:0}).rain,0);assert.equal(budget({wind:0,rain:3}).leaves,0);
});
test('weather reuses one fixed-size surface, repaints at most 30 Hz, updates choices immediately and releases memory',async()=>{
 const {WorldWeatherRenderer}=await weather(),surfaces=[],target={drawImage(...args){assert.equal(args.length,5);}};
 const renderer=new WorldWeatherRenderer(()=>{const s=surface();surfaces.push(s);return s.canvas;});
 for(const t of [0,1,16,32,34])renderer.draw(target,t,{wind:3,rain:3});assert.equal(renderer.frames,2);assert.equal(surfaces.length,1);assert.equal(surfaces[0].canvas.width,896);assert.equal(surfaces[0].canvas.height,640);
 renderer.draw(target,35,{wind:1,rain:2});assert.equal(renderer.frames,3);
 renderer.draw(target,1e9,{wind:3,rain:3});assert(surfaces[0].calls.some(c=>c[0]==='bezierCurveTo'));assert(surfaces[0].calls.some(c=>c[0]==='ellipse'));
 renderer.suspend();assert.equal(surfaces[0].canvas.width,0);assert.equal(renderer.canvas,null);renderer.draw(target,1e9+40,{wind:1,rain:1});assert.equal(surfaces.length,2);
 renderer.draw(target,1e9+41,{wind:0,rain:0});assert.equal(renderer.canvas,null);
 renderer.destroy();renderer.draw(target,1e9+99,{wind:3,rain:3});assert.equal(surfaces.length,2);
});
test('reduced motion renders a stable frame and does not accumulate paint work over time',async()=>{
 const {WorldWeatherRenderer}=await weather(),renderer=new WorldWeatherRenderer(()=>surface().canvas),target={drawImage(){}};
 renderer.draw(target,0,{wind:3,rain:3},false);for(const t of [16,34,1e6])renderer.draw(target,t,{wind:3,rain:3},false);assert.equal(renderer.frames,1);
 renderer.draw(target,1e6+1,{wind:2,rain:1},false);assert.equal(renderer.frames,2);renderer.draw(target,1e6+40,{wind:2,rain:1},true);assert.equal(renderer.frames,3);
});

test('route ambience follows its server climate, independently from the village preview and with no stale-map leakage',async()=>{
 const {mapWorldWeather:settings}=await weather();for(const map of ['route1','route2']){const climate=require('../server/game/world/mapWeather').getMapWeather(map);assert.deepEqual(settings(map,{wind:3,rain:3},climate),{wind:1,rain:1});assert.deepEqual(settings(map,{wind:0,rain:0},climate),{wind:1,rain:1});assert.deepEqual(settings(map,{wind:3,rain:3},{...climate,map:'start'}),{wind:0,rain:0});}
 assert.deepEqual(settings('start',{wind:2,rain:0},null),{wind:2,rain:0});assert.deepEqual(settings('maison2',{wind:3,rain:3},null),{wind:0,rain:0});
});
test('map impacts stay on authoritative uncovered ground, bounded within their tile, below actors and absent in reduced motion',async()=>{
 const {worldRainImpacts,WorldWeatherRenderer}=await weather();let total=0;
 for(const map of ['start','route1','route2']){const before=total;const source=require('../data/maps/'+map+'.json'),layers=source.layers.filter(l=>['coll','change','int','foreground','for2'].includes(l.name));for(let t=0;t<6000;t+=70){const impacts=worldRainImpacts(t,3,map);assert(impacts.length<=48);for(const p of impacts){total++;const x=Math.floor(p.x/32),y=Math.floor(p.y/32);assert(layers.every(l=>!l.data[y*28+x]),map+' covered/blocked tile');assert(p.radius<=4.4&&p.alpha>0&&p.alpha<=.68);assert(p.x-p.radius>x*32&&p.x+p.radius<(x+1)*32);assert(p.y-p.radius>y*32&&p.y+p.radius<(y+1)*32);}}assert(total-before>100,map+' must have visible ground impacts');}
 assert(total>100);assert.deepEqual(worldRainImpacts(500,3,'maison2'),[]);assert.deepEqual(worldRainImpacts(500,0,'start'),[]);
 const s=surface(),r=new WorldWeatherRenderer(()=>s.canvas);r.drawGround(s.ctx,0,{wind:1,rain:1},true,'route1');assert(r.impacts.length>0);r.draw({drawImage(){}},0,{wind:1,rain:1},true,'route1');assert.equal(r.frames,1);assert(s.calls.some(c=>c[0]==='ellipse'));r.drawGround(s.ctx,100,{wind:1,rain:1},false,'route1');assert.equal(r.impacts.length,0);r.suspend();assert.equal(r.impacts.length,0);
});
