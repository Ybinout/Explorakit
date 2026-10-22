const assert=require('node:assert/strict'),path=require('node:path');
async function validateBattleSandUi(page,output,battle){
 const probes=[];
 for(const [width,height]of [[320,480],[393,852],[844,390],[1365,900]]){
  await page.setViewportSize({width,height});await page.waitForTimeout(300);
  await page.evaluate(width=>window.sandVm.showMobileControls=width<=920,width);
  await page.waitForFunction(()=>{const c=document.querySelector('[data-battle-sand]'),r=c?.getBoundingClientRect();return c?.__vue__?._sandRenderer?.frames>0&&Math.abs(c.width-Math.round(r.width*Math.min(1.5,devicePixelRatio||1)))<2;});
  const probe=await page.locator('[data-battle-sand]').evaluate(async c=>{
   const r=c.__vue__._sandRenderer,rect=c.getBoundingClientRect(),frames=r.frames,start=performance.now();await new Promise(resolve=>setTimeout(resolve,350));
   const pixels=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let maxAlpha=0,sum=0;for(let i=3;i<pixels.length;i+=4){maxAlpha=Math.max(maxAlpha,pixels[i]);sum+=pixels[i];}
   return{stats:r.stats,frames:r.frames-frames,elapsed:performance.now()-start,width:c.width,height:c.height,cssWidth:rect.width,cssHeight:rect.height,pointer:getComputedStyle(c).pointerEvents,textures:r.textures.map(t=>[t.width,t.height]),clearTextureEdges:r.textures.every(t=>{const d=t.getContext('2d').getImageData(0,0,t.width,t.height).data;for(let y=0;y<t.height;y++)for(let x=0;x<t.width;x++)if((x===0||y===0||x===t.width-1||y===t.height-1)&&d[(y*t.width+x)*4+3]!==0)return false;return true;}),maxAlpha,meanAlpha:sum/(c.width*c.height)};
  });
  assert(probe.stats.count>=40&&probe.stats.count<=220);assert.equal(probe.stats.clouds,18);assert(probe.stats.eddies>0);assert.equal(probe.pointer,'none');
  assert(probe.frames>1&&probe.frames<=Math.ceil(probe.elapsed/(1000/30))+1);assert.deepEqual(probe.textures,[[192,128],[192,128],[192,128]]);
  assert(probe.maxAlpha>70&&probe.maxAlpha<245);assert(probe.meanAlpha>3&&probe.meanAlpha<50,JSON.stringify(probe));assert(probe.clearTextureEdges,'dust textures must fade fully before their edges');assert(probe.width<=probe.cssWidth*1.5+1&&probe.height<=probe.cssHeight*1.5+1);
  assert.equal(await page.locator('[data-battle-weather]').getAttribute('aria-label'),'Tempête de sable');probes.push(probe);
  await page.screenshot({path:path.join(output,`combat-sand-${width}.png`)});
 }
 await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(120);const frames=await page.locator('[data-battle-sand]').evaluate(c=>c.__vue__._sandRenderer.frames);await page.waitForTimeout(200);assert.equal(await page.locator('[data-battle-sand]').evaluate(c=>c.__vue__._sandRenderer.frames),frames);
 await page.emulateMedia({reducedMotion:'no-preference'});
 await page.evaluate(()=>window.sandVm.preferences.animationsEnabled=false);await page.waitForTimeout(120);const still=await page.locator('[data-battle-sand]').evaluate(c=>c.__vue__._sandRenderer.frames);await page.waitForTimeout(150);assert.equal(await page.locator('[data-battle-sand]').evaluate(c=>c.__vue__._sandRenderer.frames),still);await page.evaluate(()=>window.sandVm.preferences.animationsEnabled=true);
 await page.locator('[data-battle-sand]').evaluate(c=>{window.hiddenSandTextures=[...c.__vue__._sandRenderer.textures];Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
 assert.equal(await page.locator('[data-battle-sand]').evaluate(c=>c.width),0);assert(await page.evaluate(()=>window.hiddenSandTextures.every(t=>t.width===0)));
 await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});await page.waitForFunction(()=>document.querySelector('[data-battle-sand]')?.width>0);
 await page.locator('[data-battle-sand]').evaluate(c=>window.replacedSandRenderer=c.__vue__._sandRenderer);
 await page.locator('.action-attack:enabled').click();await page.locator('.battle-grid-attacks button:enabled').first().click();await page.locator('.battle-scene.weather-sun').waitFor();
 assert.equal(battle.state.weather.kind,'sun');assert.equal(await page.locator('[data-battle-sand]').count(),0);assert(await page.evaluate(()=>window.replacedSandRenderer.destroyed&&window.replacedSandRenderer.textures.length===0));
 battle.b.equipe.pokemons[0].passiveAbility='Sand Stream';require('../server/game/battle/battleEngine').applySwitchInEffects(battle.b.equipe.pokemons[0],battle.sides[1],battle.sides[0],battle.state,battle.a.equipe.pokemons[0]);battle.sync();await page.locator('[data-battle-sand]').waitFor();
 await page.locator('[data-battle-sand]').evaluate(c=>window.endedSandRenderer=c.__vue__._sandRenderer);await page.locator('.action-flee:enabled').click();await page.waitForFunction(()=>!window.sandVm.battle);assert(await page.evaluate(()=>window.endedSandRenderer.destroyed&&window.endedSandRenderer.textures.length===0));
 return{probes,independentGrainsAndClouds:true,reducedMotion:true,visibilityRelease:true,realSunAndSandStream:true,endCleanup:true};
}
module.exports={validateBattleSandUi};
