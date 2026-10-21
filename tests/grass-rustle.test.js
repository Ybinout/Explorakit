const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const service=()=>import('../vue-explorakit/src/services/grassRustle.js');
async function fixture(map='route1'){
 const mod=await service(),data=new Uint8ClampedArray(448*320*4),cells=mod.grassCells(map);for(let i=0;i<data.length;i+=4)data.set([182,226,160,255],i);
 for(const [cell]of cells){const bx=cell%28*16,by=Math.floor(cell/28)*16;for(let y=by+1;y<by+15;y++)for(let x=bx+1;x<bx+15;x++)data.set((x+y)%3?[57,107,77,255]:[37,78,54,255],(y*448+x)*4);}
 const first=cells[0][0],tx=first%28,ty=Math.floor(first/28);data.set([120,80,40,255],((ty*16+3)*448+tx*16+3)*4);data.set([57,107,77,100],((ty*16+4)*448+tx*16+4)*4);
 const surfaces=[],create=()=>{const c={width:0,height:0};c.getContext=()=>({drawImage(){},getImageData:()=>({data:data.slice()}),createImageData:()=>({data:new Uint8ClampedArray(data.length)}),putImageData(){}});surfaces.push(c);return c;};
 const calls=[],target={drawImage:(...args)=>calls.push(args)},r=new mod.GrassRustleRenderer(create),image={},actor={id:'local',x:tx*32+16,y:ty*32+16};return {mod,data,cells,actor,r,image,target,calls,surfaces};
}
test('metadata identifies all delivered grass drawings without cave floors/paths and exactly matches author maps read-only',async()=>{
 const {buildGrassProfiles,serialize}=require('../scripts/generateWorldGrass'),profiles=buildGrassProfiles();
 assert.equal(fs.readFileSync(path.join(__dirname,'../vue-explorakit/src/data/worldGrass.js'),'utf8'),serialize(profiles));
 for(const name of ['start','route1','route2','route3','route4','route5','route6','gen_route8','gen_route7','gen_route6','route11','route12'])assert(profiles[name]?.length,name);
 assert(!profiles.cave1&&!profiles.cave2&&!profiles.ville3&&!profiles.ville4);assert(Object.values(profiles).every(cells=>cells.every(([,id])=>id!==1850)), 'path-edge tiles must not move');assert(profiles.gen_route8.some(([,id])=>id===2944));
 const {hasRustlingGrass}=await service();assert(!hasRustlingGrass('toString'));assert(!hasRustlingGrass(null));
});
test('only real movement starts grass, using any visible actor identity; pixels outside blade masks, alpha and artwork stay intact',async()=>{
 const {r,image,target,actor,data,calls}=await fixture();r.draw(target,image,'route1',[actor],0);assert.equal(r.events.size,0);assert.equal(calls.length,0);
 r.draw(target,image,'route1',[actor],50);assert.equal(r.events.size,0);const moved={...actor,x:actor.x+8};r.draw(target,image,'route1',[moved],100);assert(r.events.size>0);
 r.draw(target,image,'route1',[moved],175);assert(r.changedPixels>0);let changed=0;
 for(let i=0;i<448*320;i++){if(!r.mask[i])assert.deepEqual([...r.frame.data.slice(i*4,i*4+4)],[...data.slice(i*4,i*4+4)]);assert.equal(r.frame.data[i*4+3],data[i*4+3]);if(r.frame.data[i*4]!==data[i*4])changed++;}assert(changed>0);
 assert.deepEqual(r.original.data,data);r.draw(target,image,'route1',[moved],600);assert.equal(r.events.size,0);assert.deepEqual(r.frame.data,data);
 for(const id of ['remote-player','walking-pnj']){r.suspend();r.draw(target,image,'route1',[{...actor,id}],0);r.draw(target,image,'route1',[{...actor,id,x:actor.x+8}],100);assert(r.events.size>0,id);}
});
test('teleport, long absence and first appearance do not create wakes; leaving a map releases stale actors/cells and respects reduced motion',async()=>{
 const {r,image,target,actor,surfaces}=await fixture();r.draw(target,image,'route1',[actor],0);r.draw(target,image,'route1',[{...actor,x:actor.x+160}],100);assert.equal(r.events.size,0);
 r.draw(target,image,'route1',[actor],900);assert.equal(r.events.size,0);r.draw(target,image,'route1',[{...actor,x:actor.x+8}],950);assert(r.events.size>0);
 r.draw(target,image,'route1',[],1000,false);assert.equal(r.canvas,null);assert.equal(r.actors.size,0);assert.equal(r.events.size,0);assert.equal(surfaces[0].width,0);
 r.draw(target,image,'route1',[actor],1100);assert.equal(r.events.size,0);r.draw(target,image,'route12',[actor],1200);assert.equal(r.map,'route12');assert.equal(r.events.size,0);
 r.draw(target,image,'cave1',[actor],1300);assert.equal(r.canvas,null);r.destroy();r.draw(target,image,'route1',[actor],1400);assert.equal(r.canvas,null);assert(surfaces.every(c=>c.width===0));
});
test('native pixel cache is reused, painting stays at 30 Hz and event budget is bounded with many walkers',async()=>{
 const {r,image,target,cells,surfaces}=await fixture();const actors=cells.slice(0,100).map(([cell],i)=>({id:'p'+i,x:cell%28*32+16,y:Math.floor(cell/28)*32+16}));
 r.draw(target,image,'route1',actors,0);const moved=actors.map(a=>({...a,x:a.x+8}));r.draw(target,image,'route1',moved,100);assert(r.events.size>0&&r.events.size<=32);const before=r.frames;
 for(const time of [101,110,120,130])r.draw(target,image,'route1',moved,time);assert.equal(r.frames,before);r.draw(target,image,'route1',moved,134);assert.equal(r.frames,before+1);assert.equal(surfaces.length,1);assert.equal(r.canvas.width,448);
 r.draw(target,image,'route1',[],600);assert.equal(r.events.size,0);assert.equal(r.actors.size,0);
});
test('unreadable image data leaves the previously rendered world untouched',async()=>{
 const {GrassRustleRenderer}=await service(),calls=[];
 for(const create of [()=>({getContext:()=>null}),()=>({getContext:()=>({drawImage(){},getImageData(){throw Error('blocked');}})})]){const r=new GrassRustleRenderer(create);r.draw({drawImage:(...a)=>calls.push(a)},{},'route1',[],0);assert.equal(r.canvas,null);}assert.equal(calls.length,0);
});
