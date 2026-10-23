const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const service=()=>import('../vue-explorakit/src/services/dirtFootprints.js');
async function fixture(){const{DirtFootprintsRenderer}=await service(),data=new Uint8ClampedArray(448*320*4);for(let i=0;i<data.length;i+=4)data.set([149,135,115,255],i);const created=[],create=()=>{const ctx={drawImage(){},getImageData:()=>({data}),createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(){}};const c={width:0,height:0,getContext:()=>ctx};created.push(c);return c;},r=new DirtFootprintsRenderer(create),image={},target={drawImage(){}};r.prepare(image,'route12');return{r,data,image,target,created};}
test('soil metadata follows authored outdoor earth tiles without rewriting maps or including interiors, paving-only snow or caves',async()=>{
 const{buildDirtGround,serialize}=require('../scripts/generateDirtGround'),{default:dirt}=await import('../vue-explorakit/src/data/dirtGround.js');
 const files=fs.readdirSync(path.join(__dirname,'../data/maps')).filter(n=>n.endsWith('.json')),digest=()=>files.map(f=>crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'../data/maps',f))).digest('hex'));const before=digest();assert.deepEqual(dirt,buildDirtGround());assert.deepEqual(digest(),before);assert.equal(fs.readFileSync(path.join(__dirname,'../vue-explorakit/src/data/dirtGround.js'),'utf8'),serialize(dirt));
 for(const map of ['start','route1','route2','route4','route12','ville_safe1','ville4'])assert(dirt.maps[map],map);for(const map of ['route13','route14','ville5','centre','cave1','ville4_arene','route2_maison'])assert(!dirt.maps[map],map);
 for(const[map,rows]of Object.entries(dirt.maps)){const m=require('../data/maps/'+map+'.json'),coll=m.layers.find(l=>l.name==='coll').data;assert.equal(rows.length,20);rows.forEach((row,y)=>{assert.equal(row.length,28);[...row].forEach((c,x)=>{if(c==='1')assert.equal(coll[y*28+x],0,map);});});}
});
test('soil marks touch only exact earth pixels: never paving, vegetation, water, snow or transparent artwork',async()=>{
 const{r,data,image}=await fixture();assert(r.onGround(80,80));for(const color of [[177,182,172,255],[174,168,144,255],[97,154,78,255],[85,165,215,255],[217,230,233,255],[149,135,115,0]]){data.set(color,(40*448+40)*4);r.prepare(image,'route12');assert(!r.onGround(80,80),color.join(','));}data.set([233,219,172,255],(40*448+40)*4);r.prepare(image,'route12');assert(r.onGround(80,80));for(const xy of [[-1,80],[896,80],[80,640],[NaN,0]])assert(!r.onGround(...xy));
});
test('earth retains the short alternating gait with warm subtle colours and fades without layering dark tracks',async()=>{
 const{r,image,target}=await fixture();r.draw(target,image,'route12',[{id:'me',x:80,y:80}],0);assert.equal(r.marks.length,0);
 for(let n=1;n<=8;n++)r.draw(target,image,'route12',[{id:'me',x:80+n*4,y:80}],n*20);
 const steps=r.marks.filter(m=>m.kind==='step');assert.deepEqual(steps.map(m=>m.y),[76,84]);assert(r.paintedPixels>50);let max=0;for(let i=0;i<r.frame.data.length;i+=4){const a=r.frame.data[i+3];if(a){assert(r.frame.data[i]>r.frame.data[i+2],'earth stays warm');max=Math.max(max,a);}}assert(max>25&&max<=70);
 const marks=[...r.marks];r.marks.push(...marks,...marks);r.draw(target,image,'route12',[],200);assert(r.frame.data.every((v,i)=>i%4!==3||v<=max));r.draw(target,image,'route12',[],1600);assert.equal(r.paintedPixels,0);assert.equal(r.marks.length,0);
});
test('soil surfaces remain bounded and are released on battle/loading/off/reduced motion, indoors and destruction',async()=>{
 const{r,image,target,created}=await fixture();r.draw(target,image,'route12',[{id:'one',x:80,y:80}],0);r.draw(target,image,'route12',[{id:'one',x:112,y:80}],100);const frames=r.frames;r.draw(target,image,'route12',[],110);assert.equal(r.frames,frames);assert.equal(r.canvas.width,448);assert.equal(r.canvas.height,320);assert.equal(created.length,2);
 r.draw(target,image,'route12',[],120,false);assert.equal(r.canvas,null);assert.equal(r.actors.size,0);r.draw(target,image,'centre',[],140);assert.equal(r.canvas,null);r.destroy();r.draw(target,image,'route12',[],160);assert.equal(r.canvas,null);
});
