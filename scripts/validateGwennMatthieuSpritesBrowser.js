// Dedicated test DB + disposable player. Verify the real server/client appearance bridge.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { once } = require('node:events'), { randomUUID } = require('node:crypto');
if (!/test/i.test(process.env.DB_TEST_NAME || '')) throw Error('Dedicated test database required');
process.env.DB_NAME = process.env.DB_TEST_NAME; process.env.NODE_ENV = 'test';
const express = require('express'), { Server } = require('socket.io'), { chromium } = require('playwright');
const { dbPool: db } = require('../server/config/database');
const dist = process.env.RELEASE_DIST_DIR || '/tmp/riftmon-gwenn-matthieu-sprites-dist';
const out = process.env.RELEASE_SCREENSHOTS || '/tmp/riftmon-gwenn-matthieu-browser';
fs.mkdirSync(out, { recursive: true });
const app = express(), server = http.createServer(app), io = new Server(server);
app.use(express.json()); app.use('/api', require('../server/http/routes')); app.use(express.static(dist));
app.get('*', (_q, r) => r.sendFile(path.join(dist, 'index.html')));
io.use(require('../server/http/authMiddleware').authenticateSocket); require('../server/realtime/socketHandler')(io);
let browser, page, userId, passed = false;
const errors = [], results = [];
async function ready() {
  await page.waitForFunction(() => {
    const v = document.querySelector('.game-root')?.__vue__;
    if (!v?.socket?.connected || !v.players[v.socket.id] || v.mapLoading || v.renderedMap !== v.map) return false;
    window.v = v; return true;
  });
}
(async () => {
  try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(base + '/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'npc_art_' + randomUUID(), password: randomUUID(), starterId: 7 }) });
    assert.equal(response.status, 201); const user = await response.json(); userId = user.user.id;
    await db.execute("UPDATE users SET map='route4_maison',x=?,y=? WHERE id=?", [13 * 32 + 16, 10 * 32 + 16, userId]);
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true });
    await context.addInitScript(s => {
      if (location.protocol.startsWith('http')) localStorage.setItem('explorakit.user', JSON.stringify(s));
    }, { ...user.user, token: user.token });
    page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    page.on('response', r => { if (r.url().startsWith(base) && r.status() >= 400) errors.push(r.status() + ' ' + r.url()); });
    await page.goto(base + '/game', { waitUntil: 'networkidle' }); await ready();
    const actors = [
      { name: 'gwenn_rochebrume', label: 'gwenn', map: 'route4_maison', x: 13, y: 10, direction: 'move_z', sprite: 'gwenn-pixel-v3.png', portrait: 'gwenn-v1', width: 20, height: 26 },
      { name: 'gwenn_route8', label: 'matthieu', map: 'gen_route8', x: 22, y: 17, direction: 'move_d', sprite: 'matthieu-pixel-v1.png', portrait: 'matthieu-v1', width: 21, height: 25 }
    ];
    for (const [index, actor] of actors.entries()) {
      if (index) {
        const saved = await page.evaluate(() => new Promise(r => v.socket.emit('requestGameSave', r))); assert(saved.success);
        await page.evaluate(() => v.socket.disconnect()); await page.waitForTimeout(200);
        await db.execute('UPDATE users SET map=?,x=?,y=? WHERE id=?', [actor.map, actor.x * 32 + 16, actor.y * 32 + 16, userId]);
        await page.reload({ waitUntil: 'networkidle' }); await ready();
      }
      assert.equal(await page.evaluate(() => v.map), actor.map);
      const drawing = await page.evaluate(async actor => {
        const npc = v.pnjs.find(n => n.name === actor.name); if (!npc || npc.sprite !== actor.sprite) throw Error('Wrong appearance');
        const image = v.ensurePnjSpriteSheet(npc.sprite); await image.decode();
        if (image.naturalWidth !== 32 || image.naturalHeight !== 32) throw Error('Wrong native cell');
        const c = document.createElement('canvas'); c.width = c.height = 1024; const g = c.getContext('2d');
        const calls = [], original = g.drawImage, previous = v.pnjs;
        g.drawImage = function (img, ...args) { if (img === image) calls.push({ args, smoothing: this.imageSmoothingEnabled }); return original.call(this, img, ...args); };
        try { v.pnjs = [npc]; v.drawPnjs(g); } finally { v.pnjs = previous; }
        if (calls.length !== 1) throw Error('Unexpected draw count');
        const a = calls[0].args;
        if (JSON.stringify(a.slice(0, 4)) !== '[0,0,32,32]' || a[6] !== 64 || a[7] !== 64 || calls[0].smoothing) throw Error('Blurred/incorrect scaling');
        if (a[5] + a[7] !== npc.y * 32 + 26) throw Error('Feet anchor changed');
        g.clearRect(0, 0, c.width, c.height); g.drawImage(image, 0, 0);
        const pixels = g.getImageData(0, 0, 32, 32).data, colors = new Set();
        let left = 32, top = 32, right = 0, bottom = 0, whites = 0, reds = 0;
        for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
          const i = (y * 32 + x) * 4, alpha = pixels[i + 3];
          if (alpha !== 0 && alpha !== 255) throw Error('Soft alpha edge'); if (!alpha) continue;
          colors.add([...pixels.slice(i, i + 3)].join(',')); left = Math.min(left, x); top = Math.min(top, y);
          right = Math.max(right, x); bottom = Math.max(bottom, y);
          if (y >= 17 && pixels[i] > 200 && pixels[i + 1] < 120) reds++;
          if (y >= 17 && pixels[i] > 230 && pixels[i + 1] > 220 && pixels[i + 2] > 220) whites++;
        }
        if (right - left + 1 !== actor.width || bottom - top + 1 !== actor.height || bottom !== 31 || colors.size > 12 || !reds || !whites) throw Error('Native art contract failed');
        return { source: a.slice(0, 4), scale: 2, feetY: a[5] + a[7], colors: colors.size, ballRedPixels: reds, ballWhitePixels: whites, bounds: [left, top, right - left + 1, bottom - top + 1] };
      }, actor);
      for (const [width, height] of [[320, 568], [393, 852], [844, 390], [1365, 900]]) {
        await page.setViewportSize({ width, height });
        await page.evaluate(async width => { v.showMobileControls = width <= 920; await v.$nextTick(); v.resizeWorldViewport(); }, width);
        await page.waitForTimeout(200); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        await page.screenshot({ path: path.join(out, `${actor.label}-${width}.png`) });
      }
      const before = await page.evaluate(() => ({ x: v.players[v.socket.id].x, y: v.players[v.socket.id].y }));
      await page.evaluate(direction => v.socket.emit('playerAction', direction), actor.direction); await page.waitForTimeout(350);
      assert.deepEqual(await page.evaluate(() => ({ x: v.players[v.socket.id].x, y: v.players[v.socket.id].y })), before, 'NPC remains solid');
      await page.evaluate(() => v.socket.emit('Space'));
      await page.waitForFunction(name => v.endSentences?.startsWith(name) && v.textImageSequence.length, actor.name);
      const portrait = await page.evaluate(() => ({ src: v.textImageSequence[0].image, frame: v.textImageSequence[0].portraitFrame }));
      assert(portrait.src.includes(actor.portrait + '.')); assert.equal(portrait.frame ?? null, null);
      await page.locator('.dialogue-layer .text').click(); await page.waitForTimeout(100);
      await page.screenshot({ path: path.join(out, `${actor.label}-dialogue.png`) });
      for (let i = 0; i < 8 && await page.locator('.dialogue-layer .text').count(); i++) {
        await page.locator('.dialogue-layer .text').click(); await page.waitForTimeout(100);
      }
      results.push({ name: actor.name, ...drawing, solid: true, illustratedPortrait: true, viewports: 4 });
    }
    assert.deepEqual(errors, []); passed = true; console.log(JSON.stringify({ results, errors, out }));
  } finally {
    if (!passed && page && !page.isClosed()) {
      await page.screenshot({ path: path.join(out, 'failure.png'), fullPage: true }).catch(() => {});
      console.error(await page.evaluate(() => ({ map: window.v?.map, speech: window.v?.endSentences, text: document.body.innerText.slice(-700) })).catch(() => null));
    }
    await browser?.close(); await new Promise(r => io.close(r)); await new Promise(r => setTimeout(r, 200));
    if (userId) await db.execute('DELETE FROM users WHERE id=?', [userId]); await db.end();
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
