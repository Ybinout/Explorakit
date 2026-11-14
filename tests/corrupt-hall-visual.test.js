const test=require('node:test'),assert=require('node:assert/strict');
test('House lanterns have bounded independent flicker with continuous transitions',async()=>{
 const {hallLightFlicker:f}=await import('../vue-explorakit/src/services/battleHallDetails.js');let min=1,max=0,delta=0;for(let n=0;n<2400;n++){const t=n/40,a=f(t,.13),b=f(t,.67);assert(Number.isFinite(a)&&a>=.35&&a<=.95);min=Math.min(min,a);max=Math.max(max,a);if(n)delta=Math.max(delta,Math.abs(a-f(t-.025,.13)));if(n%30===0)assert.notEqual(a,b);}assert(max-min>.25);assert(delta<.025);
});
test('window masks retain the winter view and exclude dark frames, stone and golden lights',async()=>{
 const {hallGlassPixel:glass}=await import('../vue-explorakit/src/services/battleHallDetails.js');for(const p of [[110,163,212],[226,239,245],[70,135,180]])assert.equal(glass(...p),255);for(const p of [[42,66,97],[132,120,112],[250,180,70],[0,0,0]])assert.equal(glass(...p),0);
});
test('three snow depths stay within the panes with readable sizes and soft appearance/disappearance',async()=>{
 const {hallSnowParticle:snow}=await import('../vue-explorakit/src/services/battleHallDetails.js');const bounds=[10,20,130,170],depth=new Set();for(let i=0;i<36;i++)for(const t of [0,1,8.5,60])for(const scale of [.15,.5,1,2]){const p=snow(i,t,bounds,scale);depth.add(p.depth);assert(p.x>=10&&p.x<=140&&p.y>=20&&p.y<=190);assert(p.alpha>=0&&p.alpha<=1);assert(p.radius*scale>=.8-1e-9);}assert.equal(depth.size,3);
});
test('only House backgrounds gain these windows and correctly positioned four/two pennants',async()=>{
 const {ambienceProfile,BATTLE_AMBIENCES}=await import('../vue-explorakit/src/services/battleAmbienceProfiles.js');for(const env of Object.keys(BATTLE_AMBIENCES)){const p=ambienceProfile(env);if(['whitepeak-club','double-hall'].includes(env)){assert(p.hallDetail);assert.equal(p.windows.length,3);assert.equal(p.particles,'snow-window');assert.equal(p.zones.length,env==='whitepeak-club'?4:2);assert(p.zones.every(z=>z.pennant&&z.shade&&z.kind==='cloth'));for(const [x,y,w,h]of p.windows)assert(x>=0&&y>=0&&x+w<=1.001&&y+h<=1.001);}else assert(!p.hallDetail);}
 const {battleEnvironment}=await import('../vue-explorakit/src/services/battleEnvironment.js');assert.equal(battleEnvironment('ville5_maison1'),'whitepeak-club');assert.equal(battleEnvironment('route1',false,null,'whitepeak-club'),'whitepeak-club');
});
test('glass caches are explicitly released with the renderer and negative allocations are harmless',async()=>{
 const {releaseHallWindows}=await import('../vue-explorakit/src/services/battleHallDetails.js'),mask={width:128,height:128},layer={width:128,height:128},r={hallWindows:new Map([['ok',{mask,layer}],['unsupported',null]]),hallWindowBytes:131072,stats:{windowCacheBytes:131072}};releaseHallWindows(r);assert.equal(mask.width,0);assert.equal(layer.height,0);assert.equal(r.hallWindows.size,0);assert.equal(r.hallWindowBytes,0);assert.equal(r.stats.windowCacheBytes,0);releaseHallWindows(r);
});
