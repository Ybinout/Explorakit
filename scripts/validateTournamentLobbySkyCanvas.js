// Real Canvas: three tournament scenes, bounded sky/sea and interior doorways.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const express=require('express'),playwright=require('playwright');
const engine=process.env.SKY_BROWSER||'chromium',out=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-tournament-sea-'+engine;fs.mkdirSync(out,{recursive:true});
(async()=>{const app=express();app.use(express.static(path.resolve(__dirname,'../vue-explorakit/src')));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));let browser;
try{
 browser=await playwright[engine].launch({headless:true,...(engine==='chromium'?{args:['--no-sandbox']}: {})});const page=await browser.newPage({viewport:{width:896,height:640}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}/services/tournamentLobbySky.js`);
 await page.evaluate(async()=>{document.body.innerHTML='<canvas width="896" height="640"></canvas>';document.body.style='margin:0;background:#0d1722;overflow:hidden';window.h=await import('/services/tournamentLobbySky.js');window.a=await import('/services/placeAmbience.js');window.r=new h.TournamentLobbySkyRenderer();window.c=document.querySelector('canvas').getContext('2d');c.imageSmoothingEnabled=false;window.render=(time,motion=true)=>{c.drawImage(source,0,0,896,640);r.draw(c,source,time,motion,map);};});
 const scenes=[];
 for(const map of ['super_tournament_lobby','super_tournament_sas','super_tournament_room']){
  await page.evaluate(async map=>{window.map=map;window.source=new Image();source.src='/assets/'+map+'.png';await source.decode();},map);
  const check=await page.evaluate(()=>{
   c.drawImage(source,0,0,896,640);const original=c.getImageData(0,0,896,640).data;render(0);const skyPixels=r.skyPixels;
   const allowedCanvas=document.createElement('canvas');allowedCanvas.width=896;allowedCanvas.height=640;const ac=allowedCanvas.getContext('2d');
   for(const layer of r.layers){ac.drawImage(layer.skyMask,layer.patch.x*2,layer.patch.y*2);ac.drawImage(layer.waterMask,layer.patch.x*2,layer.patch.y*2);}
   if(r.profile.passage){ac.save();ac.scale(2,2);ac.fillStyle='white';ac.beginPath();r.profile.passage.forEach(([x,y],i)=>i?ac.lineTo(x,y):ac.moveTo(x,y));ac.closePath();ac.fill();ac.restore();}
   const allowed=ac.getImageData(0,0,896,640).data,main=r.layers[0],sky=main.skyMask.getContext('2d').getImageData(0,0,main.skyMask.width,main.skyMask.height).data;
   let escaped=0,birdFrames=0,birds=0;const cloudFrames=new Set(),waterFrames=r.layers.map(()=>new Set());
   for(let n=0;n<64;n++){
    render(n*500);const image=c.getImageData(0,0,896,640).data;
    for(let i=0;i<image.length;i+=4)if(!allowed[i+3]&&(image[i]!==original[i]||image[i+1]!==original[i+1]||image[i+2]!==original[i+2]))escaped++;
    const effect=r.context.getImageData(0,0,r.canvas.width,r.canvas.height).data;let visible=0,cloudHash=2166136261;
    for(let i=0;i<effect.length;i+=4)if(sky[i+3]){
     if(effect[i]<100&&effect[i+1]<130){visible++;continue;}
     if(effect[i]>140&&effect[i+1]>175&&effect[i+2]>185)cloudHash=Math.imul(cloudHash^i,16777619);
    }
    if(visible)birdFrames++;birds+=visible;cloudFrames.add(cloudHash);
    r.layers.forEach((layer,i)=>waterFrames[i].add(layer.water.toDataURL()));
   }
   render(35000);const frames=r.frames;render(35001);const throttled=r.frames===frames;
   render(37000,false);const fixed=c.canvas.toDataURL(),fixedFrames=r.frames;render(40000,false);const reduced=fixed===c.canvas.toDataURL()&&fixedFrames===r.frames;
   let darkPassage=true;if(r.profile.passage){const y=map==='super_tournament_sas'?25:45,rgba=c.getImageData(448,y*2,1,1).data;darkPassage=rgba[0]<80&&rgba[1]<90&&rgba[2]<120;}
   render(41000);const surfaces=[...r.cloudTextures,...r.layers.flatMap(l=>[l.canvas,l.texture,l.skyMask,l.waterMask,l.water])];
   const started=performance.now();for(let n=0;n<120;n++)r.paint(n*50);const averagePaintMs=(performance.now()-started)/120;
   r.suspend();const released=surfaces.every(s=>s.width===0&&s.height===0)&&!r.canvas;
   const shared=new a.PlaceAmbienceRenderer();shared.drawGround(c,source,map,2000);const before=shared.tournamentLobby.canvas;shared.draw(c,source,map,2000);const integrated=before===shared.tournamentLobby.canvas;shared.drawGround(c,source,'start',2500);const isolated=before.width===0&&!shared.tournamentLobby.canvas;shared.destroy();
   return{map,skyPixels,escaped,birds,birdFrames,cloudFrames:cloudFrames.size,waterFrames:waterFrames.map(s=>s.size),throttled,reduced,darkPassage,released,integrated,isolated,averagePaintMs};
  });
  scenes.push(check);for(const t of [0,6000,16000]){await page.evaluate(t=>render(t),t);await page.screenshot({path:path.join(out,map+'-'+t+'.png')});}await page.evaluate(()=>render(20000,false));await page.screenshot({path:path.join(out,map+'-reduced.png')});
 }
 fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify(scenes,null,2));
 for(const check of scenes){assert(check.skyPixels>1000);assert.equal(check.escaped,0,check.map);assert(check.birdFrames>35,check.map+' birds');assert(check.cloudFrames>20,check.map+' clouds');assert(check.waterFrames.every(n=>n>20),check.map+' water');for(const key of ['throttled','reduced','darkPassage','released','integrated','isolated'])assert(check[key],check.map+' '+key);}
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({success:true,engine,scenes,errors},null,2));console.log(JSON.stringify({engine,scenes,errors}));
}finally{await browser?.close();await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
