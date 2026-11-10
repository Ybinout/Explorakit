const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const data=require('../vue-explorakit/src/data/worldTallGrass.json');
const loaded=import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(path.join(__dirname,'../vue-explorakit/src/services/tallGrass.js'),'utf8').replace("import data from '../data/worldTallGrass.json';",'const data='+JSON.stringify(data)+';')).toString('base64'));
async function fixture(map='DC2_01'){
 const mod=await loaded,surfaces=[],calls=[],create=()=>{const c={width:0,height:0,reads:0};const ctx={imageSmoothingEnabled:false,drawImage(...args){calls.push({canvas:c,args});},createImageData(w,h){return{width:w,height:h,data:new Uint8ClampedArray(w*h*4)};},putImageData(p){c.pixels=p;},getImageData(){c.reads++;throw Error('No readback allowed');}};c.getContext=()=>ctx;surfaces.push(c);return c;};
 const target={drawImage(...args){calls.push({target:true,args});},save(){},restore(){},beginPath(){},rect(...args){target.clipBox=args;},clip(){}};
 const r=new mod.TallGrassRenderer(create),bg={},fg={},cell=data.maps[map][0][0],actor={id:'local',x:cell%28*32+16,y:Math.floor(cell/28)*32+16};return{mod,r,bg,fg,map,cell,actor,calls,surfaces,target};
}
test('1646 authored tall plants use exact base/top cells and only the 48 Dark Continent maps',async()=>{
 const mod=await loaded;let count=0;
 for(const[map,entries]of Object.entries(data.maps)){
  assert.match(map,/^DC2_\d{2}$/);const m=require('../data/maps/'+map+'.json'),decor=m.layers.find(l=>l.name==='decor').data,fore=m.layers.find(l=>l.name==='foreground').data,coll=m.layers.find(l=>l.name==='coll').data;
  assert.deepEqual(entries.map(e=>e[0]),decor.flatMap((gid,cell)=>gid===2958&&!coll[cell]?[cell]:[]));
  for(const[cell,ground,top]of entries){assert(ground>=0&&ground<data.grounds.length);assert.equal(top,Number(cell>=28&&fore[cell-28]===2818));count++;}
  assert(mod.hasTallGrass(map));
 }
 assert.equal(count,1646);assert.equal(Object.keys(data.maps).length,48);assert.equal(data.verifiedCells,count);assert.equal(mod.hasTallGrass('jungle1'),false);assert.equal(mod.hasTallGrass('route1'),false);assert.equal(mod.hasTallGrass('toString'),false);
 assert.equal(Buffer.from(data.shape,'base64').length,16*32*4);for(const ground of data.grounds)assert.equal(Buffer.from(ground,'base64').length,16*16*4);
});
test('cached whole-plant frames keep their roots fixed, include upper blades and use no pixel readbacks',async()=>{
 const f=await fixture(),{r}=f;r.prepare(f.bg,f.fg,f.map);assert.equal(r.atlas.width,140);assert.equal(r.atlas.height,128);assert.equal(r.plants.length,data.maps[f.map].length);
 const pixels=r.atlas.pixels.data,w=r.atlas.width;
 const root=(bend,spread)=>Array.from(pixels.subarray(((spread*32+30)*w+(bend+2)*28)*4,((spread*32+30)*w+(bend+2)*28+28)*4));
 for(let b=-2;b<=2;b++)for(let s=0;s<4;s++)assert.deepEqual(root(b,s),root(0,0));
 const firstFrame=Array.from(pixels.subarray(0,32*w*4));assert(firstFrame.some((v,i)=>i%(w*4)<28*4&&v));assert(f.surfaces.every(s=>s.reads===0));r.destroy();assert(f.surfaces.every(s=>s.width===0&&s.height===0));
});
test('only real travel makes tall grass part for local players, other players and walking NPCs; it closes afterwards',async()=>{
 for(const id of['local','remote-player','walking-npc']){
  const f=await fixture(),{r,target,bg,fg,map,actor}=f;actor.id=id;r.draw(target,bg,fg,map,[actor],0);assert.equal(r.events.size,0);
  r.draw(target,bg,fg,map,[actor],50);assert.equal(r.events.size,0);const moved={...actor,x:actor.x+8};r.draw(target,bg,fg,map,[moved],100);assert(r.events.size>0);
  r.draw(target,bg,fg,map,[moved],190);assert(r.plants.some(p=>p.spread>0));assert(r.plants.some(p=>p.spread===0));
  r.draw(target,bg,fg,map,[moved],750);assert.equal(r.events.size,0);assert(r.plants.every(p=>!p.bend&&!p.spread));r.destroy();
 }
});
test('teleports and reconnects do not shake plants; reduced motion keeps static depth while clearing wakes',async()=>{
 const f=await fixture(),{r,target,bg,fg,map,actor}=f;r.draw(target,bg,fg,map,[actor],0);r.draw(target,bg,fg,map,[{...actor,x:actor.x+150}],50);assert.equal(r.events.size,0);
 r.draw(target,bg,fg,map,[actor],900);assert.equal(r.events.size,0);r.draw(target,bg,fg,map,[{...actor,x:actor.x+8}],950);assert(r.events.size>0);
 const canvas=r.foreground;r.draw(target,bg,fg,map,[actor],1050,false);assert.equal(r.foreground,canvas);assert.equal(r.events.size,0);assert(r.plants.every(p=>p.spread===0&&p.bend===0));
 r.drawActor(target,actor);assert.deepEqual(target.clipBox,[actor.x-24,actor.y-4,48,26]);r.destroy();
});
test('only grass ahead of the feet occludes the lower body; nearby grass behind cannot cover the head',async()=>{
 const{grassInFront}=await loaded,cell=10*28+10,x=10*32+16,y=10*32+16;
 assert(grassInFront(cell,x,y));assert(!grassInFront(cell-28,x,y));assert(grassInFront(cell+28,x,y),'the next row has tall tips in front of the feet');assert(!grassInFront(cell+56,x,y));assert(!grassInFront(cell+3,x,y));
});
test('many walkers have bounded wakes, cached 30 Hz poses and culled visible plants without new surfaces each frame',async()=>{
 const f=await fixture(),{r,target,bg,fg,map}=f,actors=data.maps[map].slice(0,50).map(([cell],i)=>({id:'p'+i,x:cell%28*32+16,y:Math.floor(cell/28)*32+16}));
 r.draw(target,bg,fg,map,actors,0);const moved=actors.map(p=>({...p,x:p.x+8}));r.draw(target,bg,fg,map,moved,100);assert(r.events.size>0&&r.events.size<=32);const frames=r.frames,surfaces=f.surfaces.length;
 for(const n of[101,110,120,130])r.draw(target,bg,fg,map,moved,n);assert.equal(r.frames,frames);assert.equal(f.surfaces.length,surfaces);
 r.draw(target,bg,fg,map,moved,134,true,{x:0,y:0,visibleWidth:32,visibleHeight:32});assert.equal(r.frames,frames+1);assert(r.visible.length<r.plants.length);
 r.suspend();assert.equal(r.foreground,null);assert.equal(r.events.size,0);assert.equal(r.actors.size,0);r.prepare(bg,fg,map);assert.equal(f.surfaces.length,surfaces+1,'only foreground is rebuilt after map suspension');r.destroy();
});

test('a failed canvas allocation falls back safely and a later frame can rebuild every cache',async()=>{
 const f=await fixture(),create=f.r.createCanvas;let blocked=true;f.r.createCanvas=()=>{const c=create();if(blocked){blocked=false;c.getContext=()=>null;}return c;};
 assert.equal(f.r.draw(f.target,f.bg,f.fg,f.map,[],0),false);assert.equal(f.r.atlas,null);assert.equal(f.r.ground,undefined);assert.equal(f.r.foreground,null);
 assert.equal(f.r.draw(f.target,f.bg,f.fg,f.map,[],50),true);assert(f.r.atlas&&f.r.ground&&f.r.foreground);f.r.destroy();
});
