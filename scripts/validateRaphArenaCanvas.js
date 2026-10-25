// Native Canvas/artwork: alternating authored inlays, glass occlusion and cleanup.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const express=require('express'),{chromium}=require('playwright');
const out=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-raph-decor-canvas';fs.mkdirSync(out,{recursive:true});
(async()=>{const app=express();if(process.env.RAPH_SKY_BASELINE_SERVICE)app.get('/before/services/raphArena.js',(_q,r)=>r.type('application/javascript').send(fs.readFileSync(process.env.RAPH_SKY_BASELINE_SERVICE,'utf8')));app.use('/before/services',express.static(path.resolve(__dirname,'../vue-explorakit/src/services')));app.use(express.static(path.resolve(__dirname,'../vue-explorakit/src')));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));let browser;
try{browser=await chromium.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:896,height:640}});await page.goto(`http://127.0.0.1:${server.address().port}/services/raphArena.js`);
await page.evaluate(async baseline=>{document.body.innerHTML='<canvas width="896" height="640"></canvas>';document.body.style='margin:0;background:#0d1722;overflow:hidden';window.h=await import('/services/raphArena.js');window.a=await import('/services/placeAmbience.js');window.r=new h.RaphArenaRenderer();window.source=new Image();source.src='/assets/gen_arene5.png';await source.decode();window.c=document.querySelector('canvas').getContext('2d');c.imageSmoothingEnabled=false;window.render=(t,motion=true)=>{c.drawImage(source,0,0,896,640);r.draw(c,source,t,motion);};if(baseline){const old=await import('/before/services/raphArena.js');window.before=new old.RaphArenaRenderer();}},Boolean(process.env.RAPH_SKY_BASELINE_SERVICE));
const checks=await page.evaluate(()=>{
 render(0);const floorMask=new Uint8Array(896*640),groupIndices=[[],[]];
 for(const[group,band]of r.bands.entries()){
  const data=band.texture.getContext('2d').getImageData(0,0,band.w,band.h).data;
  for(let y=0;y<band.h;y++)for(let x=0;x<band.w;x++)if(data[(y*band.w+x)*4+3]){const index=(band.y+y)*896+band.x+x;floorMask[index]=1;groupIndices[group].push(index);}
 }
 let escaped=0,skyEscaped=0,skyLit=0,maxSkyLit=0,unmaskedFloorPixels=0,skyParityImages=0,skyParityDifferingBytes=0;const frames=[];
 for(let n=0;n<20;n++){
  render(n*230);const d=r.context.getImageData(0,0,896,640).data;frames.push(new Uint8ClampedArray(d));
  for(let y=0;y<640;y++)for(let x=0;x<896;x++)if(d[(y*896+x)*4+3]){
   const lx=x/2,ly=y/2,sky=lx>=148&&lx<300&&ly<49,pillar=(lx>=35&&lx<94||lx>=354&&lx<413)&&ly>=80&&ly<242;
   const flag=h.RAPH_BANNERS.some(([l,t,rr,b])=>lx>=l-2&&lx<rr+2&&ly>=t&&ly<b);
   if(!sky&&!pillar&&!flag&&!floorMask[y*896+x])escaped++;
   if(x>=204&&x<692&&y>=208&&y<538&&!floorMask[y*896+x])unmaskedFloorPixels++;
  }
  const s=r.sky.getContext('2d').getImageData(0,0,r.sky.width,r.sky.height).data,m=r.skyMask.getContext('2d').getImageData(0,0,r.skyMask.width,r.skyMask.height).data;
  let lit=0;for(let j=3;j<s.length;j+=4)if(s[j]){lit++;if(!m[j])skyEscaped++;}skyLit+=lit;maxSkyLit=Math.max(maxSkyLit,lit);
  if(window.before){before.draw({drawImage(){}},source,n*230);const old=before.sky.getContext('2d').getImageData(0,0,before.sky.width,before.sky.height).data;for(let i=0;i<s.length;i++)if(s[i]!==old[i])skyParityDifferingBytes++;skyParityImages++;}
 }
 // The outer and inner copper strips exchange their cool colour over 4.5 s.
 const colours=[];
 for(const t of [0,4500,9000]){
  render(t);const pixels=c.getImageData(0,0,896,640).data;
  colours.push(groupIndices.map(indices=>indices.reduce((sum,index)=>sum+pixels[index*4+2]-pixels[index*4],0)/indices.length));
 }
 let movingCloth=0,movingPillars=0;for(let y=0;y<640;y++)for(let x=0;x<896;x++){const j=(y*896+x)*4;if(frames[0][j]===frames[5][j]&&frames[0][j+3]===frames[5][j+3])continue;if(x>=216&&x<252&&y>=38&&y<120)movingCloth++;if(x>=86&&x<106&&y>=170&&y<286)movingPillars++;}
 const flags=r.flags.map(f=>f.pixels),glassPixels=r.skyPixels,bands=r.bands.map(b=>b.pixels);
 render(15000,false);const fixed=r.canvas.toDataURL(),count=r.frames;render(18000,false);const reduced=fixed===r.canvas.toDataURL()&&count===r.frames,staticAlpha=r.context.getImageData(0,0,896,640).data.some((n,i)=>i%4===3&&n);
 render(20000);const previous=r.frames;render(20001);const throttled=r.frames===previous;
 const start=performance.now();for(let n=0;n<120;n++)r.paint(n*50,true);const averagePaintMs=(performance.now()-start)/120;
 const surfaces=[r.canvas,r.repair,r.sky,r.skyMask,...r.flags.map(f=>f.texture),...r.bands.map(b=>b.texture)];r.suspend();window.before?.suspend();const released=surfaces.every(s=>s.width===0)&&!r.canvas&&!r.bands.length;
 const ambience=new a.PlaceAmbienceRenderer();ambience.drawGround(c,source,h.RAPH_MAP,1000,true);const old=ambience.raph.canvas;ambience.drawGround(c,source,'start',1000,true);const isolated=!ambience.raph.canvas&&old.width===0;ambience.destroy();
 return{escaped,unmaskedFloorPixels,bands,colours,skyEscaped,skyLit,maxSkyLit,skyParityImages,skyParityDifferingBytes,flags,glassPixels,movingCloth,movingPillars,reduced,staticAlpha,throttled,released,isolated,averagePaintMs};
});assert.equal(checks.escaped,0);assert.equal(checks.unmaskedFloorPixels,0);assert(checks.bands.every(n=>n>1000));assert(checks.colours[0][0]<-30&&checks.colours[0][1]>20);assert(checks.colours[1][0]>20&&checks.colours[1][1]<-30);assert(checks.colours[2][0]<-30&&checks.colours[2][1]>20);assert.equal(checks.skyParityDifferingBytes,0);assert.equal(checks.skyEscaped,0);assert(checks.skyLit>500);assert(checks.maxSkyLit>60);assert(checks.flags.every(n=>n>250));assert(checks.glassPixels>1500);assert(checks.movingCloth>100);assert(checks.movingPillars>50);assert(!checks.staticAlpha);for(const k of ['reduced','throttled','released','isolated'])assert(checks[k],k);
for(const time of [0,2250,4500,6750]){await page.evaluate(t=>render(t),time);await page.screenshot({path:path.join(out,`raph-${time}.png`)});}
await page.evaluate(()=>{document.querySelector('canvas').style='width:1792px;height:1280px;position:absolute;left:-448px;top:0';render(1150);});await page.setViewportSize({width:896,height:210});await page.screenshot({path:path.join(out,'windows-close.png')});fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify(checks,null,2));console.log(JSON.stringify(checks));
}finally{await browser?.close();await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e.stack);process.exitCode=1});
