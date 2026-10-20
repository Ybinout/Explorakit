const assert=require('node:assert/strict'),path=require('node:path');
async function validateBattleEffortUi(page,output){
 const actual=await page.locator('[data-battle-effort-yield]').innerText();assert.equal(actual,'EV : +1 Vit.');
 for(const [width,height]of [[320,480],[393,852],[844,390],[1365,900]]){
  await page.setViewportSize({width,height});
  for(const mode of ['light','dark']){
   await page.evaluate(({width,mode})=>{const v=window.combatVm;v.showMobileControls=width<=920;v.updatePreferences({...v.preferences,themeMode:mode});v.$refs.battleOverlay.opponentEffortYield={specialAttack:2,specialDefense:1};},{width,mode});
   const label=page.locator('[data-battle-effort-yield]');assert.equal(await label.innerText(),'EV : +2 Atq. Spé. · +1 Déf. Spé.');
   const geometry=await label.evaluate(el=>{
    const r=el.getBoundingClientRect(),c=el.closest('.battle-status').getBoundingClientRect(),s=getComputedStyle(el),other=document.querySelector('.battle-status-player').getBoundingClientRect();
    const rgb=x=>x.match(/[\d.]+/g).slice(0,3).map(Number),lum=x=>rgb(x).map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
    const fg=lum(s.color),card=getComputedStyle(el.closest('.battle-status'));
    const backgrounds=(card.backgroundImage.match(/rgba?\([^)]+\)/g)||[card.backgroundColor]).map(lum);
    const contrast=Math.min(...backgrounds.map(bg=>(Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05)));
    const covered=r.left<other.right&&r.right>other.left&&r.top<other.bottom&&r.bottom>other.top;
    return {covered,inside:r.left>=c.left&&r.right<=c.right&&r.bottom<=c.bottom&&r.top>=c.top,visible:r.top>=0&&r.bottom<=innerHeight,font:Number.parseFloat(s.fontSize),contrast,overflow:el.scrollWidth>el.clientWidth+1};
   });
   assert(geometry.inside&&geometry.visible&&!geometry.overflow&&!geometry.covered,JSON.stringify(geometry));assert(geometry.font>=10);assert(geometry.contrast>=4.5);
   await page.screenshot({path:path.join(output,`ev-preview-${mode}-${width}.png`)});
  }
 }
 await page.evaluate(()=>{const v=window.combatVm,b=v.$refs.battleOverlay;b.opponentEffortYield=null;});assert.equal(await page.locator('[data-battle-effort-yield]').count(),0);
 await page.evaluate(()=>{const v=window.combatVm;v.updatePreferences({...v.preferences,themeMode:'light'});v.$refs.battleOverlay.opponentEffortYield={speed:1};});
 await page.setViewportSize({width:393,height:852});
 return {actualYield:true,mixedYield:true,viewports:4,themes:2,minContrast:4.5,pvpHidden:true};
}
module.exports={validateBattleEffortUi};
