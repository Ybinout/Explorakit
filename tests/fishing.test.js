const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const {createFishingController,CAST_MS,REACTION_MS,OFFER_MS}=require('../server/game/world/fishingController');
const {waterNear}=require('../server/game/world/fishingWaters'),{fishingEncounter,profiles}=require('../server/game/world/fishingEncounters');
const waters=require('../data/game/fishing_waters.json'),maps=require('../server/game/world/mapRepository');
function fixture(options={}){
 let time=1000,n=0;const timers=new Map(),events=[],hooks=[],p={x:80,y:144,currentmap:'start',rod:true,ready:true};
 const c=createFishingController({nearWater:()=>({x:90,y:180,direction:'down'}),ownsRod:p=>p.rod,available:p=>p.ready,emit:(p,e,s)=>events.push(s),onHook:p=>hooks.push(p),now:()=>time,random:()=>0,setTimer:(fn,ms)=>{timers.set(++n,{fn,at:time+ms});return n;},clearTimer:id=>timers.delete(id),...options});
 async function advance(ms){const end=time+ms;while(true){const next=[...timers].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;time=next[1].at;timers.delete(next[0]);next[1].fn();await Promise.resolve();}time=end;await Promise.resolve();}
 return {p,c,events,hooks,timers,advance};
}
test('fishing: server timing, early/late reel, success exactly once and replay refusal',async()=>{
 const f=fixture(),{p,c}=f;
 assert(await c.offer(p));let id=c.current(p).id;
 assert.equal(c.start(p,'forged'),false);assert(c.start(p,id));assert.equal(c.current(p).phase,'casting');
 assert.equal(c.reel(p,id),false);assert.match(f.events.at(-1).message,/Trop tôt/);assert.equal(f.timers.size,0);
 await f.advance(701);await c.offer(p);id=c.current(p).id;c.start(p,id);
 await f.advance(CAST_MS+2200);assert.equal(c.current(p).phase,'bite');assert.equal(c.current(p).deadline, f.events.at(-1).serverNow+REACTION_MS);
 await f.advance(REACTION_MS+151);assert.equal(c.current(p),undefined);assert.match(f.events.at(-1).message,/échappé/);assert.equal(f.hooks.length,0);
 await f.advance(701);await c.offer(p);id=c.current(p).id;c.start(p,id);await f.advance(CAST_MS+2200);
 assert(c.reel(p,id));assert.equal(c.reel(p,id),false);await f.advance(250);assert.equal(f.hooks.length,1);assert.equal(c.reel(p,id),false);assert.equal(f.timers.size,0);
});
test('fishing: no rod, water, living team or active session means no offer',async()=>{
 for(const options of[{ownsRod:()=>false},{available:()=>false},{nearWater:()=>null}]){const f=fixture(options);assert.equal(await f.c.offer(f.p),false);assert.equal(f.events.length,0);}
});
test('fishing: movement, teleport, elimination, menu/disconnect cancellation never hook',async()=>{
 for(const phase of['offer','casting','waiting','bite','hooked'])for(const change of[p=>p.x+=32,p=>p.currentmap='ville1',p=>p.ready=false,p=>null]){
  const f=fixture(),{p,c}=f;await c.offer(p);const id=c.current(p).id;if(phase!=='offer')c.start(p,id);if(['waiting','bite','hooked'].includes(phase))await f.advance(CAST_MS);if(['bite','hooked'].includes(phase))await f.advance(2200);if(phase==='hooked')c.reel(p,id);
  change(p);if(p.ready&&p.currentmap==='start'&&p.x===80)c.cancel(p);else c.prune();
  await f.advance(30000);assert.equal(f.hooks.length,0,phase);assert.equal(f.timers.size,0);assert.equal(c.current(p),undefined);
 }
});
test('fishing: stale ownership query cannot resurrect a cast after cancellation or position change',async()=>{
 let resolve;const f=fixture({ownsRod:()=>new Promise(r=>resolve=r)});const offer=f.c.offer(f.p);assert.equal(await f.c.offer(f.p),false);f.c.cancel(f.p);resolve(true);assert.equal(await offer,false);assert.equal(f.events.length,0);
 const next=f.c.offer(f.p);f.p.y+=32;resolve(true);assert.equal(await next,false);
});
test('fishing: offer expires, random wait is private, stop frees all timers',async()=>{
 const f=fixture();await f.c.offer(f.p);assert(!('expiresAt' in f.events[0]));await f.advance(OFFER_MS);assert.equal(f.c.current(f.p),undefined);await f.c.offer(f.p);f.c.start(f.p,f.c.current(f.p).id);assert(!('deadline' in f.events.at(-1)));f.c.stop();assert.equal(f.timers.size,0);
});
test('fishing: all six lakes have real shoreline targets and exact current author provenance',()=>{
 assert.deepEqual(Object.keys(waters.maps).sort(),['start','ville1','route3','gen_ville5','ville_safe1','ville3'].sort());const hash=p=>createHash('sha256').update(fs.readFileSync(path.resolve(__dirname,'..',p))).digest('hex');
 for(const [mapName,profile]of Object.entries(waters.maps)){
  assert.equal(hash('vue-explorakit/src/assets/'+profile.source+'.png'),profile.imageSha256);assert.equal(hash('data/maps/'+profile.source+'.json'),profile.mapSha256);
  const water=new Set(profile.cells.map(c=>c.tile)),collision=maps.loadCollisionData(mapName);let banks=0;
  for(let y=0;y<20;y++)for(let x=0;x<28;x++){
   const p={currentmap:mapName,x:x*32+16,y:y*32+16},near=waterNear(p);
   if(water.has(y*28+x)||collision[y]?.[x]!==0){assert.equal(near,null);continue;}
   if(near){banks++;assert(water.has(Math.floor(near.y/32)*28+Math.floor(near.x/32)));assert.equal(Math.abs(Math.floor(near.x/32)-x)+Math.abs(Math.floor(near.y/32)-y),1);}
  }assert(banks>=2,mapName);
 }
 assert.equal(waterNear({currentmap:'route1',x:80,y:80}),null);
});
test('fishing: varied aquatic pools follow zone levels, rare fish stay rare',()=>{
 const zones=require('../data/game/nextMap.json').maps;
 for(const [map,pool]of Object.entries(profiles)){
  assert.equal(pool.reduce((sum,[,w])=>sum+w,0),100);const zone=zones.find(z=>z.mapName===map).level,seen=new Set();
  for(let i=0;i<10000;i++){let n=0;const e=fishingEncounter(map,()=>n++===0?i/10000:.99);seen.add(e.id);assert(e.level>=zone.min&&e.level<=zone.max);}
  assert.equal(seen.size,pool.length);assert.equal(fishingEncounter(map,()=>.999).id,349);
 }assert.equal(fishingEncounter('route1'),null);
});
test('fishing: rod is limited to supplies floor, one purchase per expedition and persisted inventory',()=>{
 const shops=require('../server/game/world/shopCatalog'),economy=require('../server/game/drift/economy'),codec=require('../server/game/drift/checkpointCodec');
 for(const map of shops.SHOP_MAPS){const rod=shops.getShopCatalog({mapName:map,expedition:true}).find(i=>i.key==='fishing_rod');assert.equal(Boolean(rod),map==='tour_rdc');if(rod){assert.equal(rod.price,15000);assert.equal(rod.purchaseLimit,1);}}
 for(const mode of['rift','colosseum']){const p={alive:true,currentmap:'tour_rdc',run:{phase:'exploration',mode},items:{},money:50000,equipe:{pokemons:[]},drifts:[],equipped:[]};assert.throws(()=>economy.buy(p,'fishing_rod',2));assert.equal(p.money,50000);economy.buy(p,'fishing_rod',1);assert.equal(p.money,35000);assert.throws(()=>economy.buy(p,'fishing_rod',1));assert.equal(p.items.fishing_rod,1);assert.equal(codec.decode(codec.encode(p)).items.fishing_rod,1);}
});
