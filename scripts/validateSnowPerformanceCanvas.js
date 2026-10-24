// Native Canvas benchmark and cache regression checks; optional pre-patch sources.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const express=require('express'),{chromium}=require('playwright');
(async()=>{const app=express(),src=path.resolve(__dirname,'../vue-explorakit/src');
 const before=process.env.SNOW_BASELINE_PREFIX;
 if(before)for(const[name,file]of [['placeAmbience','ambience'],['worldWeather','weather']])app.get('/before/services/'+name+'.js',(_q,r)=>r.type('js').sendFile(before+'-'+file+'.js'));
 app.use('/before',express.static(src));app.use(express.static(src));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));let browser;
 try{browser=await chromium.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/services/placeAmbience.js`);
 const results=await page.evaluate(async baseline=>{
  const source=new Image();source.src='/assets/ville5.png';await source.decode();
  const results={};
  for(const version of baseline?['before','after']:['after']){
   const prefix=version==='before'?'/before':'';
   const{PlaceAmbienceRenderer}=await import(prefix+'/services/placeAmbience.js'),{WorldWeatherRenderer}=await import(prefix+'/services/worldWeather.js');
   const target=document.createElement('canvas');target.width=896;target.height=640;const c=target.getContext('2d');
   const a=new PlaceAmbienceRenderer(),w=new WorldWeatherRenderer(),climate={wind:1,rain:0,snow:2};a.draw(c,source,'ville5',0,true,1);w.draw(c,0,climate,true,'ville5');
   const measure=(renderer,paint)=>{const rounds=[];for(let pass=0;pass<5;pass++){const start=performance.now();for(let n=0;n<90;n++){paint(n/30);renderer.context.getImageData(0,0,1,1);}rounds.push((performance.now()-start)/90);}return rounds.sort((a,b)=>a-b)[2];};
   const ambienceMs=measure(a,t=>a.paint(t,true,1)),snowMs=measure(w,t=>w.paint(t,climate,true,'ville5'));
   const cache=a.staticLighting;a.draw(c,source,'ville5',5000,true,1);const reused=cache===a.staticLighting;
   a.draw(c,source,'ville5',6000,false,1);const frozen=a.canvas.toDataURL(),frames=a.frames;a.draw(c,source,'ville5',8000,false,1);
   const reduced=frozen===a.canvas.toDataURL()&&frames===a.frames;
   a.suspend();const released=!a.staticLighting&&(!cache||cache.width===0);w.destroy();
   results[version]={ambienceMs,snowMs,totalMs:ambienceMs+snowMs,reused,reduced,released,cache:!!cache};
  }return results;
 },Boolean(before));
 assert(results.after.cache&&results.after.reused&&results.after.reduced&&results.after.released);
 console.log(JSON.stringify(results));
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
