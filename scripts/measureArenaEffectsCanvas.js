// Isolate native effect painting from network, screen scaling and frame timing.
const fs=require('node:fs'),path=require('node:path'),express=require('express'),{chromium}=require('playwright');
const baseline=process.env.ARENA_BASELINE_SERVICES||'/tmp/riftmon-arenas-baseline-services';
(async()=>{const app=express();app.use('/before/services',express.static(baseline));app.use('/before/data',express.static(path.resolve(__dirname,'../vue-explorakit/src/data')));app.use(express.static(path.resolve(__dirname,'../vue-explorakit/src')));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));let browser;
try{browser=await chromium.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port+'/services/placeAmbience.js');const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 const rows=await page.evaluate(async()=>{
  const modules=await Promise.all(['/before/services/placeAmbience.js','/services/placeAmbience.js','/before/services/villageWater.js','/services/villageWater.js'].map(p=>import(p)));
  const rows=[],target={drawImage(){}};
  for(const [map,phase]of [['ville1_arene','lighting'],['ville_safe1_arene','opening'],['ville_safe1_arene','settled'],['gen_arene5','lighting'],['ville3_arene','lighting'],['ville4_arene','lighting'],['ville5_arene','lighting'],['ville1_arene','water']]){
   const source=new Image();source.src='/assets/'+map+'.png';await source.decode();const instances=phase==='water'?modules.slice(2).map(m=>new m.VillageWaterRenderer()):modules.slice(0,2).map(m=>new m.PlaceAmbienceRenderer());
   const samples=[[],[]];
   const draw=(r,n)=>{if(phase==='water')r.draw(target,source,n*75,true,map);else{r.drawGround(target,source,map,n*50,true);r.draw(target,source,map,n*50,true,3,{night:0});}};
   for(const r of instances)for(let n=0;n<30;n++)draw(r,n);
   const start=phase==='settled'?1400:40;
   for(let round=0;round<4;round++)for(const index of (round%2?[1,0]:[0,1]))for(let n=0;n<100;n++){
    const t=performance.now();draw(instances[index],start+round*100+n);samples[index].push(performance.now()-t);
   }
   const stats=a=>{a.sort((x,y)=>x-y);return{meanMs:a.reduce((s,v)=>s+v,0)/a.length,p50Ms:a[Math.floor(a.length*.5)],p95Ms:a[Math.floor(a.length*.95)]};};
   rows.push({map,phase,before:stats(samples[0]),after:stats(samples[1])});for(const r of instances)r.destroy();
  }return rows;
 });console.log(JSON.stringify({cpuThrottle:4,framesPerVariant:400,target:'Native Canvas effects; final target blit excluded',rows},null,2));
}finally{await browser?.close();await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e.stack);process.exitCode=1});
