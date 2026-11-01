// Canvas-only checks: no database, account or deployed asset is modified.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const engine=process.env.PRESENTATION_BROWSER||'chromium',out=process.env.RELEASE_SCREENSHOTS||'/tmp/riftmon-club-alignment-neon-'+engine;
const layout=require('../data/game/whitepeak_layout.json');
const source=fs.readFileSync(path.join(__dirname,'../vue-explorakit/src/services/whitepeakPodiums.js'),'utf8').replace(/^import .*;\n/m,'').replace(/export /g,'');
(async()=>{
 const browser=await require('playwright')[engine].launch({headless:true,...(engine==='chromium'?{args:['--no-sandbox']}: {})});
 try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const checks=await page.evaluate(({source,layout})=>{
   let created=0;const create=document.createElement.bind(document);document.createElement=(name,...args)=>{if(name==='canvas')created++;return create(name,...args);};
   const {occupiedPodiums,drawWhitepeakPodiums}=new Function('layout',source+';return {occupiedPodiums,drawWhitepeakPodiums};')(layout);
   const canvas=create('canvas');canvas.width=896;canvas.height=640;const c=canvas.getContext('2d');
   const red={currentmap:'ville5_maison1',x:560,y:240},blue={currentmap:'ville5_maison1',x:336,y:240};
   function frame(players,now=0,motion=false,map='ville5_maison1'){c.clearRect(0,0,896,640);drawWhitepeakPodiums(c,map,players,now,motion);return c.getImageData(0,0,896,640).data;}
   const empty=frame({}),one=frame({red}),both=frame({red,blue}),still=frame({red,blue},9999),movingA=frame({red,blue},0,true),movingB=frame({red,blue},1100,true),other=frame({red,blue},0,true,'start');
   let emptyPixels=0,redPixels=0,bluePixels=0,staticDifferences=0,animatedDifferences=0,otherPixels=0;
   for(let i=0;i<empty.length;i+=4){if(empty[i+3])emptyPixels++;if(other[i+3])otherPixels++;if(one[i+3]&&one[i]>one[i+2])redPixels++;if(both[i+3]&&both[i+2]>both[i])bluePixels++;if(both[i+3]!==still[i+3])staticDifferences++;if(movingA[i+3]!==movingB[i+3])animatedDifferences++;}
   const cachedCanvases=created;for(let i=0;i<100;i++)frame({red,blue},i*16,true);
   return{emptyPixels,redPixels,bluePixels,staticDifferences,animatedDifferences,otherPixels,cachedCanvases,canvasesAfter100Frames:created,occupied:occupiedPodiums({red,blue})};
  },{source,layout});
  assert.equal(checks.emptyPixels,0);assert.equal(checks.otherPixels,0);assert(checks.redPixels>1000&&checks.bluePixels>1000);assert.equal(checks.staticDifferences,0);assert(checks.animatedDifferences>1000);assert.equal(checks.cachedCanvases,2);assert.equal(checks.canvasesAfter100Frames,2);assert.deepEqual(checks.occupied,[true,true]);assert.deepEqual(errors,[]);
  fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({success:true,engine,checks,errors},null,2));console.log(JSON.stringify({success:true,engine,checks}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
