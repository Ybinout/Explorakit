// Native canvas visual parity, bounded work, lifetime and timing. No SQL access.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),express=require('express'),playwright=require('playwright');
const engine=process.env.PROFILE_BROWSER||'chromium',out=process.env.LAB_SCENERY_OUT||'/tmp/riftmon-roche-scenery-'+engine;fs.mkdirSync(out,{recursive:true});
(async()=>{const app=express();app.use(express.static(path.resolve(__dirname,'../vue-explorakit/src')));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));let browser;
 try{browser=await playwright[engine].launch({headless:true});const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port+'/services/experienceLaboratoryScenery.js');const result=await page.evaluate(async()=>{
  const {ExperienceLaboratoryRenderer,EXPERIENCE_LAB_ZONES,drawExperienceLaboratory}=await import('/services/experienceLaboratoryScenery.js'),{PokemonComputerRenderer}=await import('/services/pokemonComputer.js');
  const map='ville4_maison2',source=new Image();source.src='/assets/rochebrume-xp-lab-v1.webp';await source.decode();const checks=[],costs=[],lifetime=[],canvases=[];
  const make=()=>{const c=document.createElement('canvas');canvases.push(c);return c;};const renderer=new ExperienceLaboratoryRenderer(make),pair=[make(),make()],contexts=pair.map(c=>c.getContext('2d'));
  const cached=(target,map,time=0,motion=true,ratio=1,camera=null)=>renderer.draw(target,map,time,motion,ratio,camera);
  let compared=0,maxDelta=0,maxChanged=0;const differences=[];
  const draw=(i,t,motion,ratio,camera=null)=>{const c=contexts[i];c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,pair[i].width,pair[i].height);c.imageSmoothingEnabled=false;c.setTransform(ratio,0,0,ratio,-(camera?.x||0)*ratio,-(camera?.y||0)*ratio);c.drawImage(source,0,0,896,640);if(i===0)drawExperienceLaboratory(c,map,t,motion,camera);else cached(c,map,t,motion,ratio,camera);};
  for(const ratio of[1,1.5,2]){
   for(const c of pair){c.width=Math.ceil(896*ratio);c.height=Math.ceil(640*ratio);}
   for(const motion of[true,false])for(const time of[0,80,161,1175,10000]){
    for(let i=0;i<2;i++)draw(i,time,motion,ratio);const a=contexts[0].getImageData(0,0,pair[0].width,pair[0].height).data,b=contexts[1].getImageData(0,0,pair[1].width,pair[1].height).data;let delta=0,changed=0;
    for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);if(d){changed++;delta=Math.max(delta,d);if(d>10 && differences.length<20)differences.push({ratio,time,motion,x:Math.floor(i/4)%pair[0].width,y:Math.floor(Math.floor(i/4)/pair[0].width),channel:i%4,direct:a[i],cached:b[i]});}}maxDelta=Math.max(maxDelta,delta);maxChanged=Math.max(maxChanged,changed);compared++;checks.push({ratio,motion,time,delta,changed});
   }
  }
  // Check masks against the unchanged map. No effect may spill onto the floor.
  for(const c of pair){c.width=896;c.height=640;}
  draw(0,1000,true,1);const pixels=contexts[0].getImageData(0,0,896,640).data;contexts[1].imageSmoothingEnabled=false;contexts[1].drawImage(source,0,0,896,640);const base=contexts[1].getImageData(0,0,896,640).data;let outside=0,inside=0;
  for(let y=0;y<640;y++)for(let x=0;x<896;x++){const n=(y*896+x)*4;if(pixels.slice(n,n+4).some((v,i)=>v!==base[n+i])){const inZone=EXPERIENCE_LAB_ZONES.some(z=>x>=Math.floor(z.bounds.x)-1&&x<=Math.ceil(z.bounds.x+z.bounds.width)+1&&y>=Math.floor(z.bounds.y)-1&&y<=Math.ceil(z.bounds.y+z.bounds.height)+1);if(inZone)inside++;else outside++;}}
  if(outside)throw Error('Effects outside artwork masks: '+outside);if(inside<100)throw Error('No visible animation');lifetime.push('effects-confined-to-glass-and-screens');
  const phases=[];draw(0,0,true,1);draw(1,2500,true,1);const phaseImages=contexts.map(c=>c.getImageData(0,0,896,640).data);
  for(const z of EXPERIENCE_LAB_ZONES){let n=0;for(let y=Math.max(0,Math.floor(z.bounds.y));y<Math.ceil(z.bounds.y+z.bounds.height);y++)for(let x=Math.max(0,Math.floor(z.bounds.x));x<Math.ceil(z.bounds.x+z.bounds.width);x++){const i=(y*896+x)*4;if(phaseImages[0].slice(i,i+4).some((v,j)=>v!==phaseImages[1][i+j]))n++;}if(!n)throw Error('Static decoration: '+z.id);phases.push({zone:z.id,changedPixels:n});}
  lifetime.push('every-decoration-has-visible-motion');

  renderer.suspend();let paints=0;cached(contexts[1],map,1000,true,1);for(const l of renderer.layers){const p=l.patch.paint;l.patch.paint=(...args)=>{paints++;return p(...args);};}for(let i=0;i<40;i++)cached(contexts[1],map,1001,true,1);if(paints)throw Error('Unchanged phases repainted');lifetime.push('unchanged-phase-no-repaint');
  const old=renderer.layers.map(l=>l.patch.canvas);cached(contexts[1],map,2000,false,1);paints=0;for(let i=0;i<40;i++)cached(contexts[1],map,3000+i*200,false,1);if(paints)throw Error('Reduced motion animated');lifetime.push('reduced-motion-fixed-pose');
  renderer.suspend();if(old.some(c=>c.width||c.height))throw Error('Released canvas still allocated');cached(contexts[1],map,1000,true,2,{x:600,y:180,visibleWidth:130,visibleHeight:110});if(renderer.layers.length!==1||renderer.layers[0].zone.id!=='console')throw Error('Off-camera allocations');lifetime.push('off-camera-no-allocation-or-paint');
  const oldLayer=renderer.layers[0],cachedCanvas=oldLayer.patch?.canvas;cached(contexts[1],map,1100,true,1);if(cachedCanvas && (cachedCanvas.width||cachedCanvas.height) || oldLayer.commands)throw Error('Scale did not release old layers');cached(contexts[1],'start',1200);if(renderer.layers.length)throw Error('Map exit retained layers');lifetime.push('scale-and-map-release');
  const parent=new PokemonComputerRenderer(make);parent.draw(contexts[1],{},map,2000,true,1);const allocated=parent.experienceLab.layers.map(l=>l.patch.canvas);parent.suspend();if(allocated.some(c=>c.width||c.height))throw Error('Parent suspend missed lab');lifetime.push('world-parent-suspend-releases-all');
  // The same pictures/phases, direct per-frame painter vs bounded cached painter.
  for(const ratio of[1,1.5,2]){
   for(const c of pair){c.width=896*ratio;c.height=640*ratio;}renderer.suspend();const samples=[[],[]];
   for(let run=0;run<6;run++)for(const i of run%2?[1,0]:[0,1]){const c=contexts[i];c.setTransform(ratio,0,0,ratio,0,0);for(let j=0;j<100;j++){const time=run*10000+j*16.667;if(i===0)drawExperienceLaboratory(c,map,time,true);else cached(c,map,time,true,ratio);}const start=performance.now();for(let j=0;j<900;j++){const time=run*20000+j*16.667;if(i===0)drawExperienceLaboratory(c,map,time,true);else cached(c,map,time,true,ratio);}c.getImageData(0,0,1,1);samples[i].push((performance.now()-start)/900);}
   costs.push({ratio,directMsPerFrame:samples[0],cachedMsPerFrame:samples[1]});
  }
  // Expose two different frames for visual inspection, and one mobile camera.
  for(const c of pair){c.width=896;c.height=640;}for(let i=0;i<2;i++)draw(i,i?1750:1000,true,1);document.body.textContent='';document.body.style.cssText='margin:0;background:#142735;display:flex;flex-wrap:wrap';for(const c of pair){c.style.width='896px';c.style.maxWidth='100%';c.style.height='auto';document.body.appendChild(c);}
  const totalNativePixels=EXPERIENCE_LAB_ZONES.filter(z=>!z.direct).reduce((n,z)=>n+z.bounds.width*z.bounds.height,0);return{compared,maxDelta,maxChanged,differences,checks,lifetime,phases,costs,insideChangedPixels:inside,outsideChangedPixels:outside,cacheWorldPixels:totalNativePixels,wholeMapWorldPixels:896*640};
 });await page.screenshot({path:path.join(out,'phases.png'),fullPage:true});fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({engine,...result},null,2));assert.equal(result.outsideChangedPixels,0);assert(result.maxDelta<=3,'Cache differs beyond compositing rounding');assert(result.maxChanged<3000,'Cache changes too many pixels');console.log(JSON.stringify({engine,compared:result.compared,maxDelta:result.maxDelta,maxChanged:result.maxChanged,lifetime:result.lifetime,costs:result.costs}));
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
