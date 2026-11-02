// Real canvas renderer, collectible/admin states and reduced motion; no real account.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const engine=process.env.PRESENTATION_BROWSER||'chromium',out=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-teleporter-glow-'+engine;
const root=path.resolve(__dirname,'../vue-explorakit/src');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const server=require('express')().use(require('express').static(root)).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));let browser;
 try{
  browser=await require('playwright')[engine].launch({headless:true,args:engine==='chromium'?['--no-sandbox']:[]});
  const page=await browser.newPage({viewport:{width:896,height:640}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/services/voidTeleporter.js');
  await page.evaluate(async()=>{
   document.body.innerHTML='<canvas width="896" height="640"></canvas>';document.body.style='margin:0;background:#10151d';
   window.drawProp=(await import('/services/voidTeleporter.js')).drawVoidTeleporter;
   window.c=document.querySelector('canvas').getContext('2d');window.im=new Image();im.src='/assets/professor_lab.png';await im.decode();
   window.base={available:true,found:false,pickup:{map:'professor_lab',x:16,y:9}};
   window.draw=(time,motion=true,state=base,map='professor_lab')=>{c.clearRect(0,0,896,640);c.imageSmoothingEnabled=false;c.drawImage(im,0,0,896,640);return drawProp(c,map,state,time,motion);};
  });
  const result=await page.evaluate(()=>{
   const frame=()=>c.canvas.toDataURL(),pixels=()=>c.getImageData(0,0,896,640).data;
   draw(0);const a=pixels();draw(1200);const b=pixels();let changed=0,outside=0;
   for(let i=0;i<a.length;i+=4)if(a[i]!==b[i]||a[i+1]!==b[i+1]||a[i+2]!==b[i+2]){changed++;const x=i/4%896,y=Math.floor(i/4/896);if(x<508||x>=548||y<282||y>=324)outside++;}
   draw(0,false);const reduced=frame();draw(10000,false);const reducedStatic=reduced===frame();
   const before={...base,available:false};draw(0,true,before);const plain=frame();draw(1200,true,before);const beforeVictoryStatic=plain===frame();
   draw(1200);const bright=frame(),pickupStateUnchanged=JSON.stringify(base)===JSON.stringify({available:true,found:false,pickup:{map:'professor_lab',x:16,y:9}});
   const foundReturnsFalse=draw(1200,true,{...base,found:true})===false,found=frame();
   const absentReturnsFalse=draw(1200,true,null)===false,absent=frame();
   const wrongMapReturnsFalse=draw(1200,true,base,'start')===false,wrongMap=frame();
   const wrongPickupReturnsFalse=draw(1200,true,{...base,pickup:{map:'start',x:16,y:9}})===false;
   const reset={...base,available:false,found:false};draw(1200,true,reset);const resetPhysical=frame()===plain&&frame()!==absent;
   const replay={...base,replay:true};draw(1200,true,replay);const replayHighlight=frame()===bright;
   const t=performance.now();for(let i=0;i<1000;i++)drawProp(c,'professor_lab',base,i*40,true);const meanMs=(performance.now()-t)/1000;
   draw(1200);
   return{changed,outside,reducedStatic,beforeVictoryStatic,pickupStateUnchanged,foundReturnsFalse,absentReturnsFalse,wrongMapReturnsFalse,wrongPickupReturnsFalse,noDrawAfterPickup:found===absent&&found===wrongMap,visibleDifference:bright!==plain,resetPhysical,replayHighlight,meanMs};
  });
  assert(result.changed>100);assert.equal(result.outside,0);for(const[key,value]of Object.entries(result))if(typeof value==='boolean')assert.equal(value,true,key);assert.deepEqual(errors,[]);
  await page.screenshot({path:out+'/laboratory-glow.png'});
  await page.evaluate(()=>{const detail=document.createElement('canvas');detail.width=320;detail.height=240;detail.getContext('2d').imageSmoothingEnabled=false;detail.getContext('2d').drawImage(c.canvas,488,266,80,60,0,0,320,240);document.body.append(detail);c.canvas.style.display='none';});
  await page.locator('canvas').last().screenshot({path:out+'/teleporter-detail.png'});
  const report={success:true,engine,...result,errors,rendererSha256:createHash('sha256').update(fs.readFileSync(root+'/services/voidTeleporter.js')).digest('hex')};
  fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
