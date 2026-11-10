// Real compiled client and persisted equipment requests; disposable SQL account only.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { once } = require('node:events'), { randomUUID, createHash } = require('node:crypto');
assert.equal(process.env.DB_TEST_NAME, 'explorakit_test');
process.env.DB_NAME = 'explorakit_test'; process.env.NODE_ENV = 'test';
const dist = process.env.RELEASE_DIST_DIR, engine = process.env.PRESENTATION_BROWSER || 'chromium';
const out = '/tmp/riftmon-global-corrections-' + engine;
assert(fs.existsSync(dist + '/index.html')); fs.mkdirSync(out, { recursive: true });
const { dbPool: db } = require('../server/config/database');
const users = require('../server/persistence/userRepository'), teams = require('../server/persistence/teamRepository');
const catalog = require('../data/game/items.json').items;
const registry=new Map(),tourHandlers=require('../server/realtime/handlers/superTournamentHandlers'),createHandlers=tourHandlers.createHandlers;
tourHandlers.createHandlers=o=>{const h=createHandlers(o);registry.set(o.userId,{...o,...h});return h;};
const app = require('express')(), server = http.createServer(app), io = new (require('socket.io').Server)(server);
app.use(require('express').json()); app.use('/api', require('../server/http/routes'));
app.use(require('express').static(dist)); app.get('*', (_q, r) => r.sendFile(path.join(dist, 'index.html')));
io.use(require('../server/http/authMiddleware').authenticateSocket); require('../server/realtime/socketHandler')(io);
let browser, page, user, raidId, success = false;
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
  for (const item of catalog.filter(i => i.berryKind || i.key === 'oran_berry' || i.category === 'field'))
    await db.execute('INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,?,3) ON DUPLICATE KEY UPDATE quantity=VALUES(quantity)', [user.id,item.key]);
  browser = await require('playwright')[engine].launch({ headless:true });
  const context = await browser.newContext({ viewport:{ width:1280,height:900 }, hasTouch:true, serviceWorkers:'block' });
  await context.addInitScript(auth => localStorage.setItem('explorakit.user', JSON.stringify(auth)), { ...user, token:require('../server/config/auth').signAccessToken(user) });
  page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:' + server.address().port + '/'); await page.locator('.mode-card.adventure').click(); await ready();
  await page.evaluate(() => {v.bagViewState={activePocket:'field',selectedKey:'repel'};v.handleMenuAction('bag');}); await page.waitForFunction(() => !v.bagLoading);
  assert.equal(await page.locator('[data-bag-pocket="field"]').count(),0);assert.equal(await page.locator('[data-bag-pocket="medicine"]').getAttribute('aria-selected'),'true');assert(await page.locator('[data-item-key="repel"]').isVisible());
  checks.push('No obsolete Objects pocket; healing and Repels share the medicine pocket');
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
  const favorites=catalog.filter(i=>i.mutationBerry).slice(0,18).map(i=>i.key);
  for(const key of favorites){await page.locator('[data-bag-favorite="'+key+'"]').click();await page.waitForFunction(key=>v.bagFavorites.includes(key),key);}
  assert.equal((await require('../server/persistence/bagFavoritesRepository').load(user.id)).keys.length,18);
  assert.equal(await page.locator('.pack-error').count(),0);checks.push('18 real socket favorite updates exceed the former SQL limit and survive reload');
  for(const key of favorites.slice(1)){await page.locator('[data-bag-favorite="'+key+'"]').click();await page.waitForFunction(key=>!v.bagFavorites.includes(key),key);}
  const row = page.locator('[data-item-key="mutant_stat_attack_common_berry"]');
  // This berry is already favorited by the long-list regression above.
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
  checks.push('Held item, favorites and corruption survive reconnect');
  // Use the actual sealed Tour controller and the normal actionResponse socket.
  const factory=require('../server/game/drift/pokemonFactory'),tourTeam={pokemons:[25,9].map(id=>{const p=factory.create(id,100,true);p.passiveAbility=null;p.heldItem=null;p.abilities=['Tackle'];p.movePp=[35];return p;})};
  await teams.editEquipe(user.id,tourTeam);let h=registry.get(user.id);h.getPlayer().equipe=tourTeam;
  const c=h.controller;await c.register(tourTeam);await c.next();await c.atomic(()=>{c.startBattle();const b=c.run.battle,dug=factory.create(51,100,true);dug.passiveAbility='Arena Trap';dug.abilities=['Splash'];dug.movePp=[40];b.b.equipe.pokemons=[dug];b.enter(1);b.pending.set(b.b,{action:'attack',number:0});b.sync();});await c.resume();
  await page.waitForFunction(()=>v.battle&&v.$refs.battleOverlay?.canChooseAction,null,{timeout:45000});await page.locator('.action-pokemon').click();await page.locator('.battle-pokemon-choice').nth(1).click();
  await page.waitForFunction(()=>v.$refs.battleOverlay?.canChooseAction&&v.$refs.battleOverlay.actionState.text.includes('piégé'),null,{timeout:15000});
  const token=c.run.battle.token;assert.equal(c.run.battle.a.equipe.pokemons[0].data.id,25);await shot('trapped-choice-mobile',393,852,'.battle');await shot('trapped-choice-pc',1280,900,'.battle');
  await page.locator('.action-attack').click();await page.locator('.battle-move-choice').first().click();await page.waitForFunction(()=>v.$refs.battleOverlay?.canChooseAction,null,{timeout:30000});assert.notEqual(c.run.battle.token,token);assert.equal(c.run.battle.a.equipe.pokemons[0].movePp[0],34);
  await page.reload();await ready();h=registry.get(user.id);await page.waitForFunction(()=>v.$refs.battleOverlay?.canChooseAction,null,{timeout:45000});const resumed=h.controller,pp=resumed.run.battle.a.equipe.pokemons[0].movePp[0];await page.locator('.action-attack').click();await page.locator('.battle-move-choice').first().click();await page.waitForFunction(()=>v.$refs.battleOverlay?.canChooseAction,null,{timeout:30000});assert.equal(resumed.run.battle.a.equipe.pokemons[0].movePp[0],pp-1);await resumed.abandon();
  await page.waitForFunction(()=>!v.battle||v.battleResult,null,{timeout:15000});await page.evaluate(()=>{if(v.battleResult)v.dismissBattleResult();});await page.waitForFunction(()=>!v.battle&&!v.battleResult);
  checks.push('Real Tour: Arena Trap rejection unlocks the same choice; attack succeeds and first action after browser reconnect works');
  const boss=factory.create(150,1000,true),m={id:user.id,name:user.username,team:await teams.loadEquipe(user.id),selected:[],ready:true},run={id:randomUUID(),version:0,phase:'won',won:true,rift:{map:'DC2_04',difficulty:'dc2-final',fixed:true,anchor:'dark2:final',bossSpecies:150},members:[m],combat:{boss,models:m.team.pokemons.map(pokemon=>({ownerId:m.id,pokemon,initialHeld:pokemon.heldItem}))}};
  raidId=run.id;await require('../server/persistence/raidRepository').save(run,{settle:true,random:()=>0});const reward=m.reward;
  await page.evaluate(({reward,id})=>{v.raidState={id,phase:'won',won:true,rift:{name:'Faille finale',level:1000,map:'DC2_04',difficulty:{id:'dc2-final'},reward:{}},members:[],reward};v.raidPanelVisible=true;},{reward,id:run.id});
  await page.locator('[data-raid-pokemon-prize]').waitFor();assert.match(await page.locator('[data-raid-pokemon-prize]').innerText(),/Mewtwo/);assert.match(await page.locator('[data-raid-pokemon-prize]').innerText(),/1000.*K4.*Non corrompu/);assert.match(await page.locator('[data-raid-pokemon-prize]').innerText(),/SHINY/);
  for(const[w,ht]of[[320,568],[393,852],[844,390],[1280,900]])await shot('raid-reward-'+w,w,ht,'.raid-panel');
  assert.equal((await require('../server/persistence/pokemonStorageRepository').loadEntries(user.id)).filter(e=>e.pokemon.uuid===reward.pokemon.uuid).length,1);checks.push('Native SQL legendary reward renders K4/normal/shiny/PC destination on four viewport sizes');
  assert.deepEqual(errors,[]); success = true;
} catch (error) { console.error(error); await page?.screenshot({ path:out + '/failure.png' }).catch(() => {}); process.exitCode = 1;
} finally {
  await browser?.close(); require('../server/realtime/housing').getHousingManager(io).stop();
  await require('../server/realtime/casinoSlots').getSlotsManager(io).stop(); await require('../server/realtime/raidManager').getRaidManager(io).stop();
  await require('../server/realtime/draftManager').getDraftManager(io).stop(); require('../server/realtime/whitepeakClub').getClub(io).close();
  await new Promise(resolve => io.close(resolve)); await require('../server/realtime/accountConnection').waitForAccountConnections(io);
  if (raidId)await db.execute('DELETE FROM corruption_raids WHERE id=?',[raidId]);
  if (user) await db.execute('DELETE FROM users WHERE id=?',[user.id]); await db.end();
  const report = { success,engine,checks,views,errors,buildIndexSha256:createHash('sha256').update(fs.readFileSync(dist+'/index.html')).digest('hex'),scope:'Compiled client, real HTTP/Socket/MySQL, disposable corrupted Pokémon only. WebKit is not a physical iPhone test.' };
  fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2)); console.log(JSON.stringify(report));
} })();
