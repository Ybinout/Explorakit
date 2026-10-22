const test=require('node:test'),assert=require('node:assert/strict');
const weather=()=>import('../vue-explorakit/src/services/worldWeather.js');
function surface(){const calls=[],ctx={};for(const name of ['clearRect','fillRect','beginPath','moveTo','lineTo','stroke','ellipse','save','translate','rotate','fill','restore','bezierCurveTo'])ctx[name]=(...args)=>{assert(args.every(n=>typeof n!=='number'||Number.isFinite(n)),name+' non-finite geometry');calls.push([name,...args]);};const canvas={width:0,height:0,getContext:()=>ctx};return {canvas,ctx,calls};}
test('Routes 13/14 share maximum snowfall, bounded depth particles and no leaves or leakage to caves',async()=>{
 const w=await weather(),get=require('../server/game/world/mapWeather').getMapWeather,p={wind:2,rain:0,snow:3};
 for(const map of ['route13','route14']){
  assert.deepEqual(get(map),{map,kind:'snow',ambience:p});assert.deepEqual(w.mapWorldWeather(map,get(map)),p);
  for(const reason of ['hidden','battle','loading'])assert.equal(w.worldWeatherEnabled(map,{[reason]:true}),false);
  assert.deepEqual(w.mapWorldWeather(map,{...get(map),map:'start'}),{wind:0,rain:0});
 }
 assert.deepEqual(w.worldWeatherBudget(p),{rain:0,leaves:0,gusts:3,splashes:0,snow:480});
 for(const map of ['cave_rochebrume3','ville4','route12','centre'])assert.equal(w.mapWorldWeather(map,get('route13')).snow,undefined);
 const s=surface(),r=new w.WorldWeatherRenderer(()=>s.canvas),target={drawImage(){}};
 r.draw(target,0,p,true,'route13');assert.equal(s.calls.filter(c=>c[0]==='ellipse').length,480);assert.equal(r.impacts.length,0);
 const first=s.calls.slice();r.draw(target,16,p,true,'route13');assert.equal(r.frames,1);
 r.draw(target,35,p,true,'route13');assert.equal(r.frames,2);assert.notDeepEqual(s.calls.slice(first.length),first);
 r.draw(target,1e9,p,true,'route13');assert.equal(r.canvas.width,896);assert.equal(r.canvas.height,640);
 r.draw(target,1e9+50,p,false,'route13');const frames=r.frames;r.draw(target,1e10,p,false,'route13');assert.equal(r.frames,frames);
 r.draw(target,1e10+50,{wind:0,rain:0,snow:3},true,'route14');assert(r.canvas,'snow can fall without wind');
 r.draw(target,1e10+100,{wind:0,rain:0});assert.equal(r.canvas,null);r.destroy();assert.equal(s.canvas.width,0);
 assert.deepEqual(w.normalizeWorldWeather({snow:99}),{wind:0,rain:0,snow:3});
});
test('weather intensity is authoritative for every map and accepts only bounded display levels',async()=>{
 const w=await weather(),{getMapWeather}=require('../server/game/world/mapWeather');
 for(const map of ['start','route1','route2']){const climate=getMapWeather(map);assert.deepEqual(w.mapWorldWeather(map,climate),map==='start'?{wind:3,rain:3}:{wind:1,rain:1});}
 assert.deepEqual(w.normalizeWorldWeather({wind:99,rain:'2',extra:true}),{wind:3,rain:2});assert.deepEqual(w.normalizeWorldWeather({wind:Infinity,rain:-2}),{wind:0,rain:0});assert.deepEqual(w.normalizeWorldWeather(null),{wind:0,rain:0});
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

test('map ambience follows its server climate without stale-map leakage',async()=>{
 const {mapWorldWeather:settings}=await weather();for(const map of ['route1','route2']){const climate=require('../server/game/world/mapWeather').getMapWeather(map);assert.deepEqual(settings(map,climate),{wind:1,rain:1});assert.deepEqual(settings(map,{...climate,map:'start'}),{wind:0,rain:0});}
 assert.deepEqual(settings('start',null),{wind:0,rain:0});assert.deepEqual(settings('maison2',null),{wind:0,rain:0});
});

test('Rochebrume and Route12 share visible wind/sand, without rain, leaves or leakage indoors or on Route11',async()=>{
 const w=await weather(),get=require('../server/game/world/mapWeather').getMapWeather;
 for(const map of ['ville4','route12']){
  const climate=get(map);
  assert.deepEqual(climate,{map,kind:'sandstorm',ambience:{wind:2,rain:0,sand:2}});
  assert.deepEqual(w.mapWorldWeather(map,climate),{wind:2,rain:0,sand:2});
  assert.deepEqual(w.worldWeatherBudget(climate.ambience),{rain:0,leaves:0,gusts:3,splashes:0,sand:68});
  for(const interior of ['ville4_arene','ville4_shop','ville4_maison1','centre','route11','ville_safe1']){
   assert.deepEqual(w.mapWorldWeather(interior,climate),{wind:0,rain:0});assert.equal(get(interior).kind,null);
  }
  for(const reason of ['hidden','battle','loading'])assert.equal(w.worldWeatherEnabled(map,{[reason]:true}),false);
  assert.deepEqual(w.mapWorldWeather(map,{...climate,map:'start'}),{wind:0,rain:0});
 }
});

test('sand particles are bounded, cached at 30 Hz, static in reduced motion, and cleaned up on departure',async()=>{
 const {WorldWeatherRenderer,worldWeatherBudget}=await weather(),s=surface(),r=new WorldWeatherRenderer(()=>s.canvas),target={drawImage(){}};
 for(let sand=1;sand<=3;sand++){const b=worldWeatherBudget({wind:1,rain:0,sand});assert(b.sand<=112);assert.equal(b.leaves,0);assert.equal(b.rain,0);}
 const profile={wind:1,rain:0,sand:1};
 r.draw(target,0,profile,true,'ville4');assert.equal(s.calls.filter(c=>c[0]==='ellipse').length,32);assert(s.calls.filter(c=>c[0]==='bezierCurveTo').length>=8,'dust trails remain spread across the mobile viewport');assert.equal(r.impacts.length,0);
 r.draw(target,10,profile,true,'ville4');assert.equal(r.frames,1);r.draw(target,35,profile,true,'ville4');assert.equal(r.frames,2);
 r.draw(target,40,profile,false,'ville4');const frames=r.frames;r.draw(target,1e8,profile,false,'ville4');assert.equal(r.frames,frames);
 r.draw(target,1e8+50,{wind:0,rain:0,sand:1},true,'ville4');assert(r.canvas,'sand also works without wind');
 r.draw(target,1e8+100,{wind:0,rain:0});assert.equal(r.canvas,null);r.destroy();assert.equal(s.canvas.width,0);
});
test('map impacts stay on authoritative uncovered ground, bounded within their tile, below actors and absent in reduced motion',async()=>{
 const {worldRainImpacts,WorldWeatherRenderer}=await weather();let total=0;
 for(const map of ['start','route1','route2']){const before=total;const source=require('../data/maps/'+map+'.json'),layers=source.layers.filter(l=>['coll','change','int','foreground','for2'].includes(l.name));for(let t=0;t<6000;t+=70){const impacts=worldRainImpacts(t,3,map);assert(impacts.length<=48);for(const p of impacts){total++;const x=Math.floor(p.x/32),y=Math.floor(p.y/32);assert(layers.every(l=>!l.data[y*28+x]),map+' covered/blocked tile');assert(p.radius<=4.4&&p.alpha>0&&p.alpha<=.68);assert(p.x-p.radius>x*32&&p.x+p.radius<(x+1)*32);assert(p.y-p.radius>y*32&&p.y+p.radius<(y+1)*32);}}assert(total-before>100,map+' must have visible ground impacts');}
 assert(total>100);assert.deepEqual(worldRainImpacts(500,3,'maison2'),[]);assert.deepEqual(worldRainImpacts(500,0,'start'),[]);
 const s=surface(),r=new WorldWeatherRenderer(()=>s.canvas);r.drawGround(s.ctx,0,{wind:1,rain:1},true,'route1');assert(r.impacts.length>0);r.draw({drawImage(){}},0,{wind:1,rain:1},true,'route1');assert.equal(r.frames,1);assert(s.calls.some(c=>c[0]==='ellipse'));r.drawGround(s.ctx,100,{wind:1,rain:1},false,'route1');assert.equal(r.impacts.length,0);r.suspend();assert.equal(r.impacts.length,0);
});
