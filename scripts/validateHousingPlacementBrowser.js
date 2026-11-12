// Authenticated compiled client + disposable explorakit_test account. No live writes.
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  http = require('node:http'),
  {
    once
  } = require('node:events'),
  {
    randomUUID,
    createHash
  } = require('node:crypto');
assert.equal(process.env.DB_TEST_NAME, 'explorakit_test');
process.env.DB_NAME = 'explorakit_test';
process.env.NODE_ENV = 'test';
const dist = process.env.RELEASE_DIST_DIR,
  engine = process.env.PRESENTATION_BROWSER || 'chromium',
  legacyMode = process.env.EXPECT_LEGACY_BLOCKED === '1',
  out = '/tmp/riftmon-housing-placement-' + (legacyMode ? 'legacy-' : '') + engine;
assert(fs.existsSync(dist + '/index.html'));
fs.mkdirSync(out, {
  recursive: true
});
const {
    dbPool: db
  } = require('../server/config/database'),
  users = require('../server/persistence/userRepository'),
  repo = require('../server/persistence/housingRepository'),
  rules = require('../server/game/housing/rules'),
  entries = require('../server/game/housing/entries');
const app = require('express')(),
  server = http.createServer(app),
  io = new (require('socket.io').Server)(server);
app.use(require('express').json());
app.use('/api', require('../server/http/routes'));
app.use(require('express').static(dist));
app.get('*', (_q, r) => r.sendFile(path.join(dist, 'index.html')));
io.use(require('../server/http/authMiddleware').authenticateSocket);
require('../server/realtime/socketHandler')(io);
const manager = require('../server/realtime/housing').getHousingManager(io),
  errors = [],
  checks = [],
  views = [];
let user,
  browser,
  page,
  success = false;
