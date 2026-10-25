// Actual artwork and Canvas: mask confinement, motion, cache and disposal.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),express=require('express'),{chromium}=require('playwright');
const out=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-waterfalls-canvas';fs.mkdirSync(out,{recursive:true});
(async()=>{const app=express();app.use(express.static(path.resolve(__dirname,'../vue-explorakit/src')));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));let browser;
try{browser=await chromium.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/services/waterfalls.js`);
 await page.evaluate(async()=>{document.body.innerHTML='<canvas></canvas>';document.body.style='margin:0;background:#102535';window.module=await import('/services/waterfalls.js');});
 const report=[];
 for(const[kind,file]of [['hall','ville1_arene.png'],['wide','battle/mounir-wide-v1.webp'],['mobile','battle/mounir-mobile-v1.webp']]){
  const result=await page.evaluate(async({kind,file})=>{
   const{WaterfallRenderer,waterfallProfile}=window.module,p=waterfallProfile(kind),image=new Image();image.src='/assets/'+file;await image.decode();
   const canvas=document.querySelector('canvas');canvas.width=p.width;canvas.height=p.height;const c=canvas.getContext('2d');c.imageSmoothingEnabled=false;
   window.draw=t=>{c.clearRect(0,0,p.width,p.height);c.drawImage(image,0,0,p.width,p.height);r.draw(c,image,t,kind);};
   const r=new WaterfallRenderer();window.renderer=r;draw(200);const first=r.frame.data.slice();draw(600);let changed=0,outside=0;
   for(let i=0;i<r.mask.owners.length;i++){if(r.mask.owners[i]){if(first[i*4]!==r.frame.data[i*4]||first[i*4+1]!==r.frame.data[i*4+1]||first[i*4+2]!==r.frame.data[i*4+2])changed++;}else if(r.frame.data[i*4+3])outside++;}
   const pools=(p.pools||[]).map((_,n)=>r.mask.pixels.filter(i=>r.mask.owners[i]===p.regions.length+n+1).length),regions=p.regions.map((_,n)=>r.mask.pixels.filter(i=>r.mask.owners[i]===n+1).length),frames=r.frames;draw(621);const cached=r.frames===frames;
   let emblem=0;if(kind==='hall')for(let y=0;y<40;y++)for(let x=204;x<244;x++)emblem+=r.mask.owners[y*p.width+x];
   const start=performance.now();for(let i=0;i<100;i++)draw(1000+i*60);const meanMs=(performance.now()-start)/100;
   draw(600);return{kind,width:p.width,height:p.height,pixels:r.mask.pixels.length,regions,pools,changed,outside,cached,emblem,meanMs};
  },{kind,file});
  assert(result.changed>result.pixels*.3,JSON.stringify(result));assert(result.pools.every(n=>n>200),JSON.stringify(result));assert(result.regions.every(n=>n>3),JSON.stringify(result));assert.equal(result.outside,0);assert(result.cached);assert.equal(result.emblem,0);
  await page.setViewportSize({width:result.width,height:result.height});await page.screenshot({path:path.join(out,kind+'.png')});
  const life=await page.evaluate(()=>{const r=window.renderer,old=r.canvas;r.draw(document.querySelector('canvas').getContext('2d'),r.source,800,r.kind,false);const stopped=old.width===0&&!r.canvas;r.destroy();return{stopped,destroyed:r.destroyed,cleared:!r.original&&!r.frame&&!r.mask};});assert.deepEqual(life,{stopped:true,destroyed:true,cleared:true});report.push(result);
 }
 console.log(JSON.stringify({report,lifecycle:true,out}));
}finally{await browser?.close();await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e.stack);process.exitCode=1});
