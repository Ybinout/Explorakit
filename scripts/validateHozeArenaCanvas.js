// Real Canvas/artwork: containment, visible local motion, stable reduced motion and disposal.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const express=require('express'),{chromium}=require('playwright');
const out=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-hoze-quake-canvas';fs.mkdirSync(out,{recursive:true});
(async()=>{const app=express();app.use(express.static(path.resolve(__dirname,'../vue-explorakit/src')));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));let browser;
try{browser=await chromium.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:896,height:640}});await page.goto(`http://127.0.0.1:${server.address().port}/services/hozeArena.js`);
await page.evaluate(async()=>{document.body.innerHTML='<canvas width="896" height="640"></canvas>';document.body.style='margin:0;background:#0d1722;overflow:hidden';window.h=await import('/services/hozeArena.js');window.a=await import('/services/placeAmbience.js');window.r=new h.HozeArenaRenderer();window.source=new Image();source.src='/assets/ville_safe1_arene.png';await source.decode();window.c=document.querySelector('canvas').getContext('2d');c.imageSmoothingEnabled=false;window.render=(t,motion=true)=>{c.drawImage(source,0,0,896,640);r.draw(c,source,t,motion);};});
const checks=await page.evaluate(()=>{
 const frames=[];let outside=0,left=0,right=0;
 for(const t of [0,450,1000,1700,2300,4000,6200,9800,12500]){render(t);const data=r.context.getImageData(0,0,896,640).data;frames.push(new Uint8ClampedArray(data));for(let y=0;y<640;y++)for(let x=0;x<896;x++)if(data[(y*896+x)*4+3]){const allowed=y>=158&&y<534&&(x>=52&&x<288||x>=608&&x<844);if(!allowed)outside++;if(x<448)left++;else right++;}}
 let pillarPixels=0;const first=frames[0],second=frames[2];for(let y=170;y<286;y++)for(let x=86;x<106;x++){const j=(y*896+x)*4;if(first[j]!==second[j]||first[j+3]!==second[j+3])pillarPixels++;}
 render(18000,false);const fixed=r.canvas.toDataURL(),count=r.frames;render(19000,false);const reduced=fixed===r.canvas.toDataURL()&&count===r.frames;
 render(20000);const before=r.frames;render(20001);const throttled=r.frames===before;
 const start=performance.now();for(let n=0;n<120;n++)r.paint(n*50,true);const averagePaintMs=(performance.now()-start)/120;
 let minMotion=Infinity,previous=null,occlusionErrors=0,cracksOnBothSides=0;
 const base=document.createElement('canvas');base.width=896;base.height=640;const bc=base.getContext('2d');bc.imageSmoothingEnabled=false;bc.drawImage(source,0,0,896,640);const original=bc.getImageData(0,0,896,640).data;
 for(let t=0;t<14000;t+=250){render(t);const current=c.getImageData(0,0,896,640).data;let moved=0;
  for(const[x,top,bottom]of h.HOZE_PILLARS){for(let y=(top+1)*2;y<(bottom-20)*2;y++)for(let xx=(x-10)*2;xx<(x+10)*2;xx++){const j=(y*896+xx)*4;if(previous&&(current[j]!==previous[j]||current[j+1]!==previous[j+1]))moved++;}
   for(let y=(bottom-14)*2;y<(bottom-2)*2;y++)for(let xx=(x-8)*2;xx<(x+8)*2;xx++){const j=(y*896+xx)*4;if(current[j]!==original[j]||current[j+1]!==original[j+1]||current[j+2]!==original[j+2])occlusionErrors++;}}
  if(previous)minMotion=Math.min(minMotion,moved);previous=current;
 }
 render(4200,false);const masked=r.context.getImageData(0,0,896,640).data,structures=r.structures.getContext('2d').getImageData(0,0,896,640).data;
 for(let j=3;j<masked.length;j+=4)if(masked[j]&&structures[j])occlusionErrors++;
 for(const side of [[54,286],[610,842]]){let count=0;for(let y=224;y<530;y++)for(let x=side[0];x<side[1];x++)if(masked[(y*896+x)*4+3])count++;if(count>1000)cracksOnBothSides++;}
 const surfaces=[r.canvas,r.repair,r.structures,...r.pillars.map(p=>p.texture)];r.suspend();const released=surfaces.every(s=>s.width===0)&&!r.canvas;
 const ambience=new a.PlaceAmbienceRenderer();ambience.drawGround(c,source,h.HOZE_MAP,1000,true);const surface=ambience.hoze.canvas;ambience.drawGround(c,source,'start',1000,true);const isolated=!ambience.hoze.canvas&&surface.width===0;ambience.destroy();
 return{outside,left,right,pillarPixels,minMotion,occlusionErrors,cracksOnBothSides,reduced,throttled,released,isolated,averagePaintMs};
});assert.equal(checks.outside,0);assert(checks.left>200&&checks.right>200);assert(checks.pillarPixels>50);assert(checks.minMotion>50);assert.equal(checks.occlusionErrors,0);assert.equal(checks.cracksOnBothSides,2);for(const k of ['reduced','throttled','released','isolated'])assert(checks[k],k);
for(const time of [450,1000,2300,4200,9800]){await page.evaluate(t=>render(t),time);await page.screenshot({path:path.join(out,`hoze-${time}.png`)});}await page.evaluate(()=>{document.querySelector('canvas').style='width:1792px;height:1280px;position:absolute;left:-100px;top:-300px';render(1000);});await page.setViewportSize({width:360,height:520});await page.screenshot({path:path.join(out,'columns-close.png')});fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify(checks,null,2));console.log(JSON.stringify(checks));
}finally{await browser?.close();await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e.stack);process.exitCode=1});
