// Native browser Canvas: visual fixtures, pixel confinement, lifecycle and reduced motion.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const express=require('express'),{chromium}=require('playwright');
const out=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-place-ambience-canvas';fs.mkdirSync(out,{recursive:true});
(async()=>{
 const app=express();app.use(express.static(path.resolve(__dirname,'../vue-explorakit/src')));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));let browser;
 try{
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:896,height:640}});
  await page.goto(`http://127.0.0.1:${server.address().port}/services/placeAmbience.js`);
  await page.evaluate(async()=>{
   document.body.innerHTML='<canvas width="896" height="640"></canvas>';document.body.style='margin:0;background:#0d1722;overflow:hidden';
   window.module=await import('/services/placeAmbience.js');window.r=new window.module.PlaceAmbienceRenderer();window.c=document.querySelector('canvas').getContext('2d');window.c.imageSmoothingEnabled=false;
   window.load=async name=>{const i=new Image();i.src='/assets/'+name+'.png';await i.decode();return i;};
   window.show=async(map,asset=map)=>{window.base=await load(asset);window.front=null;try{window.front=await load(asset+'_f');}catch{}window.map=map;window.render(3210);};
   window.render=(t,motion=true)=>{c.clearRect(0,0,896,640);c.drawImage(base,0,0,896,640);r.drawGround(c,base,map,t,motion);if(front)c.drawImage(front,0,0,896,640);r.draw(c,base,map,t,motion,2);};
  });
  const scenes={gen_ville5:'gen_ville5',route4:'route4',ville5:'ville5',ville1:'ville1',cave1:'cave1',cave2:'cave2',cave_rochebrume1:'cave_rochebrume1',cave_rochebrume2:'cave_rochebrume2',cave_rochebrume3:'cave_rochebrume3',ville1_arene:'ville1_arene',ville_safe1_arene:'ville_safe1_arene',gen_arene5:'gen_arene5',ville3_arene:'ville3_arene',ville4_arene:'ville4_arene',ville5_arene:'ville5_arene'};
  for(const [map,asset] of Object.entries(scenes)){
   await page.evaluate(([map,asset])=>show(map,asset),[map,asset]);
   await page.screenshot({path:path.join(out,map+'.png')});
   const result=await page.evaluate(()=>{
    const first=r.canvas.toDataURL();render(6810);const changed=first!==r.canvas.toDataURL();
    render(7000,false);const staticFirst=r.canvas.toDataURL(),frames=r.frames;render(9000,false);const reduced=staticFirst===r.canvas.toDataURL()&&frames===r.frames;
    render(10000,true);const tick=r.frames;render(10001,true);const limited=r.frames===tick;
    const old=r.canvas;r.suspend();return {changed,reduced,limited,released:old.width===0&&!r.canvas};
   });
   assert(result.changed,map+' must have local motion');assert(result.reduced,map+' reduced motion');assert(result.limited,map+' throttled');assert(result.released,map+' disposal');
  }
  await page.evaluate(()=>show('ville1'));
  const water=await page.evaluate(()=>{const a=r.water.getContext('2d').getImageData(0,0,448,320).data,b=r.waterMask.getContext('2d').getImageData(0,0,448,320).data;let escaped=0,lit=0;for(let i=3;i<a.length;i+=4){if(a[i]){lit++;if(!b[i])escaped++;}}return {escaped,lit};});
  assert.equal(water.escaped,0);assert(water.lit>20);
  const timing=await page.evaluate(()=>{const start=performance.now();for(let i=0;i<200;i++)r.paint(i/20,true,2);return (performance.now()-start)/200;});
  await page.evaluate(()=>{r.destroy();render(12000);});assert(await page.evaluate(()=>!r.canvas));
  console.log(JSON.stringify({scenes:Object.keys(scenes),water,averagePaintMs:timing,lifecycle:true,reducedMotion:true}));
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
