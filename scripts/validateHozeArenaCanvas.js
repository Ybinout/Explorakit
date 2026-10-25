// Real Canvas/artwork: containment, visible local motion, stable reduced motion and disposal.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const express=require('express'),{chromium}=require('playwright');
const out=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-hoze-quake-canvas';fs.mkdirSync(out,{recursive:true});
(async()=>{const app=express();app.use(express.static(path.resolve(__dirname,'../vue-explorakit/src')));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));let browser;
try{browser=await chromium.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:896,height:640}});await page.goto(`http://127.0.0.1:${server.address().port}/services/hozeArena.js`);
await page.evaluate(async()=>{document.body.innerHTML='<canvas width="896" height="640"></canvas>';document.body.style='margin:0;background:#0d1722;overflow:hidden';window.h=await import('/services/hozeArena.js');window.a=await import('/services/placeAmbience.js');window.r=new h.HozeArenaRenderer();window.source=new Image();source.src='/assets/ville_safe1_arene.png';await source.decode();window.c=document.querySelector('canvas').getContext('2d');c.imageSmoothingEnabled=false;window.render=(t,motion=true)=>{c.drawImage(source,0,0,896,640);r.draw(c,source,t,motion);};});
const checks=await page.evaluate(()=>{
 const frames=[];let outside=0,left=0,right=0;
 for(const t of [0,450,1000,1700,2300,4000,6200,9800,12500]){render(t);const data=r.context.getImageData(0,0,896,640).data;frames.push(new Uint8ClampedArray(data));for(let y=0;y<640;y++)for(let x=0;x<896;x++)if(data[(y*896+x)*4+3]){const allowed=y>=160&&y<514&&(x>=70&&x<222||x>=674&&x<826);if(!allowed)outside++;if(x<448)left++;else right++;}}
 let pillarPixels=0;const first=frames[0],second=frames[2];for(let y=170;y<286;y++)for(let x=86;x<106;x++){const j=(y*896+x)*4;if(first[j]!==second[j]||first[j+3]!==second[j+3])pillarPixels++;}
 render(18000,false);const fixed=r.canvas.toDataURL(),count=r.frames;render(19000,false);const reduced=fixed===r.canvas.toDataURL()&&count===r.frames;
 render(20000);const before=r.frames;render(20001);const throttled=r.frames===before;
 const start=performance.now();for(let n=0;n<120;n++)r.paint(n*50,true);const averagePaintMs=(performance.now()-start)/120;
 const old=r.canvas;r.suspend();const released=old.width===0&&!r.canvas;
 const ambience=new a.PlaceAmbienceRenderer();ambience.drawGround(c,source,h.HOZE_MAP,1000,true);const surface=ambience.hoze.canvas;ambience.drawGround(c,source,'start',1000,true);const isolated=!ambience.hoze.canvas&&surface.width===0;ambience.destroy();
 return{outside,left,right,pillarPixels,reduced,throttled,released,isolated,averagePaintMs};
});assert.equal(checks.outside,0);assert(checks.left>200&&checks.right>200);assert(checks.pillarPixels>50);for(const k of ['reduced','throttled','released','isolated'])assert(checks[k],k);
for(const time of [450,1000,2300,4200,9800]){await page.evaluate(t=>render(t),time);await page.screenshot({path:path.join(out,`hoze-${time}.png`)});}fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify(checks,null,2));console.log(JSON.stringify(checks));
}finally{await browser?.close();await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e.stack);process.exitCode=1});
