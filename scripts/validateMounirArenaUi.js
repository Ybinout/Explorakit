const assert=require('node:assert/strict'),path=require('node:path');
// Read-only geometry on the real Mounir frame; no gameplay commands or rewards.
async function validateMounirArenaUi(page,output){
 const report=[];
 for(const [width,height]of [[320,480],[393,852],[844,390],[1365,900]]){
  await page.setViewportSize({width,height});await page.waitForTimeout(300);await page.evaluate(async width=>{window.mounirVm.showMobileControls=width<=920;await window.mounirVm.$nextTick();},width);
  await page.locator('[data-battle-environment="lake-gym"] .battle-background').waitFor();
  await page.waitForFunction(()=>[...document.querySelectorAll('.battle-background,[data-battle-platform] img')].every(i=>i.complete&&i.naturalWidth>0));
  const background=await page.locator('.battle-background').evaluate(el=>({src:el.currentSrc,width:el.naturalWidth,height:el.naturalHeight}));
  const portrait=width<=920&&width<height;assert.match(background.src,portrait?/mounir-mobile-v1/:/mounir-wide-v1/);assert.equal(background.width,portrait?1024:1536);assert.equal(background.height,portrait?1536:1024);
  assert.equal(await page.locator('[data-battle-platform] img').count(),2);assert.equal(await page.locator('.battle-ground-disc').count(),0);
  const geometry=await page.evaluate(()=>{
   const b=window.mounirVm.$refs.battleOverlay,scene=document.querySelector('.battle-scene').getBoundingClientRect();
   return ['player','wild'].map(side=>{
    const img=document.querySelector(`[data-battle-platform="${side}"] img`),rect=img.getBoundingClientRect(),c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0);const d=ctx.getImageData(0,0,c.width,c.height).data;let x1=c.width,y1=c.height,x2=0,y2=0,transparent=0;
    for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){const alpha=d[(y*c.width+x)*4+3];if(!alpha)transparent++;if(alpha>16){x1=Math.min(x1,x);x2=Math.max(x2,x);y1=Math.min(y1,y);y2=Math.max(y2,y);}}
    const foot=b.getSpriteGeometry(side),top=rect.y+y1/c.height*rect.height,bottom=rect.y+(y2+1)/c.height*rect.height,center=rect.x+(x1+x2+1)/2/c.width*rect.width;
    return {side,transparent,centerDifference:Math.abs(center-(scene.x+foot.centerX)),top,bottom,footY:scene.y+foot.bottomY,sceneTop:scene.top,sceneBottom:scene.bottom};
   });
  });
  for(const g of geometry){assert(g.transparent>100000);assert(g.centerDifference<1,JSON.stringify(g));assert(g.footY>=g.top-1&&g.footY<=g.bottom+2,JSON.stringify(g));assert(g.bottom>=g.sceneTop&&g.top<g.sceneBottom,JSON.stringify(g));}
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:path.join(output,`mounir-arena-${width}.png`)});report.push({width,portrait,groundContact:true,platforms:2});
 }
 // Selecting another environment or the tournament must not reuse this gym.
 const old=await page.evaluate(()=>{const b=window.mounirVm.$refs.battleOverlay;return {map:b.battleMapName,challenge:b.challenge};});
 await page.evaluate(()=>{window.mounirVm.$refs.battleOverlay.challenge={wave:1,label:'Test'};});await page.locator('.battle-colosseum').waitFor();assert.equal(await page.locator('[data-battle-environment="lake-gym"]').count(),0);
 await page.evaluate(()=>{const b=window.mounirVm.$refs.battleOverlay;b.challenge=null;b.battleMapName='cave1';});await page.locator('[data-battle-environment="cave"]').waitFor();assert.equal(await page.locator('[data-battle-environment="lake-gym"]').count(),0);
 await page.evaluate(()=>{const b=window.mounirVm.$refs.battleOverlay;b.battleMapName='gen_arene1';});await page.waitForFunction(()=>document.querySelector('.battle-background')?.currentSrc.includes('grass-rain'));assert.equal(await page.locator('[data-battle-environment="lake-gym"]').count(),0);
 await page.evaluate(old=>{const b=window.mounirVm.$refs.battleOverlay;b.challenge=old.challenge;b.battleMapName=old.map;},old);await page.locator('[data-battle-environment="lake-gym"]').waitFor();
 return {viewports:report,transparentPlatforms:true,otherGymsUnaffected:true,colosseumPriority:true,cavePriority:true};
}
module.exports={validateMounirArenaUi};
