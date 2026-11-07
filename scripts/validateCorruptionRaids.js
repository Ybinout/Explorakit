// Disposable accounts and local server only. Never run against a production DB.
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  http = require('node:http'),
  path = require('node:path'),
  {
    once
  } = require('node:events'),
  {
    randomUUID,createHash
  } = require('node:crypto');
if (process.env.DB_TEST_NAME !== 'explorakit_test') throw Error('Dedicated test database required');
process.env.DB_NAME = 'explorakit_test';
process.env.NODE_ENV = 'test';
process.env.BATTLE_DELAY_SCALE = '0';
const {
    dbPool: db
  } = require('../server/config/database'),
  teams = require('../server/persistence/teamRepository'),
  repo = require('../server/persistence/raidRepository'),
  {
    RaidBattle
  } = require('../server/game/raids/RaidBattle'),
  {
    bossFor
  } = require('../server/game/raids/content'),
  {
    make
  } = require('./calibrateCorruptionRaids');
const dist = process.env.RELEASE_DIST_DIR || '/tmp/riftmon-raids-dist',
  out = process.env.RELEASE_SCREENSHOTS || '/tmp/riftmon-raids-browser';
fs.mkdirSync(out, {
  recursive: true
});
const darkHandlers = require('../server/realtime/handlers/darkBattleHandlers'),
  realDarkCreate = darkHandlers.createHandlers,
  darkRegistry = new Map();
darkHandlers.createHandlers = o => {
  const h = realDarkCreate(o);
  darkRegistry.set(o.userId, h);
  return h;
};
const app = require('express')(),
  server = http.createServer(app),
  io = new (require('socket.io').Server)(server);
app.use(require('express').json());
app.use('/api', require('../server/http/routes'));
app.use(require('express').static(dist));
app.get('*', (_q, res) => res.sendFile(path.join(dist, 'index.html')));
io.use(require('../server/http/authMiddleware').authenticateSocket);
require('../server/realtime/socketHandler')(io);
const manager = require('../server/realtime/raidManager').getRaidManager(io);
let base,
  browser,
  page,
  success = false;
const accounts = [],
  peers = [],
  runIds = [],
  errors = [],
  views = [],
  checks = [];
