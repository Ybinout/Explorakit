// Real compiled client and persisted equipment requests; disposable SQL account only.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { once } = require('node:events'), { randomUUID, createHash } = require('node:crypto');
assert.equal(process.env.DB_TEST_NAME, 'explorakit_test');
process.env.DB_NAME = 'explorakit_test'; process.env.NODE_ENV = 'test';
const dist = process.env.RELEASE_DIST_DIR, engine = process.env.PRESENTATION_BROWSER || 'chromium';
const out = '/tmp/riftmon-berry-pocket-' + engine;
assert(fs.existsSync(dist + '/index.html')); fs.mkdirSync(out, { recursive: true });
const { dbPool: db } = require('../server/config/database');
const users = require('../server/persistence/userRepository'), teams = require('../server/persistence/teamRepository');
const catalog = require('../data/game/items.json').items;
const app = require('express')(), server = http.createServer(app), io = new (require('socket.io').Server)(server);
app.use(require('express').json()); app.use('/api', require('../server/http/routes'));
app.use(require('express').static(dist)); app.get('*', (_q, r) => r.sendFile(path.join(dist, 'index.html')));
io.use(require('../server/http/authMiddleware').authenticateSocket); require('../server/realtime/socketHandler')(io);
let browser, page, user, success = false;
const checks = [], views = [], errors = [];
async function ready() {
  await page.waitForFunction(() => {
    const v = document.querySelector('.game-root')?.__vue__;
    if (v?.socket?.connected && !v.mapLoading && v.players[v.socket.id] && v.teamPokemons.length) { window.v = v; return true; }
    return false;
  });
  await page.evaluate(() => v.updatePreferences({ ...v.preferences, masterVolume: 0 }));
}
async function shot(name, width, height, selector = '.bag-panel') {
  await page.setViewportSize({ width, height }); await page.waitForTimeout(400);
  const bounds = await page.locator(selector).evaluate(el => {
    const r = el.getBoundingClientRect(); return { x:r.x, y:r.y, right:r.right, bottom:r.bottom, width:document.documentElement.scrollWidth };
  });
  assert(bounds.x >= -1 && bounds.y >= -1 && bounds.right <= width+1 && bounds.bottom <= height+1 && bounds.width <= width+1, name + JSON.stringify(bounds));
  await page.screenshot({ path: path.join(out, name + '.png') }); views.push({ name, width, height, ...bounds });
}
(async () => { try {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  user = await users.createUserWithStarter('BerryBag_' + randomUUID().slice(0, 8), randomUUID());
  for (const [key, value] of Object.entries({ adventure_opening:'complete', early_game_tutorial:JSON.stringify({ version:1, phase:'complete', metWayne:true }) }))
    await db.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)', [user.id,key,value]);
  await require('../server/persistence/patchNotesRepository').acknowledge(user.id, require('../data/game/latest_patch.json').version);
  const team = await teams.loadEquipe(user.id); team.pokemons[0].corruption = { version:1, revision:1, permanent:true, modules:{} };
  await teams.editEquipe(user.id, team); const uuid = team.pokemons[0].uuid;
  for (const item of catalog.filter(i => i.berryKind || i.key === 'oran_berry'))
    await db.execute('INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,?,3) ON DUPLICATE KEY UPDATE quantity=VALUES(quantity)', [user.id,item.key]);
  browser = await require('playwright')[engine].launch({ headless:true });
  const context = await browser.newContext({ viewport:{ width:1280,height:900 }, hasTouch:true, serviceWorkers:'block' });
  await context.addInitScript(auth => localStorage.setItem('explorakit.user', JSON.stringify(auth)), { ...user, token:require('../server/config/auth').signAccessToken(user) });
  page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:' + server.address().port + '/'); await page.locator('.mode-card.adventure').click(); await ready();
  await page.evaluate(() => v.handleMenuAction('bag')); await page.waitForFunction(() => !v.bagLoading);
  await page.locator('[data-bag-pocket="berries"]').click();
  assert(await page.locator('[data-item-key="oran_berry"]').isVisible());
  assert.equal(await page.locator('[data-item-key="corrupted_oran_berry"]').count(), 0);
  checks.push('Classic berries remain in their own pocket without new ingredients or mutations');
  await page.locator('[data-bag-pocket="corrupted_berries"]').click();
  const expected = catalog.filter(i => i.berryKind).length;
  assert.equal(await page.locator('.bag-item-row').count(), expected);
  assert.equal(await page.locator('[data-item-key="oran_berry"]').count(), 0);
  const ingredient = page.locator('[data-item-key="corrupted_oran_berry"]');
  await ingredient.locator('.bag-item-select').click();
  assert.equal(await ingredient.locator('[data-bag-give-held]').count(), 0);
  checks.push('All new berries have one dedicated pocket; ingredients remain crafting-only');
  const row = page.locator('[data-item-key="mutant_stat_attack_common_berry"]');
  await row.locator('[data-bag-favorite]').click();
  await page.waitForFunction(() => v.bagFavorites.includes('mutant_stat_attack_common_berry'));
  assert.equal(await page.locator('.bag-item-row').first().getAttribute('data-item-key'), 'mutant_stat_attack_common_berry');
  await row.locator('.bag-item-select').click();
  for (const [w,h] of [[1280,900],[393,852],[320,568],[844,390]]) await shot('bag-' + w,w,h);
  await page.setViewportSize({ width:393,height:852 }); await page.waitForTimeout(350);
  await row.locator('[data-bag-held-target]').selectOption(uuid);
  await row.locator('[data-bag-give-held]').click();
  await page.waitForFunction(uuid => !v.teamSaving && v.teamPokemons.some(p => p.uuid === uuid && p.heldItem === 'mutant_stat_attack_common_berry'), uuid);
  assert.equal((await teams.loadEquipe(user.id)).pokemons[0].heldItem, 'mutant_stat_attack_common_berry');
  const [[stock]] = await db.execute('SELECT quantity FROM user_items WHERE user_id=? AND item_key=?', [user.id,'mutant_stat_attack_common_berry']);
  assert.equal(Number(stock.quantity), 2);
  checks.push('A corrupted Pokémon can equip a final Mutator berry from the bag with one authoritative debit');
  await page.locator('.bag-panel .panel-close').click(); await page.evaluate(() => v.handleMenuAction('bag'));
  await page.waitForFunction(() => !v.bagLoading);
  assert.equal(await page.locator('[data-bag-pocket="corrupted_berries"]').getAttribute('aria-selected'), 'true');
  await page.locator('.bag-panel .panel-close').click();
  await page.evaluate(() => v.openHeldPicker(v.teamPokemons[0])); await page.locator('.held-picker').waitFor();
  await page.locator('.held-filters').getByRole('button', { name:'Baies',exact:true }).click();
  assert.equal(await page.locator('[data-held-choice="corrupted_oran_berry"]').count(), 0);
  await page.locator('[data-held-choice="mutant_stat_attack_rare_berry"]').click();
  await shot('picker-mobile',393,852,'.held-picker'); await shot('picker-desktop',1280,900,'.held-picker');
  await page.locator('[data-held-confirm]').click();
  await page.waitForFunction(() => !v.heldPickerUuid && !v.teamSaving);
  const equipped = (await teams.loadEquipe(user.id)).pokemons[0]; assert.equal(equipped.heldItem,'mutant_stat_attack_rare_berry');
  const [[returned]] = await db.execute('SELECT quantity FROM user_items WHERE user_id=? AND item_key=?', [user.id,'mutant_stat_attack_common_berry']); assert.equal(Number(returned.quantity),3);
  checks.push('The team held-item picker also accepts final berries on a corrupted Pokémon and returns the replaced item exactly once');
  await page.reload(); await ready();
  assert.equal(await page.evaluate(() => v.teamPokemons[0].heldItem),'mutant_stat_attack_rare_berry');
  assert.deepEqual(errors,[]); checks.push('Held item and corruption survive reconnect; no client errors or viewport overflow'); success = true;
} catch (error) { console.error(error); await page?.screenshot({ path:out + '/failure.png' }).catch(() => {}); process.exitCode = 1;
} finally {
  await browser?.close(); require('../server/realtime/housing').getHousingManager(io).stop();
  await require('../server/realtime/casinoSlots').getSlotsManager(io).stop(); await require('../server/realtime/raidManager').getRaidManager(io).stop();
  await require('../server/realtime/draftManager').getDraftManager(io).stop(); require('../server/realtime/whitepeakClub').getClub(io).close();
  await new Promise(resolve => io.close(resolve)); await require('../server/realtime/accountConnection').waitForAccountConnections(io);
  if (user) await db.execute('DELETE FROM users WHERE id=?',[user.id]); await db.end();
  const report = { success,engine,checks,views,errors,buildIndexSha256:createHash('sha256').update(fs.readFileSync(dist+'/index.html')).digest('hex'),scope:'Compiled client, real HTTP/Socket/MySQL, disposable corrupted Pokémon only. WebKit is not a physical iPhone test.' };
  fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2)); console.log(JSON.stringify(report));
} })();
