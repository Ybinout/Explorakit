// Native visible-pixel equality for camera-culling of Safari sea; no database.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),express=require('express'),playwright=require('playwright');
const engine=process.env.PROFILE_BROWSER||'chromium',out='/tmp/riftmon-safari-water-'+engine;
(async()=>{const app=express();app.use('/before',express.static(process.env.SAFARI_WATER_BASELINE||path.resolve(__dirname,'../vue-explorakit/src')));app.use(express.static(path.resolve(__dirname,'../vue-explorakit/src')));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));let browser;
try{browser=await playwright[engine].launch({headless:true});const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port+'/services/villageWater.js');
const report=await page.evaluate(async()=>{
 const [before,after]=await Promise.all([import('/before/services/villageWater.js'),import('/services/villageWater.js')]),checks=[],costs=[];
 for(const map of['safari1','safari8','safari15']){
  const image=new Image();image.src='/assets/'+map+'.png';await image.decode();const renderers=[new before.VillageWaterRenderer(),new after.VillageWaterRenderer()],canvases=[document.createElement('canvas'),document.createElement('canvas')];
  let time=0;for(const scale of[1,1.5,2])for(const motion of[true,false]){
   for(const c of canvases){c.width=393*scale;c.height=480*scale;}
   for(let step=0;step<48;step++){
    time+=step%4===0?71:16;const camera={x:Math.min(503,step*13),y:(step%9)*11,visibleWidth:393,visibleHeight:480};
    for(let n=0;n<2;n++){const c=canvases[n].getContext('2d');c.setTransform(scale,0,0,scale,-camera.x*scale,-camera.y*scale);c.imageSmoothingEnabled=false;renderers[n].draw(c,image,time,motion,map,n===0?null:camera);}
    const a=canvases.map(c=>c.getContext('2d').getImageData(0,0,c.width,c.height).data);let changed=0;for(let i=0;i<a[0].length;i++)if(a[0][i]!==a[1][i])changed++;if(changed)throw Error(map+' changed '+changed+' channels at '+JSON.stringify({step,scale,motion}));
   }
   checks.push({map,scale,motion,frames:48,changed:0});
  }
  const sample=[[],[]],camera={x:400,y:80,visibleWidth:393,visibleHeight:480};for(let round=0;round<4;round++)for(const n of round%2?[1,0]:[0,1]){const c=canvases[n].getContext('2d');c.setTransform(1,0,0,1,-camera.x,-camera.y);const start=performance.now();for(let i=0;i<120;i++)renderers[n].draw(c,image,100000+round*10000+i*17,true,map,n===0?null:camera);c.getImageData(0,0,1,1);sample[n].push((performance.now()-start)/120);}
  costs.push({map,before:sample[0],after:sample[1]});for(const r of renderers)r.destroy();if(renderers[1].rowStarts||renderers[1].coverage)throw Error('Water cache not released');
 }
 return{checks,costs};
});fs.writeFileSync(out+'.json',JSON.stringify({engine,...report},null,2));assert(report.checks.every(c=>c.changed===0));console.log(JSON.stringify({engine,comparedFrames:report.checks.reduce((n,c)=>n+c.frames,0),costs:report.costs}));
}finally{await browser?.close();await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
