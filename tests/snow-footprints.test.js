const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const service=()=>import('../vue-explorakit/src/services/snowFootprints.js');
function surfaces(){
    const data=new Uint8ClampedArray(448*320*4),created=[];
    for(let i=0;i<data.length;i+=4)data.set([217,230,233,255],i);
    const create=()=>{const calls=[],ctx={createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(frame){this.lastFrame=frame;},imageSmoothingEnabled:true,getImageData:()=>({data}),drawImage(){},clearRect(){calls.length=0;},fillRect(x,y,w,h){calls.push({x,y,w,h,style:this.fillStyle});}};
        const canvas={width:0,height:0,getContext:()=>ctx};created.push(canvas);return canvas;};
    return {data,create,created};
}
async function fixture(){const w=await service(),s=surfaces(),r=new w.SnowFootprintsRenderer(s.create),target={drawImage(){}},image={};r.prepare(image,'route13');return{w,s,r,target,image};}
test('snow ground metadata matches author maps, covers only three snowy maps and preserves every author byte',async()=>{
    const {buildSnowGround,serialize}=require('../scripts/generateSnowGround'),{default:profiles}=await import('../vue-explorakit/src/data/snowGround.js');
    assert.deepEqual(profiles,buildSnowGround());assert.equal(fs.readFileSync(path.join(__dirname,'../vue-explorakit/src/data/snowGround.js'),'utf8'),serialize(profiles));
    assert.deepEqual(Object.keys(profiles),['route13','route14','ville5']);
    for(const [name,rows]of Object.entries(profiles)){const map=require('../data/maps/'+name+'.json'),coll=map.layers.find(l=>l.name==='coll').data;assert.equal(rows.length,20);let n=0;rows.forEach((row,y)=>{assert.equal(row.length,28);[...row].forEach((v,x)=>{if(v==='1'){n++;assert.equal(coll[y*28+x],0);}});});assert(n>300);}
});
test('actual travel leaves a continuous channel; spawn, idle, teleport, stale updates and invalid positions never draw a trail',async()=>{
    const {r}=await fixture();const actor={id:'player:one',x:304,y:80};
    r.observe([actor],0);r.observe([actor],50);assert.equal(r.marks.length,0);
    for(let n=1;n<=8;n++)r.observe([{...actor,x:304+n*4}],50+n*16);
    assert.equal(r.marks.length,8);assert(r.marks[0].x<r.marks[1].x);assert(r.marks.every(m=>m.y===80));for(let i=1;i<r.marks.length;i++)assert.equal(r.marks[i].x-r.marks[i-1].x,4);
    const before=r.triggers;r.observe([{...actor,x:700}],200);r.observe([{...actor,x:701}],1000);r.observe([{...actor,x:NaN}],1016);assert.equal(r.triggers,before);
    r.observe([],1032);assert.equal(r.actors.size,0);r.observe([{...actor,x:320}],1048);assert.equal(r.triggers,before);
});
test('footprints hold briefly then fade smoothly to nothing in 3.2 seconds, reuse a bounded cached layer and remain world anchored',async()=>{
    const {w,r,target,image,s}=await fixture();assert(w.footprintOpacity(0,0)>0);assert.equal(w.footprintOpacity(500,0),w.footprintOpacity(0,0));assert(w.footprintOpacity(2000,0)<w.footprintOpacity(1000,0));assert.equal(w.footprintOpacity(3200,0),0);assert.equal(w.footprintOpacity(-1,0),0);
    r.draw(target,image,'route13',[{id:'a',x:304,y:80}],0);r.draw(target,image,'route13',[{id:'a',x:320,y:80}],50);assert.equal(r.marks.length,4);assert(r.paintedPixels>0);
    const xy=r.marks.map(({x,y})=>({x,y})),frames=r.frames;r.draw(target,image,'route13',[{id:'a',x:320,y:80}],60);assert.equal(r.frames,frames);r.draw(target,image,'route13',[{id:'a',x:320,y:80}],1000);assert.deepEqual(r.marks.map(({x,y})=>({x,y})),xy);
    r.draw(target,image,'route13',[],3250);assert.equal(r.marks.length,0);assert.equal(r.paintedPixels,0);assert.equal(s.created.length,2);assert.equal(r.canvas.width,448);assert.equal(s.created[0].width,0);
});
test('only exact snow-floor pixels are painted: no paving, water, blades, transparency or out-of-map pixels',async()=>{
    const {r,s}=await fixture();
    for(const [color,x]of [[[156,152,136,255],152],[[104,168,217,255],153],[[152,184,200,255],154],[[217,230,233,0],155]])s.data.set(color,(40*448+x)*4);
    r.prepare({},'route13');for(let x=152;x<=155;x++)assert.equal(r.onSnow(x*2,80),false);
    assert(r.onSnow(304,82));for(const xy of [[-1,80],[896,80],[304,640],[Infinity,0]])assert(!r.onSnow(...xy));
    r.marks=[{x:306,y:80,dx:0,dy:1,born:0}];r.draw({drawImage(){}},r.source,'route13',[],50);assert(r.paintedPixels>0);
});
test('crowds, long sessions and cleanup remain bounded; off, reduced motion, map changes and destruction discard all trails',async()=>{
    const {w,r,target,image}=await fixture();
    for(let n=0;n<120;n++)r.observe(Array.from({length:100},(_,i)=>({id:'a'+i,x:304+(n%2?16:0),y:80})),n*50);
    assert.equal(r.marks.length,w.FOOTPRINT_LIMIT);assert.equal(r.actors.size,64);
    r.draw(target,image,'route13',[],7000,false);assert.equal(r.canvas,null);assert.equal(r.marks.length,0);assert.equal(r.actors.size,0);
    r.draw(target,image,'route14',[{id:'b',x:304,y:80}],7050);assert.equal(r.marks.length,0);assert.equal(r.map,'route14');
    r.draw(target,image,'centre',[],7100);assert.equal(r.canvas,null);r.destroy();r.draw(target,image,'route13',[],7200);assert.equal(r.canvas,null);
    assert(!w.hasSnowGround('cave_rochebrume3'));assert(w.hasSnowGround('ville5'));
});

test('the rendered ribbon is connected, broader than shoes, gently textured, and crossings never accumulate opacity',async()=>{
 const {r,target,image}=await fixture();r.draw(target,image,'route13',[{id:'a',x:304,y:80}],0);
 r.draw(target,image,'route13',[{id:'a',x:336,y:80}],100);
 const data=r.frame.data;
 for(let x=154;x<=168;x++)assert(data[(40*448+x)*4+3]>50,'continuous centre');
 assert(data[(37*448+160)*4+3]>0);assert(data[(43*448+160)*4+3]>0);
 const alpha=data.reduce((m,v,i)=>i%4===3?Math.max(m,v):m,0);assert(alpha<=130);
 const original=r.marks.map(m=>({...m}));r.marks.push(...original,...original);r.draw(target,image,'route13',[],150);
 assert(r.frame.data.reduce((m,v,i)=>i%4===3?Math.max(m,v):m,0)<=alpha);
 r.draw(target,image,'route13',[{id:'turn',x:336,y:80}],200);
 r.draw(target,image,'route13',[{id:'turn',x:336,y:64}],300);
 for(let y=32;y<=40;y++)assert(r.frame.data[(y*448+168)*4+3]>30,'joined corner');
});
