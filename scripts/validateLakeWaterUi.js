const assert = require('node:assert/strict'), path = require('node:path');
const LAKES = {
  ville3: { slug: 'clairfontaine', point: [480,340], minimum: 5000, fixed: [[235,145],[200,168],[280,120],[176,140],[230,96],[235,200],[100,100]] },
  ville1: { slug: 'ville-du-lac', point: [790,270], minimum: 5000, fixed: [[279,39],[367,49],[386,123],[248,24],[330,95],[430,40]] },
  route3: { slug: 'route3', point: [600,540], minimum: 3000, fixed: [[255,273],[319,273],[248,244],[358,246],[213,265],[300,230],[80,140]] },
};
module.exports = async function validateLakeWaterUi(page, output, map = 'ville1') {
  const profile = LAKES[map]; assert(profile, 'A lake fixture must be explicitly mapped');
  const { getWorldCamera } = await import('../vue-explorakit/src/services/worldCamera.js');
  await page.waitForFunction(map => { const v = document.querySelector('.game-root')?.__vue__; return v?.map === map && !v.mapLoading && v._villageWater?.map === map && v._villageWater.frames > 1; }, map);
  const lake = await page.evaluate(({map, fixedPoints}) => {
    const v = document.querySelector('.game-root').__vue__, r = new v._villageWater.constructor(), target = document.createElement('canvas');
    target.width = 896; target.height = 640;
    r.draw(target.getContext('2d'), v.mapImage, 200, true, map); const first = r.output.slice(), firstColors = r.frame.data.slice();
    r.draw(target.getContext('2d'), v.mapImage, 600, true, map); let shortChanged = 0, shortDelta = 0;
    for (const i of r.mask.pixels) {
      if (first[i] !== r.output[i]) shortChanged++;
      for (let channel = 0; channel < 3; channel++) shortDelta += Math.abs(firstColors[i*4+channel] - r.frame.data[i*4+channel]);
    }
    const shortMean = shortDelta / (3*r.mask.pixels.length);
    r.draw(target.getContext('2d'), v.mapImage, 2300, true, map); let changed = 0, outside = 0, alpha = 0;
    for (let i = 0; i < first.length; i++) {
      if (first[i] !== r.output[i]) changed++;
      if (!r.mask.interior[i] && r.output[i] !== r.original[i]) outside++;
      if (r.frame.data[i * 4 + 3] !== r.colors[i * 4 + 3]) alpha++;
    }
    const pixels = r.mask.pixels.length;
    // Rocks, bank, roof and foreground trees must never enter the animation mask.
    const fixed = fixedPoints.every(([x,y]) => !r.mask.interior[y*448+x]);
    r.destroy(); return {shortChanged, shortMean, changed, outside, alpha, pixels, fixed, dry: !v.mapWeather?.kind};
  }, {map, fixedPoints: profile.fixed});
  if (map === 'ville1' || map === 'ville3') assert(lake.shortChanged > lake.pixels * .4 && lake.shortMean > 2, 'City water must move visibly within 400 ms');
  assert(lake.changed > 100 && lake.pixels > profile.minimum); assert(lake.fixed && lake.dry); assert.equal(lake.outside, 0); assert.equal(lake.alpha, 0);
  for (const [width,height] of [[320,480],[393,852],[844,390],[1365,900]]) {
    await page.setViewportSize({width,height});
    await page.evaluate(width => { document.querySelector('.game-root').__vue__.showMobileControls = width <= 920; },width);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const scene = await page.evaluate(() => { const v=document.querySelector('.game-root').__vue__,p=v.players[v.socket.id];return {frame:v.worldFrame,player:{x:p.x,y:p.y},mobile:v.showMobileControls}; });
    const camera = getWorldCamera(scene.frame.width,scene.frame.height,scene.player,scene.mobile), [x,y]=profile.point;
    assert(x>=camera.x && x<camera.x+camera.visibleWidth && y>=camera.y && y<camera.y+camera.visibleHeight, `${map}: lake must be visible in the screenshot`);
    await page.screenshot({path: path.join(output,`${profile.slug}-water-${width}.png`)});
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
