// Compare optimized effects with a Git-exported baseline in native Canvas.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),express=require('express'),{chromium}=require('playwright');
const baseline=process.env.ARENA_BASELINE_SERVICES||'/tmp/riftmon-arenas-baseline-services';
(async()=>{
 const app=express();app.use('/before/services',express.static(baseline));app.use('/before/data',express.static(path.resolve(__dirname,'../vue-explorakit/src/data')));app.use(express.static(path.resolve(__dirname,'../vue-explorakit/src')));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));let browser;
 try{
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});const p=await browser.newPage();await p.goto('http://127.0.0.1:'+server.address().port+'/services/placeAmbience.js');
  const result=await p.evaluate(async collapse=>{
   const before=await import('/before/services/placeAmbience.js'),after=await import('/services/placeAmbience.js');
   const waterBefore=await import('/before/services/villageWater.js'),waterAfter=await import('/services/villageWater.js');
   const create=()=>{const c=document.createElement('canvas');c.width=896;c.height=640;return c;};
   const ca=create(),cb=create(),a=ca.getContext('2d',{willReadFrequently:true}),b=cb.getContext('2d',{willReadFrequently:true});let frames=0,bytes=0,maxDelta=0;const differences=[];
   for(const map of ['ville1_arene','ville_safe1_arene','gen_arene5','ville3_arene','ville4_arene','ville5_arene']){
    const source=new Image();source.src='/assets/'+map+'.png';await source.decode();const ra=new before.PlaceAmbienceRenderer(),rb=new after.PlaceAmbienceRenderer();
    for(const motion of [true,false])for(const time of [0,500,1050,5000,11000,12000,13200,18500,25000,31500,44500,52500,90000]){
     for(const [c,r]of [[a,ra],[b,rb]]){c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,896,640);c.imageSmoothingEnabled=false;c.drawImage(source,0,0,896,640);r.drawGround(c,source,map,time,motion,map===collapse.map?{...collapse,epoch:'fixture',elapsedMs:0,receivedAt:0}:null);r.draw(c,source,map,time,motion,3,{night:0});}
     const aa=a.getImageData(0,0,896,640).data,bb=b.getImageData(0,0,896,640).data;let n=0;
     for(let i=0;i<aa.length;i++){const delta=Math.abs(aa[i]-bb[i]);if(delta){n++;maxDelta=Math.max(maxDelta,delta);}}
     if(n)differences.push({map,time,motion,bytes:n});frames++;bytes+=n;
    }
    if(map===collapse.map){
     const h=rb.hoze,floor=h.faultFloor;let paints=0;const paint=h.paintFaults.bind(h);h.paintFaults=(...args)=>{paints++;return paint(...args);};
     for(const t of [100000,100100,100200])rb.drawGround(b,source,map,t,true,{...collapse,epoch:'fixture',elapsedMs:0,receivedAt:0});
     if(h.faultFloor!==floor||paints!==0)throw Error('Completed fractures were recalculated');
     rb.drawGround(b,source,map,100300,true,{...collapse,epoch:'reset',elapsedMs:0,receivedAt:100300});
     if(floor.width!==0||h.faultFloor||h.faultElapsed!==0)throw Error('Admin reset retained the finished floor');
    }
    if(!rb.lightingBase||rb.lanternGradients.size!==8)throw Error('Arena lighting was not reused');
    const surfaces=[rb.canvas,rb.hoze?.canvas,rb.hoze?.faultFloor,rb.raph?.canvas,rb.ana?.canvas,rb.lightingBase].filter(Boolean);rb.destroy();ra.destroy();if(!surfaces.every(s=>s.width===0)||rb.lanternGradients)throw Error('Arena surfaces not released: '+map);
   }
   let waterFrames=0;
   for(const map of ['ville1_arene','start','route3','ville1','ville3','ville_safe1','gen_ville5']){
    const source=new Image();source.src='/assets/'+map+'.png';await source.decode();const ra=new waterBefore.VillageWaterRenderer(),rb=new waterAfter.VillageWaterRenderer();
    for(const time of [0,500,1050,5000,12000,52500,90000]){
     for(const [c,r]of [[a,ra],[b,rb]]){c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,896,640);c.imageSmoothingEnabled=false;r.draw(c,source,time,true,map);}
     const aa=a.getImageData(0,0,896,640).data,bb=b.getImageData(0,0,896,640).data;let n=0;
     for(let i=0;i<aa.length;i++){const delta=Math.abs(aa[i]-bb[i]);if(delta){n++;maxDelta=Math.max(maxDelta,delta);}}
     if(n)differences.push({map,time,water:true,bytes:n});waterFrames++;bytes+=n;
    }
    const surface=rb.canvas;rb.destroy();ra.destroy();if(surface.width!==0||rb.rowCurrent)throw Error('Water cache not released');
   }
   return{frames,waterFrames,differingBytes:bytes,maxDelta,differences,released:true};
  },require('../data/game/hoze_collapse.json'));
  assert.equal(result.differingBytes,0,JSON.stringify(result));assert(result.released);console.log(JSON.stringify(result));
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