async function wait(fn, description, ms = 12000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise(r => setTimeout(r, 30));
  }
  throw Error('Timeout: ' + description);
}
async function create() {
  const res = await fetch(base + '/api/users', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      username: 'raid_test_' + randomUUID().slice(0, 12),
      password: randomUUID(),
      starterId: 7
    })
  });
  assert.equal(res.status, 201);
  const a = await res.json();
  accounts.push(a);
  a.party = Array.from({
    length: 4
  }, () => make(9, 100, 4, ['Water Pulse', 'Protect', 'Heal Pulse', 'Wish'], 'Torrent', true));
  await teams.editEquipe(a.user.id, {
    pokemons: a.party
  });
  const r = manager.world().rifts[0];
  await db.execute('UPDATE users SET map=?,x=?,y=?,money=50000 WHERE id=?', [r.map, r.x + 32, r.y, a.user.id]);
  await db.execute("INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,'professional_trainer_card',1)", [a.user.id]);
  for (const [key, value] of [['dark_rules_read', 'true'], ['adventure_opening', 'complete'], ['patch_seen:' + require('../data/game/latest_patch.json').version, 'true']]) await db.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)', [a.user.id, key, value]);
  return a;
}
async function connect(a) {
  const s = require('../vue-explorakit/node_modules/socket.io-client').io(base, {
    auth: {
      token: a.token,
      corruptionRaids: 1,
      mirrorRift: true,
      adventureOpening: true
    },
    transports: ['websocket'],
    autoConnect: false,
    forceNew: true
  });
  peers.push(s);
  s.on('raid:state', state => s.raid = state);
  s.on('raid:world', w => s.world = w);
  s.on('raid:invitation', v => s.invitation = v);
  s.on('dialogue', d => {
    console.log('Fixture dialogue', String(d[1]));
    s.emit('onEndDialogue', {
      name: d[1]
    });
  });
  s.connect();
  await once(s, 'connect');
  await wait(() => manager.contexts.has(a.user.id), 'raid session');
  await wait(() => manager.contexts.get(a.user.id).canUse(), 'free session');
  return s;
}
async function command(s, name, data = {}) {
  const r = await new Promise((resolve, reject) => s.timeout(12000).emit('raid:' + name, data, (e, r) => e ? reject(e) : resolve(r)));
  if (r?.message === 'Patiente un instant.') {
    await new Promise(r => setTimeout(r, 1050));
    return command(s, name, data);
  }
  assert(r?.success, `${name}: ${r?.message}`);
  return r;
}
async function join(host, guest) {
  await command(host, 'invite', {
    userId: guest.auth.userId
  });
}
async function capture(page, name, width, height) {
  await page.setViewportSize({
    width,
    height
  });
  await page.waitForTimeout(250);
  await page.screenshot({
    path: path.join(out, name + '.png')
  });
  const overflow = await page.evaluate(() => {
    const root = document.querySelector('[data-raid-battle]') || document.querySelector('.raid-panel');
    if (!root) return 'missing';
    const r = root.getBoundingClientRect();
    return {
      left: r.left,
      right: r.right,
      top: r.top,
      bottom: r.bottom,
      w: innerWidth,
      h: innerHeight
    };
  });
  assert(overflow !== 'missing');
  assert(overflow.left >= -1 && overflow.right <= width + 1 && overflow.top >= -1 && overflow.bottom <= height + 1, JSON.stringify(overflow));
  views.push({
    name,
    width,
    height
  });
}
(async () => {
  try {
    await manager.ready;
    // Keep the local test rendezvous still while four accounts authenticate.
    // The production manager and its movement logic remain unchanged.
    for(const r of manager.world().rifts){r.x=r.to.x;r.y=r.to.y;r.from={x:r.x,y:r.y};r.to={...r.from};r.nextMove=Date.now()+30*60000;}
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = 'http://127.0.0.1:' + server.address().port;
    for (let i = 0; i < 4; i++) await create();
    const [owner, ...friends] = accounts;
    for (const f of friends) {
      await require('../server/persistence/trainerRepository').friendAction(owner.user.id, f.user.id, 'request');
      await require('../server/persistence/trainerRepository').friendAction(f.user.id, owner.user.id, 'accept');
    }
    const sockets = [];
    for (const a of accounts) sockets.push(await connect(a));
    const [host] = sockets;
    assert.equal(host.world.rifts[0].id, manager.world().rifts[0].id);
    for (let count = 1; count <= 4; count++) {
      await wait(() => !manager.contexts.get(owner.user.id).getPlayer().inventoryBusy, 'settled previous result');
      const open = await command(host, 'open', {
        riftId: manager.world().rifts[0].id
      });
      assert(open.preview.boss.corrupted);
      await command(host, 'enter', {
        riftId: open.preview.id
      });
      runIds.push(host.raid.id);
      for (let i = 1; i < count; i++) {
        await command(host, 'invite', {
          userId: accounts[i].user.id
        });
        await wait(() => !!sockets[i].invitation, 'invitation');
        await command(sockets[i], 'invitation', {
          id: sockets[i].invitation.id,
          accept: true
        });
        await wait(() => host.raid.members.length === i + 1 && !host.raid.members[i].reserved, 'joined lobby');
      }
      if (count === 3) await command(host, 'extra', {
        ownerId: accounts[1].user.id
      });
      for (let i = 0; i < count; i++) {
        const m = host.raid.members.find(m => m.id === accounts[i].user.id),
          inv = await command(sockets[i], 'inventory');
        await command(sockets[i], 'select', {
          uuids: inv.pokemons.slice(0, m.quota).map(p => p.uuid)
        });
      }
      for (let i = 0; i < count; i++) await command(sockets[i], 'ready');
      await command(host, 'start');
      assert.equal(host.raid.combat.allies.length, 4);
      const token = host.raid.combat.token;
      for (let i = 0; i < count; i++) {
        const state = sockets[i].raid;
        for (let slot = 0; slot < 4; slot++) if (state.combat.allies[slot].canControl) await command(sockets[i], 'action', {
          slot,
          action: 'attack',
          moveIndex: 1,
          token
        });
      }
      await wait(() => host.raid.combat.token !== token, 'shared resolved round');
      assert.notEqual(host.raid.combat.token, token);
      assert.equal(host.raid.combat.events.filter(e => e.kind === 'move' && e.slot === 4).length, 2);
      const deadline = host.raid.combat.deadline,
        id = host.raid.id;
      host.disconnect();
      await wait(() => !manager.contexts.has(owner.user.id), 'detached');
      host.connect();
      await once(host, 'connect');
      await wait(() => host.raid?.id === id && manager.contexts.has(owner.user.id), 'resumed');
      assert.equal(host.raid.combat.deadline, deadline);
      const r = manager.runs.get(id),
        b = RaidBattle.restore(r.combat);
      b.bossPokemon.hp = 1;
      r.combat = b.snapshot();
      r.version = await repo.save(r, {
        expected: r.version,
        partyChanged: false
      });
      const round = b.token;
      for (let i = 0; i < count; i++) {
        for (let slot = 0; slot < 4; slot++) if (b.models[slot].ownerId === accounts[i].user.id) await command(sockets[i], 'action', {
          slot,
          action: 'attack',
          moveIndex: 0,
          targetLoc: 1,
          token: round
        });
      }
      await wait(() => host.raid.phase === 'won', 'victory shared by every participant');
      assert.equal(host.raid.phase, 'won', JSON.stringify({
        count,
        phase: host.raid.phase,
        boss: host.raid.combat.boss.currentHp,
        events: host.raid.combat.events,
        turn: host.raid.combat.turn,
        pending: manager.runs.get(id).combat.pending,
        owners: b.models.map(m => m.ownerId),
        accounts: accounts.map(a => a.user.id)
      }));
      const [[receipt]] = await db.execute('SELECT COUNT(*) AS n FROM corruption_raid_rewards WHERE raid_id=?', [id]);
      assert.equal(Number(receipt.n), count);
      const [[wallet]] = await db.execute('SELECT money FROM users WHERE id=?', [owner.user.id]);
      await assert.rejects(() => repo.save(r, {
        expected: r.version - 1,
        settle: true
      }), /actualisé/);
      assert.equal((await db.execute('SELECT money FROM users WHERE id=?', [owner.user.id]))[0][0].money, wallet.money);
      for (let i = 0; i < count; i++) await command(sockets[i], 'leave');
      checks.push('real SQL/socket ' + count + ' players, ownership, two actions, reconnect deadline, one settlement');
    }
    // Accepted invitations reserve a place without interrupting a real wild battle.
    await wait(() => !manager.contexts.get(owner.user.id).getPlayer().inventoryBusy, 'settled result');
    await command(host, 'enter', {
      riftId: manager.world().rifts[0].id
    });
    runIds.push(host.raid.id);
    const guest = sockets[1],
      wild = darkRegistry.get(accounts[1].user.id),
      enemy = make(10, 2, 1, ['Splash'], 'Shield Dust');
    enemy.currentHp = 1;
    await wild.start(enemy);
    assert(manager.contexts.get(accounts[1].user.id).getPlayer().inbattle);
    await command(host, 'invite', {
      userId: accounts[1].user.id
    });
    await wait(() => !!guest.invitation, 'busy friend invitation');
    await command(guest, 'invitation', {
      id: guest.invitation.id,
      accept: true
    });
    assert(manager.view(owner.user.id).members[1].reserved);
    assert(wild.controller.active);
    await wild.controller.execute(() => wild.controller.action({
      turnId: wild.controller.run.battle.token,
      action: 'attack',
      number: 0
    }));
    await wait(() => !wild.controller.active, 'wild victory');
    await manager.tick();
    await wait(() => !manager.view(owner.user.id).members[1].reserved, 'reserved friend teleport');
    assert.equal(manager.contexts.get(accounts[1].user.id).getPlayer().currentmap, manager.world().rifts[0].map);
    checks.push('real combat invitation reserves, then joins automatically after the fight');
    await command(guest, 'leave');
    await command(host, 'leave');
    // A disconnected player keeps a submitted action; only unsubmitted slots time out.
    await command(host, 'enter', {
      riftId: manager.world().rifts[0].id
    });
    const timeoutId = host.raid.id;
    runIds.push(timeoutId);
    const inv = await command(host, 'inventory');
    await command(host, 'select', {
      uuids: inv.pokemons.map(p => p.uuid)
    });
    await command(host, 'ready');
    await command(host, 'start');
    await command(host, 'action', {
      slot: 0,
      action: 'attack',
      moveIndex: 1,
      token: host.raid.combat.token
    });
    host.disconnect();
    await wait(() => !manager.contexts.has(owner.user.id), 'offline timeout');
    const timeoutRun = manager.runs.get(timeoutId);
    for(let expired=1;expired<=3;expired++){
      timeoutRun.combat.deadline=Date.now()-1;
      timeoutRun.version=await repo.save(timeoutRun,{expected:timeoutRun.version,partyChanged:false});
      await manager.tick();
      Object.assign(timeoutRun,manager.runs.get(timeoutId));
      assert.equal(timeoutRun.combat.sim.sides[0].pokemon.filter(p=>p.m.retired).length,expired);
    }
    assert.equal(manager.runs.get(timeoutId).combat.sim.sides[0].pokemon.filter(p => p.m.retired).length, 3);
    assert.equal((await teams.loadEquipe(owner.user.id)).pokemons.length, 4);
    host.connect();
    await once(host, 'connect');
    await wait(() => host.raid?.id === timeoutId && host.raid.combat.allies[1].withdrawn, 'withdrawal survives reconnection');
    await command(host, 'action', {
      slot: 0,
      action: 'retreat',
      confirm: true,
      token: host.raid.combat.token
    });
    await wait(() => host.raid.phase === 'lost', 'safe collective retirement');
    await command(host, 'leave');
    checks.push('offline timeout retires only missing choices and never deletes the withdrawn Pokemon');
    // A real transaction deletes the fallen Pokémon and consumes a Kit exactly once.
    const team = await teams.loadEquipe(owner.user.id);
    team.pokemons[0].heldItem = 'survival_kit';
    await teams.editEquipe(owner.user.id, team);
    const members = [await repo.member(owner.user.id, owner.user.username)],
      models = members[0].team.pokemons.map(pokemon => ({
        ownerId: owner.user.id,
        ownerName: owner.user.username,
        pokemon
      })),
      combat = new RaidBattle(models, bossFor(manager.world().rifts[0]));
    for (const i of [0, 1]) {
      const p = combat.sim.p1.active[i];
      p.hp = 1;
      combat.sim.damage(2, p, combat.bossPokemon, combat.sim.dex.moves.get('tackle'));
    }
    combat.applyModels();
    const run = {
      id: randomUUID(),
      phase: 'active',
      version: 0,
      members,
      rift: manager.world().rifts[0],
      combat: combat.snapshot()
    };
    runIds.push(run.id);
    run.version = await repo.save(run);
    const fresh = await teams.loadEquipe(owner.user.id);
    assert.equal(fresh.pokemons.length, 3);
    assert.equal(fresh.pokemons.find(p => p.uuid === models[0].pokemon.uuid).heldItem, null);
    assert.equal(fresh.pokemons.find(p => p.uuid === models[0].pokemon.uuid).currentHp, 0);
    assert(!fresh.pokemons.some(p => p.uuid === models[1].pokemon.uuid));
    checks.push('atomic permanent death and one-use survival kit');
    await db.execute('DELETE FROM corruption_raids WHERE id=?', [run.id]);
    // Browser uses the actual socket handlers and existing readonly Pokémon sheet.
    host.disconnect();
    await wait(() => !manager.contexts.has(owner.user.id), 'host browser switch');
    await teams.editEquipe(owner.user.id, {
      pokemons: owner.party.map(p => {
        p.currentHp = p.maxHp;
        p.heldItem = null;
        return p;
      })
    });
    const rift = manager.world().rifts[0];
    await db.execute('UPDATE users SET map=?,x=?,y=? WHERE id=?', [rift.map, rift.x + 32, rift.y, owner.user.id]);
    const browserEngine=process.env.PRESENTATION_BROWSER||'chromium';
    browser = await require('playwright')[browserEngine].launch({
      headless: true,
      ...(browserEngine==='chromium'?{args:['--no-sandbox']}:{})
    });
    const context = await browser.newContext({
      viewport: {
        width: 1280,
        height: 900
      },
      serviceWorkers: 'block'
    });
    await context.addInitScript(a => localStorage.setItem('explorakit.user', JSON.stringify(a)), {
      ...owner.user,
      token: owner.token
    });
    page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(base + '/game');
    await page.waitForFunction(() => {
      const v = document.querySelector('.game-root')?.__vue__;
      if (v?.socket?.connected && v.players[v.socket.id] && !v.mapLoading && v.raidWorld) {
        window.v = v;
        return true;
      }
    });
    if (await page.locator('[data-patch-dismiss]').isVisible()) await page.locator('[data-patch-dismiss]').click();
    await page.evaluate(() => {
      v.updatePreferences({
        ...v.preferences,
        masterVolume: 0
      });
    });
    await page.evaluate(id => v.raidCommand('open', {
      riftId: id
    }), rift.id); // The world interaction also emits raid:open; request the real public event below.
    await page.evaluate(() => v.socket.emit('Space'));
    await page.locator('.raid-panel').waitFor();
    await page.getByRole('button', {
      name: 'J’ai compris',
      exact: true
    }).click();
    await capture(page, 'preview-desktop', 1280, 900);
    await capture(page, 'preview-mobile', 393, 852);
    await page.getByRole('button', {
      name: 'Entrer dans la faille',
      exact: false
    }).click();
    await wait(() => manager.view(owner.user.id)?.phase === 'lobby', 'browser lobby');
    runIds.push(manager.view(owner.user.id).id);
    await page.waitForFunction(() => v.raidInventory.length === 4);
    await capture(page, 'lobby-mobile', 393, 852);
    await capture(page, 'lobby-desktop', 1280, 900);
    await page.locator('.raid-selection button').nth(0).click();
    await page.waitForTimeout(100);
    await page.locator('.raid-slots button').first().click();
    await page.locator('.companion-sheet').waitFor();
    await page.locator('.companion-close').click();
    await page.evaluate(async () => {
      await v.raidCommand('select', {
        uuids: v.raidInventory.map(p => p.uuid)
      });
      await v.raidCommand('ready');
      await v.raidCommand('start');
    });
    await page.locator('[data-raid-battle]').waitFor();
    await page.waitForFunction(() => !document.querySelector('[data-raid-battle]').__vue__.loading);
    await capture(page, 'battle-desktop', 1280, 900);
    await capture(page, 'battle-mobile', 393, 852);
    await page.locator('.raid-moves button').nth(2).click();
    assert.equal(await page.locator('.is-valid-target').count(), 3);
    await capture(page, 'ally-target-mobile', 393, 852);
    await page.getByRole('button', {
      name: 'Annuler',
      exact: true
    }).click();
    await page.getByRole('button', {
      name: 'Retirer mon Pokémon',
      exact: true
    }).click();
    await page.getByRole('button', {
      name: 'Le mettre à l’abri',
      exact: true
    }).click();
    await page.waitForTimeout(200);
    assert.equal(manager.view(owner.user.id).combat.allies[0].ready, true);
    const beforeReconnect=manager.view(owner.user.id).combat;await context.close();
    const touch=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true,serviceWorkers:'block'});
    await touch.addInitScript(a=>localStorage.setItem('explorakit.user',JSON.stringify(a)),{...owner.user,token:owner.token});
    page=await touch.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/game');
    await page.waitForFunction(()=>{const v=document.querySelector('.game-root')?.__vue__;if(v?.raidState?.combat){window.v=v;return true;}});
    assert.equal(await page.evaluate(()=>v.raidState.combat.deadline),beforeReconnect.deadline);
    await page.waitForFunction(()=>!document.querySelector('[data-raid-battle]').__vue__.loading&&!document.querySelector('[data-raid-battle]').__vue__.playing);
    await page.locator('.raid-ally-cards>button').nth(1).tap();await page.locator('.raid-moves button').nth(2).tap();await page.locator('.raid-ally-cards>button').nth(3).tap();
    await wait(()=>manager.runs.get(manager.view(owner.user.id).id).combat.pending[1]?.targetLoc===-4,'real touch target four');
    await capture(page,'touch-resumed-mobile',393,852);checks.push('real mobile touch, fourth ally targeting and browser-reload deadline preservation');
    assert.deepEqual(errors, []);
    checks.push('desktop/mobile real lobby, readonly sheet, support target and safe withdrawal confirmation');
    success = true;
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({
      success,
      engine:process.env.PRESENTATION_BROWSER||'chromium',
      buildIndexSha256:createHash('sha256').update(fs.readFileSync(dist+'/index.html')).digest('hex'),
      checks,
      views,
      errors
    }, null, 2));
    console.log(JSON.stringify({
      success,
      engine:process.env.PRESENTATION_BROWSER||'chromium',
      buildIndexSha256:createHash('sha256').update(fs.readFileSync(dist+'/index.html')).digest('hex'),
      checks,
      views
    }));
  } catch (e) {
    console.error(e.stack);
    process.exitCode = 1;
  } finally {
    for (const s of peers) s.close();
    await browser?.close();
    await manager.stop();
    require('../server/realtime/whitepeakClub').getClub(io).close();
    await new Promise(r => io.close(r));
    await require('../server/realtime/accountConnection').waitForAccountConnections(io);
    for (const id of runIds) await db.execute('DELETE FROM corruption_raids WHERE id=?', [id]);
    for (const a of accounts) await db.execute('DELETE FROM users WHERE id=?', [a.user.id]);
    await db.end();
    console.log(JSON.stringify({
      success,
      testAccountsDeleted: true
    }));
  }
})();
