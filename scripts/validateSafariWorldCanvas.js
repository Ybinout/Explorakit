// Same art, poses and camera transforms before/after, in both browser engines.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const express=require('express'),engines=require('playwright');
const source=path.resolve(__dirname,'../vue-explorakit/src');
const baseline=process.env.SAFARI_BASELINE_SERVICES||'/tmp/riftmon-safari-baseline-services';
const output=process.env.SAFARI_CANVAS_OUT||'/tmp/riftmon-safari-canvas';
fs.mkdirSync(output,{recursive:true});
(async()=>{
 const app=express();app.use('/before/services',express.static(baseline));app.use('/before/data',express.static(source+'/data'));app.use(express.static(source));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const reports=[];
 try{for(const engine of(process.env.SAFARI_RENDER_ENGINES||'webkit,chromium').split(',')){
  const browser=await engines[engine].launch({headless:true,...(engine==='chromium'?{args:['--no-sandbox']}:{})});
  try{
   const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port+'/services/foregroundWind.js');
   const report=await page.evaluate(async()=>{
    const before=await import('/before/services/foregroundWind.js'),after=await import('/services/foregroundWind.js');
    const waterBefore=await import('/before/services/villageWater.js'),waterAfter=await import('/services/villageWater.js');
    const rows=[],different=[],bench=[];let compared=0,cleanupChecks=0;
    const image=async map=>{const i=new Image();i.src='/assets/'+map+'.png';await i.decode();return i;};
    for(const map of['start','route1','route2','route3','route4','route5','route13','route14','ville5','ville1']){
     for(const layer of['foreground','background']){
      if(!after.hasWindTrees(map,layer))continue;
      const art=await image(map+(layer==='foreground'?'_f':''));
      for(const view of['native','mobile']){
       if(view==='mobile'&&!['start','route5','ville5'].includes(map))continue;
       const surfaces=[0,1].map(()=>{const c=document.createElement('canvas');c.width=view==='native'?896:786;c.height=view==='native'?640:1270;return c;});
       const contexts=surfaces.map(c=>c.getContext('2d',{willReadFrequently:true}));
       const renderers=[new before.ForegroundWindRenderer(),new after.ForegroundWindRenderer()];
       for(const[wind,time,motion=true]of[[1,0],[3,200],[2,550],[1,2300],[3,80000],[0,80010],[3,0],[3,75,false],[3,550]]){
        for(let i=0;i<2;i++){
         const c=contexts[i];c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,c.canvas.width,c.canvas.height);c.fillStyle='#173c37';c.fillRect(0,0,c.canvas.width,c.canvas.height);c.imageSmoothingEnabled=false;
         if(view==='mobile')c.setTransform(2,0,0,2,-237.25,-115.5);
         if(layer==='background')c.drawImage(art,0,0,896,640);
         renderers[i].draw(c,art,time,wind,motion,map,layer);
        }
        const a=contexts[0].getImageData(0,0,surfaces[0].width,surfaces[0].height).data,b=contexts[1].getImageData(0,0,surfaces[1].width,surfaces[1].height).data;
        let bytes=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i])bytes++;
        if(bytes)different.push({map,layer,view,wind,time,motion,bytes});compared++;
       }
       const optimized=renderers[1],old=[optimized.canvas,optimized.patch?.canvas].filter(Boolean);
       rows.push({map,layer,view,patchPixels:optimized.patch?optimized.patch.width*optimized.patch.height:0,fullPixels:448*320});
       for(const r of renderers)r.destroy();if(!old.every(s=>s.width===0&&s.height===0))throw Error('Unreleased leaf cache');cleanupChecks++;for(const c of surfaces)c.width=c.height=0;
      }
      // Isolated pixel computation + upload, excluding final world compositing.
      const renderers=[new before.ForegroundWindRenderer(),new after.ForegroundWindRenderer()],samples=[[],[]],target={drawImage(){}};
      for(const r of renderers)for(let n=0;n<20;n++)r.draw(target,art,n*40,3,true,map,layer);
      for(let pass=0;pass<4;pass++)for(const i of(pass%2?[1,0]:[0,1])){
       const start=performance.now();for(let n=0;n<100;n++)renderers[i].draw(target,art,(100+pass*100+n)*40,3,true,map,layer);
       samples[i].push((performance.now()-start)/100);
      }
      const median=a=>a.sort((x,y)=>x-y)[Math.floor(a.length/2)];bench.push({map,layer,beforeMs:median(samples[0]),afterMs:median(samples[1])});
      for(const r of renderers)r.destroy();
     }
    }
    for(const map of['start','route3','ville1','ville3','ville_safe1','gen_ville5','ville1_arene']){
     const art=await image(map),renderers=[new waterBefore.VillageWaterRenderer(),new waterAfter.VillageWaterRenderer()];
     const surfaces=[0,1].map(()=>{const c=document.createElement('canvas');c.width=786;c.height=1270;return c;});
     const contexts=surfaces.map(c=>c.getContext('2d',{willReadFrequently:true}));
     for(const[time,motion=true]of[[0],[67],[200],[550],[2300],[80000],[0],[75,false],[550]]){
      for(let i=0;i<2;i++){
       const c=contexts[i];c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,c.canvas.width,c.canvas.height);c.fillStyle='#173c37';c.fillRect(0,0,c.canvas.width,c.canvas.height);c.imageSmoothingEnabled=false;c.setTransform(2,0,0,2,-237.25,-115.5);
       renderers[i].draw(c,art,time,motion,map);
      }
      const a=contexts[0].getImageData(0,0,786,1270).data,b=contexts[1].getImageData(0,0,786,1270).data;
      let bytes=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i])bytes++;
      if(bytes)different.push({map,family:'water',view:'mobile',time,motion,bytes});compared++;
     }
     const optimized=renderers[1],old=[optimized.canvas,optimized.patch?.canvas].filter(Boolean);rows.push({map,layer:'water',patchPixels:optimized.patch?optimized.patch.width*optimized.patch.height:0,fullPixels:448*320});
     for(const r of renderers)r.destroy();if(!old.every(s=>s.width===0&&s.height===0))throw Error('Unreleased water cache');cleanupChecks++;for(const c of surfaces)c.width=c.height=0;
    }
    return {compared,different,cleanupChecks,rows,bench};
   });
   assert.deepEqual(report.different,[],'Pixel parity '+engine);reports.push({engine,...report});
   fs.writeFileSync(path.join(output,'checks.json'),JSON.stringify(reports,null,2));
   console.log(JSON.stringify({engine,compared:report.compared,differences:report.different.length,cleanupChecks:report.cleanupChecks,bench:report.bench}));
  }finally{await browser.close();}
 }}finally{await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
