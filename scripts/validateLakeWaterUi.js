const assert = require('node:assert/strict'), path = require('node:path');
module.exports = async function validateLakeWaterUi(page, output) {
  await page.waitForFunction(() => { const v = document.querySelector('.game-root')?.__vue__; return v?.map === 'ville1' && !v.mapLoading && v._villageWater?.map === 'ville1' && v._villageWater.frames > 1; });
  const lake = await page.evaluate(() => {
    const v = document.querySelector('.game-root').__vue__, r = new v._villageWater.constructor(), target = document.createElement('canvas');
    target.width = 896; target.height = 640;
    r.draw(target.getContext('2d'), v.mapImage, 200, true, 'ville1'); const first = r.output.slice();
    r.draw(target.getContext('2d'), v.mapImage, 2300, true, 'ville1'); let changed = 0, outside = 0, alpha = 0;
    for (let i = 0; i < first.length; i++) {
      if (first[i] !== r.output[i]) changed++;
      if (!r.mask.interior[i] && r.output[i] !== r.original[i]) outside++;
      if (r.frame.data[i * 4 + 3] !== r.colors[i * 4 + 3]) alpha++;
    }
    const pixels = r.mask.pixels.length;
    // Rocks, bank, roof and foreground trees must never enter the animation mask.
    const fixed = [[279,39],[367,49],[386,123],[248,24],[330,95],[430,40]].every(([x,y]) => !r.mask.interior[y*448+x]);
    r.destroy(); return {changed, outside, alpha, pixels, fixed, dry: !v.mapWeather?.kind};
  });
  assert(lake.changed > 100 && lake.pixels > 5000); assert(lake.fixed && lake.dry); assert.equal(lake.outside, 0); assert.equal(lake.alpha, 0);
  for (const [width,height] of [[320,480],[393,852],[844,390],[1365,900]]) {
    await page.setViewportSize({width,height});
    await page.evaluate(width => { document.querySelector('.game-root').__vue__.showMobileControls = width <= 920; },width);
    await page.screenshot({path: path.join(output,`ville-du-lac-water-${width}.png`)});
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1));
  }
  for (const reduced of ['system','game']) {
    if (reduced === 'system') await page.emulateMedia({reducedMotion:'reduce'});
    else await page.evaluate(() => { const v=document.querySelector('.game-root').__vue__; v.preferences={...v.preferences,animationsEnabled:false}; });
    await page.waitForFunction(() => !document.querySelector('.game-root').__vue__._villageWater?.canvas);
    if (reduced === 'system') await page.emulateMedia({reducedMotion:'no-preference'});
    else await page.evaluate(() => { const v=document.querySelector('.game-root').__vue__; v.preferences={...v.preferences,animationsEnabled:true}; });
    await page.waitForFunction(() => document.querySelector('.game-root').__vue__._villageWater?.canvas);
  }
  for (const flag of ['battle','mapLoading']) {
    await page.evaluate(flag => { document.querySelector('.game-root').__vue__[flag]=true; },flag);
    await page.waitForFunction(() => !document.querySelector('.game-root').__vue__._villageWater?.canvas);
    await page.evaluate(flag => { document.querySelector('.game-root').__vue__[flag]=false; },flag);
    await page.waitForFunction(() => document.querySelector('.game-root').__vue__._villageWater?.canvas);
  }
  await page.evaluate(() => { Object.defineProperty(document,'hidden',{configurable:true,value:true}); document.dispatchEvent(new Event('visibilitychange')); });
  assert.equal(await page.evaluate(() => document.querySelector('.game-root').__vue__._villageWater.canvas),null);
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForFunction(() => document.querySelector('.game-root').__vue__._villageWater?.canvas);
  return {...lake,viewports:4,reducedMotion:true,battleLoadingVisibility:true};
};
