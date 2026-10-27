// Real Canvas checks: visible motion, authored regions, pause, reduced motion and disposal.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const express=require('express'),{chromium}=require('playwright');
const out=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-wanda-gravity-canvas';fs.mkdirSync(out,{recursive:true});
(async()=>{const app=express();app.use(express.static(path.resolve(__dirname,'../vue-explorakit/src')));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));let browser;
try{
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:896,height:640}});
 await page.goto(`http://127.0.0.1:${server.address().port}/services/wandaArena.js`);
 await page.evaluate(async()=>{document.body.innerHTML='<canvas width="896" height="640"></canvas>';document.body.style='margin:0;background:#0d172a';window.w=await import('/services/wandaArena.js');window.a=await import('/services/placeAmbience.js');window.source=new Image();source.src='/assets/ville4_arene.png';await source.decode();window.c=document.querySelector('canvas').getContext('2d');c.imageSmoothingEnabled=false;});
 const checks=await page.evaluate(()=>{
  const r=new w.WandaArenaRenderer(),props=[...w.WANDA_STONES,...w.WANDA_CRYSTALS],allowed=new Uint8Array(448*320);
  const rect=(x,y,width,height)=>{for(let yy=Math.max(0,Math.floor(y));yy<Math.min(320,Math.ceil(y+height));yy++)for(let xx=Math.max(0,Math.floor(x));xx<Math.min(448,Math.ceil(x+width));xx++)allowed[yy*448+xx]=1;};
  for(const p of props){rect(p.x-p.w/2-3,p.y-p.lift-p.h-5,p.w+6,p.lift+p.h+13);if(p.kind==='crystal')rect(p.x-25,p.y-9,50,25);}
  r.draw(c,source,0);if(!r.canvas)throw Error('Missing Wanda renderer');
  const mask=r.inlays.getContext('2d').getImageData(0,0,448,320).data;for(let i=0;i<allowed.length;i++)if(mask[i*4+3])allowed[i]=1;
  let escaped=0,flowEscaped=0,flowPixels=0;const poseFrames=props.map(()=>new Set());
  for(let t=0;t<=12000;t+=100){r.draw(c,source,t,true);r.poses.forEach((p,i)=>poseFrames[i].add(`${p.x}:${p.y}`));
   const effect=r.context.getImageData(0,0,448,320).data,flow=r.flow.getContext('2d').getImageData(0,0,448,320).data;
   for(let i=0;i<allowed.length;i++){if(effect[i*4+3]&&!allowed[i])escaped++;if(flow[i*4+3]){flowPixels++;if(!mask[i*4+3])flowEscaped++;}}
  }
  r.draw(c,source,12500,true,true);const frozen=JSON.stringify(r.poses),atFreeze=r.floatTime;
  for(let t=12550;t<=13550;t+=50){r.draw(c,source,t,true,true);if(JSON.stringify(r.poses)!==frozen)throw Error('Floating body moves during speech pause');}
  r.draw(c,source,14000,true,true);const resumed=r.floatTime>atFreeze;
  r.draw(c,source,14500,false);const staticImage=r.canvas.toDataURL(),staticFrames=r.frames;r.draw(c,source,18000,false);const reduced=staticImage===r.canvas.toDataURL()&&r.frames===staticFrames;
  r.draw(c,source,19000,true);const before=r.frames;r.draw(c,source,19001,true);const throttled=r.frames===before;
  const start=performance.now();for(let i=0;i<200;i++)r.paint(i*50,i*50,true);const averagePaintMs=(performance.now()-start)/200;
  const surfaces=[r.canvas,r.inlays,r.flow,r.beam,r.glow,...r.props.map(p=>p.texture)],surfaceBytes=surfaces.reduce((n,c)=>n+c.width*c.height*4,0),inlayPixels=r.inlayPixels;
  r.suspend();const released=surfaces.every(c=>c.width===0&&c.height===0)&&!r.canvas&&!r.props.length;r.destroy();r.draw(c,source,20000);const destroyed=!r.canvas;
  const owner=new a.PlaceAmbienceRenderer();owner.drawGround(c,source,w.WANDA_MAP,0,true);const old=owner.wanda.canvas;owner.drawGround(c,source,'start',50,true);const isolated=old.width===0&&!owner.wanda.canvas;owner.destroy();
  return{inlayPixels,props:props.length,movingFrames:poseFrames.map(s=>s.size),escaped,flowEscaped,flowPixels,paused:true,resumed,reduced,throttled,released,destroyed,isolated,surfaceBytes,averagePaintMs};
 });
 fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify(checks,null,2));
 assert.equal(checks.escaped,0);assert.equal(checks.flowEscaped,0);assert(checks.flowPixels>1000);assert(checks.movingFrames.every(n=>n>=4));assert(checks.surfaceBytes<2*1024*1024);assert(checks.averagePaintMs<10);
 for(const key of ['paused','resumed','reduced','throttled','released','destroyed','isolated'])assert(checks[key],key);
 await page.evaluate(()=>{window.preview=new a.PlaceAmbienceRenderer();window.render=t=>{c.drawImage(source,0,0,896,640);preview.drawGround(c,source,w.WANDA_MAP,t,true);preview.draw(c,source,w.WANDA_MAP,t,true);};});
 for(const t of [0,2000,6000,12000]){await page.evaluate(t=>{preview.suspend();for(let now=0;now<=t;now+=50)render(now);},t);await page.screenshot({path:path.join(out,`wanda-${t}.png`)});}
 console.log(JSON.stringify(checks));
}finally{await browser?.close();await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e.stack);process.exitCode=1});
