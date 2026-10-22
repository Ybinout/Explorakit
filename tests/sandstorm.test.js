const test = require('node:test'), assert = require('node:assert/strict');
const service = () => import('../vue-explorakit/src/services/sandstorm.js');
function surface() {
    const calls=[], c={};
    for(const name of ['save','restore','setTransform','clearRect','fillRect','translate','rotate','drawImage','beginPath','ellipse','fill'])c[name]=(...args)=>{assert(args.every(v=>typeof v!=='number'||Number.isFinite(v)),name);calls.push([name,...args]);};
    c.createRadialGradient=(...args)=>{assert(args.every(Number.isFinite));return {addColorStop(){}};};
    return {c,calls,width:0,height:0,getContext:()=>c};
}
test('sand has depth, local ground swirls and broad irregular clouds instead of long strokes or a repeated grid',async()=>{
    const {sandstormFrame,sandParticleCount}=await service();
    for(const [width,height,floor]of [[896,640,0],[320,221,97],[393,593,213],[844,220,90]]){
        for(const time of [0,500,1200,9000,1e12]){
            const frame=sandstormFrame(time,{width,height,groundTop:floor});
            assert.equal(frame.grains.length,sandParticleCount(width,height));assert(frame.grains.length<=220);
            assert.equal(frame.clouds.length,18);assert(frame.grains.some(p=>p.swirling));
            assert(new Set(frame.grains.map(p=>p.radius.toFixed(2))).size>20);
            for(const p of frame.grains){assert(p.radius*p.stretch<=3);assert(p.x>=-12&&p.x<=width+12);assert(p.y>=0&&p.y<=height);assert(p.alpha>=0&&p.alpha<=.84);if(p.swirling)assert(p.y>=floor);}
            for(const cloud of frame.clouds){assert(cloud.height>=cloud.width*.25);assert(cloud.alpha<=.55);assert(Object.values(cloud).every(Number.isFinite));}
        }
        const a=sandstormFrame(1200,{width,height,groundTop:floor}),b=sandstormFrame(1201,{width,height,groundTop:floor});
        assert.notDeepEqual(a,b);
        for(let i=0;i<a.grains.length;i++){
            const dx=Math.abs(a.grains[i].x-b.grains[i].x),dy=Math.abs(a.grains[i].y-b.grains[i].y);
            assert(dx<1||dx>width,'no horizontal jumps away from a hidden wrap');assert(dy<1||dy>height-1);
        }
        assert.deepEqual(sandstormFrame(0,{width,height,motion:false}),sandstormFrame(1e12,{width,height,motion:false}));
    }
});
test('sand caches three small puff textures, bounds frame rate/DPR and releases all buffers on suspension or destruction',async()=>{
    const {SandstormRenderer}=await service(),textures=[],s=surface();
    const r=new SandstormRenderer(()=>{const canvas=surface();textures.push(canvas);return canvas;});
    const options={width:393,height:593,pixelRatio:3};
    for(const t of [0,1,16,32,34])r.draw(s.c,t,options);assert.equal(r.frames,2);assert.equal(textures.length,3);
    assert(textures.every(t=>t.width===192&&t.height===128));assert(s.calls.filter(c=>c[0]==='setTransform').every(c=>c[1]===1.5));
    r.draw(s.c,35,{...options,width:844});assert.equal(r.frames,3);assert.equal(textures.length,3);
    r.draw(s.c,40,{...options,motion:false});const frames=r.frames;for(const t of [80,1e12])r.draw(s.c,t,{...options,motion:false});assert.equal(r.frames,frames);
    for(const [width,height]of [[0,10],[-1,20],[NaN,20],[20,Infinity]])assert.equal(r.draw(s.c,100,{width,height}),false);
    r.suspend();assert(textures.every(t=>t.width===0&&t.height===0));assert.equal(r.textures.length,0);
    r.draw(s.c,200,options);assert.equal(textures.length,6);r.destroy();assert(textures.every(t=>t.width===0));assert.equal(r.draw(s.c,300,options),false);
});
