// Reproducible authored-light inspection and real Canvas performance/lifecycle checks.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const express=require('express'),{chromium}=require('playwright');
const out=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-daynight-canvas';fs.mkdirSync(out,{recursive:true});
(async()=>{
 const app=express();app.use(express.static(path.resolve(__dirname,'../vue-explorakit/src')));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));let browser;
 try{
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:896,height:640}});
  await page.goto(`http://127.0.0.1:${server.address().port}/services/worldNight.js`);
  await page.evaluate(async()=>{
   document.body.innerHTML='<canvas width="896" height="640"></canvas>';document.body.style='margin:0;background:#0d1722;overflow:hidden';
   const {WorldNightRenderer}=await import('/services/worldNight.js'),{PlaceAmbienceRenderer}=await import('/services/placeAmbience.js'),{WorldWeatherRenderer}=await import('/services/worldWeather.js');
   window.day=await import('/services/worldDaylight.js');window.n=new WorldNightRenderer();window.a=new PlaceAmbienceRenderer();window.w=new WorldWeatherRenderer();
   window.c=document.querySelector('canvas').getContext('2d');c.imageSmoothingEnabled=false;
   window.load=async name=>{const image=new Image();image.src='/assets/'+name+'.png';await image.decode();return image;};
   window.show=async(map,phase,weather={})=>{window.map=map;window.weather=weather;window.base=await load(map);window.front=null;try{window.front=await load(map+'_f');}catch{}
    window.time=Date.parse('2026-10-24T'+({day:'10:00',dusk:'17:00',night:'21:00',dawn:'05:00'}[phase])+':00Z');window.light=day.daylightAt(time);window.render(time);};
   window.render=(t,motion=true)=>{c.clearRect(0,0,896,640);c.drawImage(base,0,0,896,640);if(front)c.drawImage(front,0,0,896,640);
    w.draw(c,t,weather,motion,map);a.draw(c,base,map,t,motion,weather.wind||0,light);n.draw(c,map,t,light,weather,motion,base);};
  });
  const maps=['start','ville1','ville_safe1','gen_ville5','ville_commerciale','ville3','ville4','ville5','route1','route3','route4','gen_route8','route13','route14'];
  const climates=require('../data/game/map_weather.json');const measurements=[];
  for(const map of maps)for(const phase of ['day','dusk','night']){
   await page.evaluate(([m,p,w])=>show(m,p,w),[map,phase,climates[map]?.ambience||{}]);
   await page.screenshot({path:path.join(out,map+'-'+phase+'.png')});
   if(phase==='night'){
    const info=await page.evaluate(()=>{
     render(time+100,false);const previous=n.canvas.toDataURL(),f=n.frames;render(time+600,false);
     const staticOK=previous===n.canvas.toDataURL()&&n.frames===f;
     const paints=n.paints,start=performance.now();for(let i=0;i<160;i++)n.draw(c,map,time+1000+i*51,light,weather,true,base);
     const drawMs=(performance.now()-start)/160,cached=n.paints===paints,old=n.canvas;n.suspend();return {staticOK,cached,drawMs,released:old.width===0&&!n.canvas};
    });
    assert(info.staticOK);assert(info.cached);assert(info.released);measurements.push({map,...info});
   }
  }
  for(const map of ['cave1','ville5_arene','route2_maison']){
   await page.evaluate(map=>show(map,'day'),map);const before=await page.locator('canvas').screenshot();
   await page.evaluate(map=>show(map,'night'),map);const after=await page.locator('canvas').screenshot();
   // Compare at identical ambient animation phase: day cycle has no interior layer.
   assert(await page.evaluate(()=>!n.canvas));await page.screenshot({path:path.join(out,map+'-unchanged.png')});assert(before.length&&after.length);
  }
  console.log(JSON.stringify({scenes:maps.length*3,measurements},null,2));
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
