// Actual Canvas rendering: the windows may move, the room and island may not.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const express = require('express'), playwright = require('playwright');
const engine = process.env.SKY_BROWSER || 'chromium';
const out = process.env.RELEASE_SCREENSHOTS || '/tmp/riftmon-tournament-sky-' + engine;
fs.mkdirSync(out, { recursive: true });
(async () => {
  const app = express();
  app.use(express.static(path.resolve(__dirname, '../vue-explorakit/src')));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  let browser;
  try {
    browser = await playwright[engine].launch({ headless: true, ...(engine === 'chromium' ? { args: ['--no-sandbox'] } : {}) });
    const page = await browser.newPage({ viewport: { width: 896, height: 640 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/services/tournamentLobbySky.js`);
    await page.evaluate(async () => {
      document.body.innerHTML = '<canvas width="896" height="640"></canvas>';
      document.body.style = 'margin:0;background:#0d1722;overflow:hidden';
      window.skyModule = await import('/services/tournamentLobbySky.js');
      window.ambienceModule = await import('/services/placeAmbience.js');
      window.r = new skyModule.TournamentLobbySkyRenderer();
      window.source = new Image(); source.src = '/assets/super_tournament_lobby.png'; await source.decode();
      window.c = document.querySelector('canvas').getContext('2d'); c.imageSmoothingEnabled = false;
      window.render = (time, motion = true) => { c.drawImage(source, 0, 0, 896, 640); r.draw(c, source, time, motion); };
    });
    const checks = await page.evaluate(() => {
      render(0, false); const original = c.getImageData(0, 0, 896, 640).data;
      render(0); const mask = r.mask.getContext('2d').getImageData(0, 0, r.mask.width, r.mask.height).data;
      let escaped = 0, birds = 0, birdFrames = 0, changed = 0;
      const differentFrames = new Set();
      for (let n = 0; n < 64; n++) {
        render(n * 500);
        const effect = r.context.getImageData(0, 0, r.canvas.width, r.canvas.height).data;
        let visibleBirds = 0;
        for (let i = 0; i < effect.length; i += 4) {
          if (effect[i + 3] && !mask[i + 3]) escaped++;
          if (effect[i + 3] && effect[i] < 100 && effect[i + 1] < 130) visibleBirds++;
        }
        if (visibleBirds) birdFrames++; birds += visibleBirds;
        differentFrames.add(r.canvas.toDataURL());
      }
      render(35000); const final = c.getImageData(0, 0, 896, 640).data;
      let roomChanged = 0;
      for (let y = 0; y < 640; y++) for (let x = 0; x < 896; x++) {
        const i = (y * 896 + x) * 4;
        const masked = x >= 150 && x < 150 + r.mask.width && y >= 40 && y < 40 + r.mask.height
          && mask[((y - 40) * r.mask.width + x - 150) * 4 + 3];
        if (final[i] !== original[i] || final[i + 1] !== original[i + 1] || final[i + 2] !== original[i + 2]) {
          changed++; if (!masked) roomChanged++;
        }
      }
      const frames = r.frames; render(35001); const throttled = r.frames === frames;
      render(37000, false); const reduced = c.getImageData(0, 0, 896, 640).data.every((v, i) => v === original[i]);
      render(38000); const old = [r.canvas, r.mask, ...r.cloudTextures], skyPixels = r.skyPixels;
      const cloudPixels = r.cloudTextures.map(texture => {
        const data = texture.getContext('2d').getImageData(0, 0, texture.width, texture.height).data;
        let count = 0; for (let i = 3; i < data.length; i += 4) if (data[i]) count++;
        return count;
      });
      const started = performance.now(); for (let n = 0; n < 180; n++) r.paint(n * 50);
      const averagePaintMs = (performance.now() - started) / 180;
      r.suspend(); const released = old.every(surface => surface.width === 0 && surface.height === 0) && !r.canvas;
      const shared = new ambienceModule.PlaceAmbienceRenderer();
      shared.drawGround(c, source, skyModule.TOURNAMENT_LOBBY_MAP, 2000);
      const surface = shared.tournamentLobby.canvas;
      shared.draw(c, source, skyModule.TOURNAMENT_LOBBY_MAP, 2000);
      const integrated = shared.tournamentLobby.canvas === surface && Boolean(ambienceModule.placeAmbienceProfile(skyModule.TOURNAMENT_LOBBY_MAP));
      shared.drawGround(c, source, 'super_tournament_sas', 3000);
      const isolated = surface.width === 0 && !shared.tournamentLobby.canvas;
      shared.destroy();
      return { skyPixels, cloudPixels, changed, escaped, roomChanged, birds, birdFrames, differentFrames: differentFrames.size, throttled, reduced, released, integrated, isolated, averagePaintMs };
    });
    fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify(checks, null, 2));
    for (const time of [0, 4000, 9000, 18000]) {
      await page.evaluate(time => render(time), time);
      await page.screenshot({ path: path.join(out, `lobby-${time}.png`) });
    }
    assert(checks.skyPixels > 1000); assert(checks.changed > 1000);
    assert(checks.cloudPixels.every(count => count > 30));
    assert.equal(checks.escaped, 0); assert.equal(checks.roomChanged, 0);
    assert(checks.birds > 100); assert(checks.birdFrames > 40); assert.equal(checks.differentFrames, 64);
    for (const key of ['throttled', 'reduced', 'released', 'integrated', 'isolated']) assert(checks[key], key);
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ success: true, engine, checks, errors }, null, 2));
    console.log(JSON.stringify({ engine, ...checks, errors }));
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
