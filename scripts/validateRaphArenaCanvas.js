// Native Canvas/artwork: room meteors, glass occlusion, cloth, tremors and cleanup.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const express=require('express'),{chromium}=require('playwright');
const out=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-raph-decor-canvas';fs.mkdirSync(out,{recursive:true});
(async()=>{const app=express();app.use(express.static(path.resolve(__dirname,'../vue-explorakit/src')));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));let browser;
try{browser=await chromium.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:896,height:640}});await page.goto(`http://127.0.0.1:${server.address().port}/services/raphArena.js`);
await page.evaluate(async()=>{document.body.innerHTML='<canvas width="896" height="640"></canvas>';document.body.style='margin:0;background:#0d1722;overflow:hidden';window.h=await import('/services/raphArena.js');window.a=await import('/services/placeAmbience.js');window.r=new h.RaphArenaRenderer();window.source=new Image();source.src='/assets/gen_arene5.png';await source.decode();window.c=document.querySelector('canvas').getContext('2d');c.imageSmoothingEnabled=false;window.render=(t,motion=true)=>{c.drawImage(source,0,0,896,640);r.draw(c,source,t,motion);};});
const checks=await page.evaluate(()=>{
 let escaped=0,skyEscaped=0,skyLit=0,maxSkyLit=0,roomLit=0,maxRoomLit=0;const frames=[];
 for(let n=0;n<20;n++){render(n*230);const d=r.context.getImageData(0,0,896,640).data;frames.push(new Uint8ClampedArray(d));
  for(let y=0;y<640;y++)for(let x=0;x<896;x++)if(d[(y*896+x)*4+3]){const lx=x/2,ly=y/2;const sky=lx>=148&&lx<300&&ly<49;const pillar=(lx>=35&&lx<94||lx>=354&&lx<413)&&ly>=80&&ly<242;const room=lx>=102&&lx<346&&ly>=104&&ly<269;const flag=h.RAPH_BANNERS.some(([l,t,rr,b])=>lx>=l-2&&lx<rr+2&&ly>=t&&ly<b);if(!sky&&!pillar&&!flag&&!room)escaped++;}
  const s=r.sky.getContext('2d').getImageData(0,0,r.sky.width,r.sky.height).data,m=r.skyMask.getContext('2d').getImageData(0,0,r.skyMask.width,r.skyMask.height).data;let lit=0;for(let j=3;j<s.length;j+=4)if(s[j]){lit++;if(!m[j])skyEscaped++;}skyLit+=lit;maxSkyLit=Math.max(maxSkyLit,lit);
 }
 // Every projected pixel must stay inside the authored floor polygon.
 const inFloor=(x,y)=>{let hit=false;const p=h.RAPH_ASTRAL_FLOOR;for(let i=0,j=p.length-1;i<p.length;j=i++)if((p[i][1]>y)!==(p[j][1]>y)&&x<(p[j][0]-p[i][0])*(y-p[i][1])/(p[j][1]-p[i][1])+p[i][0])hit=!hit;return hit;};
 let roomEscaped=0,roomChanges=0;
 for(let n=0;n<56;n++){
  render(n*250);const data=r.context.getImageData(0,0,896,640).data;let lit=0;
  for(let y=208;y<538;y++)for(let x=204;x<692;x++){
   const j=(y*896+x)*4;if(!data[j+3])continue;
   // Central floor excludes banners and columns already covered above.
   if(!inFloor((x+.5)/2,(y+.5)/2)){roomEscaped++;continue;}lit++;
   if(data[j]!==frames[0][j]||data[j+3]!==frames[0][j+3])roomChanges++;
  }
  roomLit+=lit;maxRoomLit=Math.max(maxRoomLit,lit);
 }
 let movingCloth=0,movingPillars=0;for(let y=0;y<640;y++)for(let x=0;x<896;x++){const j=(y*896+x)*4;if(frames[0][j]===frames[5][j]&&frames[0][j+3]===frames[5][j+3])continue;if(x>=216&&x<252&&y>=38&&y<120)movingCloth++;if(x>=86&&x<106&&y>=170&&y<286)movingPillars++;}
 const flags=r.flags.map(f=>f.pixels),glassPixels=r.skyPixels;
 render(15000,false);const fixed=r.canvas.toDataURL(),count=r.frames;render(18000,false);const reduced=fixed===r.canvas.toDataURL()&&count===r.frames;const staticAlpha=r.context.getImageData(0,0,896,640).data.some((n,i)=>i%4===3&&n);
 render(20000);const before=r.frames;render(20001);const throttled=r.frames===before;
 const start=performance.now();for(let n=0;n<120;n++)r.paint(n*50,true);const averagePaintMs=(performance.now()-start)/120;
 const surfaces=[r.canvas,r.repair,r.sky,r.skyMask,...r.flags.map(f=>f.texture)];r.suspend();const released=surfaces.every(s=>s.width===0)&&!r.canvas;
 const ambience=new a.PlaceAmbienceRenderer();ambience.drawGround(c,source,h.RAPH_MAP,1000,true);const old=ambience.raph.canvas;ambience.drawGround(c,source,'start',1000,true);const isolated=!ambience.raph.canvas&&old.width===0;ambience.destroy();
 return{escaped,skyEscaped,skyLit,maxSkyLit,roomLit,maxRoomLit,roomChanges,roomEscaped,flags,glassPixels,movingCloth,movingPillars,reduced,staticAlpha,throttled,released,isolated,averagePaintMs};
});assert.equal(checks.escaped,0);assert.equal(checks.roomEscaped,0);assert(checks.roomLit>10000);assert(checks.maxRoomLit>500);assert(checks.roomChanges>10000);assert.equal(checks.skyEscaped,0);assert(checks.skyLit>500);assert(checks.maxSkyLit>60);assert(checks.flags.every(n=>n>250));assert(checks.glassPixels>1500);assert(checks.movingCloth>100);assert(checks.movingPillars>50);assert(!checks.staticAlpha);for(const k of ['reduced','throttled','released','isolated'])assert(checks[k],k);
for(const time of [500,1150,2300,3210]){await page.evaluate(t=>render(t),time);await page.screenshot({path:path.join(out,`raph-${time}.png`)});}
await page.evaluate(()=>{document.querySelector('canvas').style='width:1792px;height:1280px;position:absolute;left:-448px;top:0';render(1150);});await page.setViewportSize({width:896,height:210});await page.screenshot({path:path.join(out,'windows-close.png')});fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify(checks,null,2));console.log(JSON.stringify(checks));
}finally{await browser?.close();await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e.stack);process.exitCode=1});