const request = (h, p) => ({
  ...p,
  revision: h.revision,
  requestId: randomUUID()
});
async function ready() {
  await page.waitForFunction(() => {
    const v = document.querySelector('.game-root')?.__vue__;
    if (v?.socket?.connected && !v.mapLoading && v.players[v.socket.id] && v.housingState) {
      window.v = v;
      return true;
    }
    return false;
  });
}
async function cell(x, y) {
  return page.locator('[data-housing-editor] .house-grid-viewport canvas').evaluate((el, {
    x,
    y
  }) => {
    const e = el.closest('[data-housing-editor]').__vue__,
      r = el.getBoundingClientRect();
    return {
      x: r.left + (x - e.bounds.x + .5) / e.bounds.w * r.width,
      y: r.top + (y - e.bounds.y + .5) / e.bounds.h * r.height
    };
  }, {
    x,
    y
  });
}
async function place(key, x, y, touch, expectedError = '') {
  await page.getByRole('button', {
    name: /Meubles.*\/ 20/
  }).click();
  const stock = page.locator('.house-stock button').filter({
    has: page.getByText(rules.items.get(key).name, {
      exact: true
    })
  });
  await stock.click();
  await page.waitForTimeout(180);
  const p = await cell(x, y);
  if (touch) await page.touchscreen.tap(p.x, p.y);else await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(120);
  const result = await page.locator('[data-housing-editor]').evaluate(el => ({
    draft: el.__vue__.draft,
    tool: el.__vue__.tool,
    error: el.__vue__.previewError,
    ready: el.__vue__.ready,
    view: el.__vue__.view,
    preview: el.__vue__.preview
  }));
  if (expectedError) {
    assert.equal(result.error, expectedError);
    checks.push('legacy client reproduced: ' + result.error);
    return result;
  }
  assert.equal(result.error, '', JSON.stringify(result));
  assert(result.draft.placements.some(p => p.key === key && p.x === x && p.y === y), JSON.stringify(result));
  checks.push(`${touch ? 'touch' : 'mouse'} placed ${key} at ${x},${y}`);
  return result;
}
async function save() {
  await page.getByRole('button', {
    name: /Sauvegarder/
  }).click();
  await page.waitForFunction(() => !v.housingBusy);
  assert.equal(await page.evaluate(() => v.housingError), '');
  await page.waitForTimeout(80);
}
async function saveFailure(mode) {
  const before = await repo.read(user.id);
  await page.evaluate(mode => {
    const socket = v.socket,
      original = socket.emit;
    window.houseSaveProbe = {
      mode,
      requests: []
    };
    socket.emit = function (name, data, callback) {
      if (name !== 'housing:save') return original.apply(this, arguments);
      const probe = window.houseSaveProbe;
      probe.requests.push(JSON.parse(JSON.stringify(data)));
      if (probe.requests.length === 1) {
        if (mode === 'rejected') {
          const invalid = JSON.parse(JSON.stringify(data));
          invalid.layout.placements[0].x = -1;
          return original.call(this, name, invalid, callback);
        }
        return original.call(this, name, data, (_error, _reply) => callback(Error('Simulated lost acknowledgement')));
      }
      return original.apply(this, arguments);
    };
    window.restoreHouseSave = () => {
      socket.emit = original;
    };
  }, mode);
  await page.getByRole('button', {
    name: /Sauvegarder/
  }).click();
  await page.waitForFunction(() => !v.housingBusy && !!v.housingError);
  const state = await page.locator('.housing-backdrop').evaluate(el => ({
    pending: el.__vue__.pending,
    dirty: el.__vue__.dirty,
    locked: el.__vue__.$refs.editor.locked
  }));
  assert(state.dirty);
  assert.equal(state.locked, mode !== 'rejected');
  assert.equal(!!state.pending, mode !== 'rejected');
  if (mode === 'rejected') {
    assert.equal((await repo.read(user.id)).revision, before.revision);
    await save();
  } else {
    assert.equal((await repo.read(user.id)).revision, before.revision + 1);
    await page.getByRole('button', {
      name: 'Vérifier la confirmation'
    }).click();
    await page.waitForFunction(() => !v.housingBusy);
    assert.equal(await page.evaluate(() => v.housingError), '');
  }
  const probe = await page.evaluate(() => window.houseSaveProbe);
  assert.equal(probe.requests.length, 2);
  assert.equal(probe.requests[0].requestId === probe.requests[1].requestId, mode !== 'rejected');
  const after = await repo.read(user.id);
  assert.equal(after.revision, before.revision + 1);
  assert.deepEqual(after.inventory, before.inventory);
  await page.evaluate(() => window.restoreHouseSave());
  checks.push(mode === 'rejected' ? 'definitive rejection keeps draft editable; corrected save succeeds' : 'lost acknowledgement retries the same UUID; exactly one saved revision, no duplicate');
}
(async () => {
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    user = await users.createUserWithStarter('PlacementUI_' + randomUUID().slice(0, 8), randomUUID());
    await db.execute('UPDATE users SET money=30000000 WHERE id=?', [user.id]);
    for (const [k, val] of Object.entries({
      adventure_opening: 'complete',
      early_game_tutorial: JSON.stringify({
        version: 1,
        phase: 'complete',
        metWayne: true
      })
    })) await db.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)', [user.id, k, val]);
    await require('../server/persistence/patchNotesRepository').acknowledge(user.id, require('../data/game/latest_patch.json').version);
    let h = await repo.read(user.id);
    h = (await repo.purchase(user.id, request(h, {
      model: 'salon',
      entryKey: entries.entries[0].key
    }))).home;
    h = (await repo.addFloor(user.id, request(h, {
      model: 'nid'
    }))).home;
    for (const [key, n] of [['rotom_washer', 1], ['desk', 2], ['berry_pot', 3], ['cushions', 2], ['berry_planter', 19]]) h = (await repo.furniture(user.id, request(h, {
      key,
      quantity: n
    }))).home;
    // Reproduce the populated small upper room reported by the player, with fresh IDs.
    const f = structuredClone(h.floors[1]);
    f.placements = [...Array.from({
      length: 7
    }, (_, i) => ({
      id: randomUUID(),
      key: 'berry_planter',
      x: 16,
      y: 9 + i,
      rotation: 0
    })), ...Array.from({
      length: 3
    }, (_, i) => ({
      id: randomUUID(),
      key: 'berry_planter',
      x: 9,
      y: 13 + i,
      rotation: 0
    }))];
    if (legacyMode) f.placements.pop();
    h = (await repo.saveFloor(user.id, request(h, {
      floor: 1,
      layout: f
    }))).home;
    await repo.enter(user.id, user.id, 1, entries.outside(entries.entries[0]));
    browser = await require('playwright')[engine].launch({
      headless: true
    });
    const context = await browser.newContext({
      viewport: {
        width: 1365,
        height: 900
      },
      hasTouch: true,
      serviceWorkers: 'block'
    });
    await context.addInitScript(auth => {
      if (location.protocol.startsWith('http')) localStorage.setItem('explorakit.user', JSON.stringify(auth));
    }, {
      ...user,
      token: require('../server/config/auth').signAccessToken(user)
    });
    page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://127.0.0.1:' + server.address().port + '/');
    await page.locator('.mode-card.adventure').click();
    await ready();
    await page.evaluate(() => v.updatePreferences({
      ...v.preferences,
      masterVolume: 0
    }));
    await page.locator('[data-housing-manage]').click();
    await page.locator('[data-housing-editor]').waitFor();
    if (legacyMode) {
      assert.match(await page.evaluate(() => v.housingNotice), /actualise le jeu/);
      await place('rotom_washer', 12, 10, false, 'Garde les murs, la porte et les autres éléments dégagés.');
      await page.screenshot({
        path: out + '/legacy-block.png'
      });
      success = true;
      return;
    }
    assert.equal(await page.evaluate(() => v.housingNotice), '');
    await place('rotom_washer', 12, 10, false);
    await saveFailure('rejected');
    await page.screenshot({
      path: out + '/placed-pc.png'
    });
    views.push('placed-pc');
    await place('berry_pot', 12, 11, false);
    await saveFailure('timeout');
    await page.setViewportSize({
      width: 393,
      height: 852
    });
    await place('desk', 12, 12, true);
    await save();
    await page.screenshot({
      path: out + '/placed-mobile.png'
    });
    views.push('placed-mobile');
    await page.reload();
    await ready();
    const saved = await repo.read(user.id);
    for (const key of ['rotom_washer', 'berry_pot', 'desk']) assert(saved.floors[1].placements.some(p => p.key === key));
    checks.push('layout saved and survives reconnect');
    assert.deepEqual(errors, []);
    success = true;
  } catch (e) {
    console.error(e.stack);
    if (page) await page.screenshot({
      path: out + '/failure.png'
    }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser?.close();
    manager.stop();
    await require('../server/realtime/casinoSlots').getSlotsManager(io).stop();
    await require('../server/realtime/raidManager').getRaidManager(io).stop();
    await require('../server/realtime/draftManager').getDraftManager(io).stop();
    require('../server/realtime/whitepeakClub').getClub(io).close();
    await new Promise(r => io.close(r));
    await require('../server/realtime/accountConnection').waitForAccountConnections(io);
    if (user) await db.execute('DELETE FROM users WHERE id=?', [user.id]);
    await db.end();
    const report = {
      success,
      engine,
      checks,
      views,
      errors,
      buildIndexSha256: createHash('sha256').update(fs.readFileSync(dist + '/index.html')).digest('hex')
    };
    fs.writeFileSync(out + '/report.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  }
})();
