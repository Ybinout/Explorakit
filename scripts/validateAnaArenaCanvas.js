// Fixed sparkle anchors, blue/white palettes, fades, confinement and disposal.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const express=require('express'),{chromium}=require('playwright');
const out=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-ana-stars-canvas';fs.mkdirSync(out,{recursive:true});
(async()=>{const app=express();app.use(express.static(path.resolve(__dirname,'../vue-explorakit/src')));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));let browser;
try{browser=await chromium.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:896,height:640}});await page.goto(`http://127.0.0.1:${server.address().port}/services/anaArena.js`);
await page.evaluate(async()=>{document.body.innerHTML='<canvas width="896" height="640"></canvas>';document.body.style='margin:0;background:#0d1722;overflow:hidden';window.h=await import('/services/anaArena.js');window.a=await import('/services/placeAmbience.js');window.r=new h.AnaArenaRenderer();window.source=new Image();source.src='/assets/ville3_arene.png';await source.decode();window.c=document.querySelector('canvas').getContext('2d');c.imageSmoothingEnabled=false;window.render=(t,motion=true)=>{c.drawImage(source,0,0,896,640);r.draw(c,source,t,motion);};});
const checks=await page.evaluate(()=>{
 let escaped=0,white=0,blue=0,minActive=Infinity,maxActive=0;const minimum=h.ANA_STARS.map(()=>255),maximum=h.ANA_STARS.map(()=>0);
 for(let t=0;t<20000;t+=250){render(t);const pixels=r.context.getImageData(0,0,896,640).data;let active=0;
  for(let i=0;i<h.ANA_STARS.length;i++){const[x,y]=h.ANA_STARS[i],alpha=pixels[((y*2)*896+x*2)*4+3];minimum[i]=Math.min(minimum[i],alpha);maximum[i]=Math.max(maximum[i],alpha);if(alpha)active++;}
  minActive=Math.min(minActive,active);maxActive=Math.max(maxActive,active);
  for(let y=0;y<640;y++)for(let x=0;x<896;x++){const j=(y*896+x)*4;if(!pixels[j+3])continue;
   if(!h.ANA_STARS.some(([sx,sy])=>x>=(sx-3)*2&&x<(sx+4)*2&&y>=(sy-3)*2&&y<(sy+4)*2))escaped++;
   if(pixels[j]>230&&pixels[j+1]>240&&pixels[j+2]>245)white++;
   if(pixels[j]<160&&pixels[j+1]>170&&pixels[j+2]>240)blue++;
  }
 }
 const allFade=minimum.every(n=>n===0)&&maximum.every(n=>n>180);
 render(21000,false);const fixed=r.canvas.toDataURL(),frames=r.frames;render(23000,false);const reduced=fixed===r.canvas.toDataURL()&&frames===r.frames;
 render(24000);const before=r.frames;render(24001);const throttled=r.frames===before;
 const start=performance.now();for(let n=0;n<200;n++)r.paint(n*50,true);const averagePaintMs=(performance.now()-start)/200;
 const surface=r.canvas;r.suspend();const released=surface.width===0&&!r.canvas;
 const ambience=new a.PlaceAmbienceRenderer();ambience.drawGround(c,source,h.ANA_MAP,1000,true);const old=ambience.ana.canvas;ambience.drawGround(c,source,'start',1000,true);const isolated=!ambience.ana.canvas&&old.width===0;ambience.destroy();
 return{stars:h.ANA_STARS.length,escaped,white,blue,minActive,maxActive,allFade,reduced,throttled,released,isolated,averagePaintMs};
});assert.equal(checks.stars,49);assert.equal(checks.escaped,0);assert(checks.white>500);assert(checks.blue>500);assert(checks.minActive>10);assert(checks.maxActive<49);for(const k of ['allFade','reduced','throttled','released','isolated'])assert(checks[k],k);
for(const t of [0,1500,3500,6000]){await page.evaluate(t=>render(t),t);await page.screenshot({path:path.join(out,`ana-${t}.png`)});}fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify(checks,null,2));console.log(JSON.stringify(checks));
}finally{await browser?.close();await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e.stack);process.exitCode=1});
